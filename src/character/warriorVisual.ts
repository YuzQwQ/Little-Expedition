import Phaser from 'phaser';
import { DEFAULT_RIG, PARTS, SWORD_ARM, type PartId, type Rig } from './warriorRig';

export type Motion = 'idle' | 'walk' | 'attack' | 'guard' | 'dodge' | 'ultimate';

interface AttackTiming {
    windup: number;
    active: number;
    recovery: number;
}

export const PREVIEW_ATTACK: AttackTiming = { windup: 0.20, active: 0.21, recovery: 0.35 };

interface Pose {
    bob: number;
    breath: number;
    lean?: number;
    lead?: number;
    angles: Partial<Record<PartId, number>>;
}

function smooth(from: number, to: number, t: number) {
    const n = Phaser.Math.Clamp(t, 0, 1);
    return Phaser.Math.Linear(from, to, n * n * (3 - 2 * n));
}

export function warriorPose(motion: Motion, elapsed: number, timing = PREVIEW_ATTACK, dodgeDuration = 0.22): Pose {
    if (motion === 'walk') {
        const stride = Math.sin(elapsed * Math.PI * 2 * 1.75);
        return {
            bob: -Math.abs(stride) * 32, breath: 0,
            lean: 10 + 4 * stride, lead: 16 + 10 * stride,
            angles: {
                leg_front: 36 * stride, leg_back: -34 * stride,
                arm_front: -25 * stride, arm_back: 19 * stride, head: -6 * stride,
            },
        };
    }
    if (motion === 'attack' || motion === 'ultimate') {
        const { windup, active, recovery } = timing;
        const activeEnd = windup + active;
        const t = Phaser.Math.Clamp(elapsed / (activeEnd + recovery), 0, 1);
        const swing = (raised: number, released: number) => elapsed < windup ? smooth(0, raised, elapsed / windup)
            : elapsed < activeEnd ? smooth(raised, released, (elapsed - windup) / active)
                : smooth(released, 0, (elapsed - activeEnd) / recovery);
        if (motion === 'ultimate') {
            return {
                bob: swing(-30, 24), breath: 0, lean: swing(-18, 32), lead: swing(-45, 78),
                angles: {
                    arm_back: swing(-106, 18), sword: swing(-31, 83), arm_front: swing(34, -45),
                    leg_front: swing(-12, 24), leg_back: swing(15, -24), head: swing(-10, 14),
                },
            };
        }
        return {
            bob: -19 * Math.sin(Math.PI * t), breath: 0,
            lean: swing(-13, 21), lead: swing(-30, 56),
            // The wrist carries the arc through while the hand stays close to the front edge of the coat.
            angles: {
                arm_back: swing(-79, 7), sword: swing(-18, 57), arm_front: swing(24, -31),
                leg_front: swing(-7, 14), leg_back: swing(8, -13), head: swing(-4, 8),
            },
        };
    }
    if (motion === 'guard') {
        const settle = smooth(0, 1, elapsed / 0.18);
        return {
            bob: 46 * settle, breath: 0, lean: -10 * settle, lead: -21 * settle,
            angles: {
                arm_back: -62 * settle, arm_front: -41 * settle,
                leg_front: -18 * settle, leg_back: 18 * settle, head: 8 * settle,
            },
        };
    }
    if (motion === 'dodge') {
        const progress = Phaser.Math.Clamp(elapsed / dodgeDuration, 0, 1);
        const tuck = smooth(0.50, 1, progress / 0.3) * smooth(0, 1, (1 - progress) / 0.36);
        return {
            bob: 75 * tuck, breath: 0, lean: 28 * tuck, lead: 34 * tuck,
            angles: {
                head: 13 * tuck, arm_front: 30 * tuck, arm_back: -42 * tuck,
                leg_front: -34 * tuck, leg_back: 34 * tuck,
            },
        };
    }
    const breath = (1 - Math.cos(elapsed * 2.7)) / 2;
    return { bob: -3 * breath, breath, angles: {} };
}

const textureKey = (id: PartId) => `warrior-rig-${id}`;

export function loadWarriorTextures(scene: Phaser.Scene) {
    for (const id of PARTS) {
        const key = textureKey(id);
        if (!scene.textures.exists(key)) scene.load.image(key, import.meta.env.BASE_URL + DEFAULT_RIG[id].asset);
    }
}

export function hasWarriorTextures(scene: Phaser.Scene) {
    return PARTS.every(id => scene.textures.exists(textureKey(id)));
}

function partTexture(scene: Phaser.Scene, id: PartId, sampleScale?: number) {
    const sourceKey = textureKey(id);
    if (sampleScale === undefined) return sourceKey;

    const key = `${sourceKey}-filtered-${sampleScale}`;
    if (scene.textures.exists(key)) return key;

    const sourceTexture = scene.textures.get(sourceKey);
    const source = sourceTexture.getSourceImage();
    if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement)) return sourceKey;

    const { width, height } = sourceTexture.get();
    const ratio = Math.min(1, sampleScale * DEFAULT_RIG[id].scale);
    const filtered = scene.textures.createCanvas(key, Math.ceil(width * ratio), Math.ceil(height * ratio));
    if (!filtered) return sourceKey;

    const context = filtered.getContext();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, filtered.width, filtered.height);
    filtered.refresh();
    return key;
}

export class WarriorVisual {
    readonly root: Phaser.GameObjects.Container;
    private readonly parts = {} as Record<PartId, Phaser.GameObjects.Image>;
    private readonly sourceSize = {} as Record<PartId, { width: number; height: number }>;
    private readonly grip = new Phaser.Math.Vector2();
    private tint?: number;
    private filled = false;

    constructor(private readonly scene: Phaser.Scene, x: number, y: number, private readonly scale: number, prefilter = false) {
        this.root = scene.add.container(x, y);
        for (const id of PARTS) {
            const { width, height } = scene.textures.get(textureKey(id)).get();
            this.sourceSize[id] = { width, height };
            // Prepare each battle texture once near its on-screen size. Bilinear sampling alone
            // misses too much detail when the full art is shrunk to roughly a tenth of its size.
            const key = partTexture(scene, id, prefilter ? scale * 1.6 : undefined);
            const image = scene.add.image(0, 0, key).setName(id);
            this.parts[id] = image;
            this.root.add(image);
        }
        this.render();
    }

    render(rig = DEFAULT_RIG, pose = warriorPose('idle', 0), mirrored = false) {
        this.root.setScale(mirrored ? -this.scale : this.scale, this.scale);
        const lean = pose.lean ?? 0;
        const radians = Phaser.Math.DegToRad(lean);
        const sin = Math.sin(radians);
        const cos = Math.cos(radians);
        const hipY = -140;
        let reorder = false;
        for (const id of PARTS) {
            const config = rig[id];
            const sprite = this.parts[id];
            const { width, height } = this.sourceSize[id];
            const onGround = id === 'shadow';
            // Lean all the joints around the same hip pivot so the torso keeps its limbs attached.
            const dy = config.y - hipY;
            const x = onGround ? config.x : config.x * cos - dy * sin + (pose.lead ?? 0);
            const y = onGround ? config.y : hipY + config.x * sin + dy * cos + pose.bob - (id === 'head' ? pose.breath : 0);
            sprite.setOrigin(config.pivotX, config.pivotY)
                .setPosition(x, y)
                .setAngle(config.angle + (pose.angles[id] ?? 0) + (onGround ? 0 : lean))
                .setScale(config.scale * width / sprite.width, config.scale * height / sprite.height)
                .setVisible(config.visible);
            if (sprite.depth !== config.depth) {
                sprite.setDepth(config.depth);
                reorder = true;
            }
        }
        if (reorder) {
            this.root.sort('depth', (a: Phaser.GameObjects.Image, b: Phaser.GameObjects.Image) =>
                a.depth - b.depth || PARTS.indexOf(a.name as PartId) - PARTS.indexOf(b.name as PartId));
        }
        this.attachSword(rig, pose.angles.sword ?? 0);
    }

    pivot(id: PartId) {
        const { x, y } = this.parts[id];
        return { x: this.root.x + x * this.root.scaleX, y: this.root.y + y * this.root.scaleY };
    }

    setTint(color?: number, filled = false) {
        if (color === this.tint && filled === this.filled) return;
        this.tint = color;
        this.filled = filled;
        for (const id of PARTS) {
            if (id === 'shadow') continue;
            const image = this.parts[id].clearTint();
            if (color !== undefined) image.setTint(color);
            if (filled) image.setTintMode(Phaser.TintModes.FILL);
        }
    }

    afterimage() {
        const ghost = this.scene.add.container(this.root.x, this.root.y)
            .setScale(this.root.scaleX, this.root.scaleY).setAlpha(0.30);
        for (const image of this.root.list as Phaser.GameObjects.Image[]) {
            if (image.name === 'shadow' || !image.visible) continue;
            ghost.add(this.scene.add.image(image.x, image.y, image.texture.key)
                .setOrigin(image.originX, image.originY).setRotation(image.rotation)
                .setScale(image.scaleX, image.scaleY).setTint(0x99d4c0));
        }
        return ghost;
    }

    private attachSword(rig: Rig, wrist: number) {
        const arm = this.parts[SWORD_ARM];
        const sword = this.parts.sword;
        const base = DEFAULT_RIG[SWORD_ARM];
        const { width, height } = this.sourceSize[SWORD_ARM];
        const armConfig = rig[SWORD_ARM];
        const weapon = rig.sword;
        // Map the rest grip through the arm's current pivot, rotation and scale.
        const grip = this.grip.set(weapon.x - base.x, weapon.y - base.y)
            .rotate(-Phaser.Math.DegToRad(base.angle)).scale(1 / base.scale);
        grip.x += (base.pivotX - armConfig.pivotX) * width;
        grip.y += (base.pivotY - armConfig.pivotY) * height;
        grip.scale(armConfig.scale).rotate(arm.rotation);
        sword.setPosition(arm.x + grip.x, arm.y + grip.y)
            .setAngle(weapon.angle + arm.angle - base.angle + wrist);
    }
}
