import Phaser from 'phaser';
import { hasWarriorTextures, warriorPose, WarriorVisual, type Motion } from '../character/warriorVisual';
import {
    ARCHER, BREAK, ENEMIES, FIELD, FROST, OBSTACLES, RELIC_FACTIONS, RELIC_FACTION_NAMES, RELICS, VIEW, WAVES, WARRIOR,
    type EnemyKind, type RelicFaction, type RelicId,
} from './config';
import type { Point, Vital } from './combat';
import { firstBoundaryContact, firstWallContact, type EnemyProjectile } from './enemyProjectiles';
import type { ActiveSpecialAttack } from './specialEnemy';
import type { EnemyStatuses } from './statuses';
import type { EncounterContext, EncounterResult, EncounterSession } from './encounters';
import {
    BLESSING_WEIGHT, CHALLENGE_EXTRA_SLIMES, CHALLENGE_HP_BONUS, LATE_REWARD_HEAL, REFRESH_COST, REST_FRACTION, REWARD_BASE_GOLD,
    cashCardPayout, hasFutureShop,
    type EventCard, type EventReward, type ShopOffer, type ShopSupply,
} from './expedition';
import { COLORS, FACTION_COLORS, button, factionBadge, heading, label, panel } from './ui';

type TextureKind = EnemyKind | 'warrior';
const ACTOR_FRAME = 72;
const SKELETON_FRAME = 88;
const WARRIOR_DRAW_SCALE = 0.12;
const percent = (fraction: number) => Math.round(fraction * 100);
const EVENT_CARDS: Record<EventCard, { title: string; icon: string; detail: string; accent: number }> = {
    battle: { title: '战斗', icon: '⚔', detail: `下一波敌人生命 +${percent(CHALLENGE_HP_BONUS)}%\n增加 ${CHALLENGE_EXTRA_SLIMES} 只史莱姆 · 清场额外奖励遗物`, accent: 0xca8b76 },
    reward: { title: '奖励', icon: '✦', detail: '', accent: 0xd0ac7b },
    encounter: { title: '遭遇', icon: '?', detail: '随机遇见一件奇事\n选择如何应对', accent: 0x99a3cc },
};

const ENCOUNTER_ICONS = { find: '◇', trade: '⊙', risk: '✧', blessing: '✦' };
const hpLine = (player: Vital) => `生命 ${Math.ceil(player.hp)} / ${player.maxHp}`;

function polygon(g: Phaser.GameObjects.Graphics, color: number, points: number[][]) {
    g.fillStyle(color).beginPath().moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) g.lineTo(x, y);
    g.closePath().fillPath();
}

export function ensureTextures(scene: Phaser.Scene) {
    if (scene.textures.exists('actor-warrior')) return;
    const art = scene.make.graphics({ x: 0, y: 0 }, false);
    const outline = 0x17272e;

    art.fillStyle(0x0d191c, 0.4).fillEllipse(35, 62, 45, 12);
    art.fillStyle(outline).fillRoundedRect(19, 37, 31, 26, 7).fillCircle(35, 27, 18);
    art.fillStyle(0x4c7578).fillRoundedRect(22, 37, 25, 18, 5);
    polygon(art, 0xb65e56, [[24, 35], [22, 56], [11, 55], [16, 34]]);
    art.fillStyle(0xbdbfb3).fillCircle(35, 26, 15);
    art.fillStyle(0xe2d7bd).fillEllipse(35, 21, 26, 16);
    art.fillStyle(0x24373e).fillRoundedRect(34, 25, 15, 7, 2);
    art.fillStyle(0xf2c587).fillRect(38, 27, 7, 2).fillRoundedRect(21, 35, 23, 5, 2);
    art.fillStyle(0x4b5960).fillRoundedRect(20, 54, 12, 8, 2).fillRoundedRect(37, 54, 13, 8, 2);
    polygon(art, outline, [[47, 49], [43, 45], [59, 28], [66, 29], [65, 36], [50, 52]]);
    polygon(art, 0xd5e5df, [[47, 46], [59, 31], [63, 31], [62, 35], [49, 48]]);
    art.lineStyle(3, 0xeab778).lineBetween(43, 44, 51, 50);
    art.generateTexture('actor-warrior', ACTOR_FRAME, ACTOR_FRAME);

    art.clear();
    art.fillStyle(0x0d191c, 0.4).fillEllipse(36, 54, 49, 11);
    art.fillStyle(outline).fillEllipse(36, 38, 48, 37);
    art.fillStyle(0x639b78).fillEllipse(36, 38, 41, 30);
    art.fillStyle(0x8abd90).fillEllipse(35, 31, 34, 17);
    art.fillStyle(0xc9dfad, 0.75).fillEllipse(28, 27, 11, 5);
    art.fillStyle(outline).fillCircle(36, 39, 2.6).fillCircle(45, 38, 2.6);
    art.generateTexture('actor-slime', ACTOR_FRAME, ACTOR_FRAME);

    art.clear();
    art.fillStyle(0x0d191c, 0.4).fillEllipse(35, 55, 40, 10);
    art.fillStyle(outline).fillRoundedRect(22, 29, 27, 25, 7).fillCircle(34, 24, 15);
    art.fillStyle(0x8aa766).fillCircle(34, 24, 12);
    polygon(art, 0x8aa766, [[25, 24], [15, 17], [23, 31]]);
    art.fillStyle(0x806951).fillRoundedRect(24, 36, 22, 14, 4);
    art.fillStyle(outline).fillCircle(39, 24, 2).fillRect(26, 51, 9, 5).fillRect(39, 51, 9, 5);
    art.lineStyle(3, 0xd5a76f).beginPath().arc(47, 39, 15, -1.15, 1.15).strokePath();
    art.lineStyle(1, 0xf0d6af).lineBetween(53, 25, 53, 53);
    art.generateTexture('actor-archer', ACTOR_FRAME, ACTOR_FRAME);

    art.clear();
    art.fillStyle(outline).fillRoundedRect(20, 23, 30, 35, 8).fillCircle(34, 19, 15);
    art.fillStyle(0x715882).fillTriangle(19, 55, 48, 55, 34, 23);
    art.fillStyle(0xddd4c7).fillEllipse(34, 20, 22, 18);
    art.fillStyle(outline).fillRect(33, 19, 3, 3).fillRect(41, 19, 3, 3);
    art.lineStyle(4, 0x9f8575).lineBetween(49, 24, 53, 57);
    art.fillStyle(0xd997b4).fillCircle(49, 24, 6);
    art.generateTexture('actor-caster', ACTOR_FRAME, ACTOR_FRAME);

    art.clear();
    art.fillStyle(outline).fillEllipse(35, 36, 53, 35).fillRoundedRect(21, 43, 26, 16, 5);
    art.fillStyle(0x986958).fillEllipse(35, 36, 47, 29);
    art.fillStyle(0xc58f79).fillRoundedRect(43, 34, 18, 13, 5);
    art.fillStyle(0xf3ddb7).fillTriangle(47, 47, 56, 47, 54, 40);
    art.fillStyle(outline).fillCircle(43, 31, 2.5);
    art.generateTexture('actor-boar', ACTOR_FRAME, ACTOR_FRAME);

    art.clear();
    art.fillStyle(outline).fillCircle(35, 26, 15).fillRoundedRect(23, 35, 25, 21, 5);
    art.fillStyle(0x86a960).fillCircle(35, 26, 12).fillTriangle(24, 34, 16, 21, 25, 21);
    art.fillStyle(0xc86b53).fillRoundedRect(26, 36, 21, 14, 3);
    art.fillStyle(outline).fillCircle(41, 25, 2);
    art.lineStyle(4, 0xe6d9bc).lineBetween(46, 45, 58, 32);
    art.generateTexture('actor-zealot', ACTOR_FRAME, ACTOR_FRAME);

    art.clear();
    art.fillStyle(outline).fillRoundedRect(18, 25, 71, 63, 10).fillRoundedRect(31, 12, 49, 32, 6);
    art.fillStyle(0x7d8b89).fillRoundedRect(24, 31, 59, 43, 6).fillRoundedRect(35, 16, 41, 26, 5);
    art.fillStyle(0xaeb2a1).fillRoundedRect(8, 37, 27, 34, 5).fillRoundedRect(76, 37, 27, 34, 5);
    art.fillStyle(0xff9d8b).fillRect(48, 28, 7, 4).fillRect(64, 28, 7, 4);
    polygon(art, 0xc78f77, [[55, 45], [62, 56], [55, 67], [48, 56]]);
    art.generateTexture('actor-guardian', 110, 104);

    const skeletonScale = SKELETON_FRAME / ACTOR_FRAME;
    art.clear().scaleCanvas(skeletonScale, skeletonScale);
    art.fillStyle(0x0d191c, 0.45).fillEllipse(36, 61, 48, 12);
    art.fillStyle(outline).fillRoundedRect(20, 35, 32, 26, 6).fillCircle(35, 24, 17);
    art.fillStyle(0x7d8276).fillRoundedRect(24, 37, 25, 21, 4);
    art.fillStyle(0xe1d9c5).fillCircle(35, 24, 14).fillRoundedRect(30, 29, 16, 10, 2);
    art.fillStyle(0x344346).fillCircle(35, 25, 3).fillCircle(43, 25, 3);
    art.fillRect(37, 33, 2, 5).fillRect(42, 33, 2, 5);
    art.fillStyle(0xc4bba6).fillRoundedRect(22, 54, 12, 7, 2).fillRoundedRect(40, 54, 12, 7, 2);
    polygon(art, outline, [[44, 34], [59, 32], [65, 41], [61, 55], [52, 62], [43, 53]]);
    polygon(art, 0x849591, [[47, 37], [58, 35], [62, 42], [58, 53], [52, 58], [46, 52]]);
    art.lineStyle(2, 0xc6baa0).lineBetween(54, 39, 54, 53);
    art.generateTexture('actor-skeleton', SKELETON_FRAME, SKELETON_FRAME);

    art.clear().fillStyle(0xffffff).fillCircle(4, 4, 4);
    art.generateTexture('impact-dot', 8, 8);
    art.destroy();
}

export interface EnemyView {
    sprite: Phaser.Physics.Arcade.Sprite;
    bars: Phaser.GameObjects.Graphics;
    vital: Vital;
    statuses: EnemyStatuses;
}

interface WarriorFrame {
    motion: Motion;
    time: number;
    mirrored: boolean;
    attackTime?: number;
    tint?: number;
    hitFlash: boolean;
}

export function sector(
    graphics: Phaser.GameObjects.Graphics, at: Point, angle: number, range: number, degrees: number,
    color: number, opacity: number,
) {
    graphics.fillStyle(color, opacity).lineStyle(2, color, Math.min(1, opacity + 0.33));
    if (degrees >= 360) {
        graphics.fillCircle(at.x, at.y, range).strokeCircle(at.x, at.y, range);
        return;
    }
    const span = Phaser.Math.DegToRad(degrees / 2);
    graphics.beginPath().moveTo(at.x, at.y)
        .arc(at.x, at.y, range, angle - span, angle + span)
        .lineTo(at.x, at.y).closePath().fillPath().strokePath();
}

export class BattleView {
    readonly world: Phaser.GameObjects.Layer;
    readonly hud: Phaser.GameObjects.Layer;
    readonly cues: Phaser.GameObjects.Graphics;
    readonly debugGraphics: Phaser.GameObjects.Graphics;
    readonly obstacles: Phaser.Physics.Arcade.StaticGroup;
    private readonly particles: Phaser.GameObjects.Particles.ParticleEmitter;
    private readonly meter: Phaser.GameObjects.Graphics;
    private readonly hp: Phaser.GameObjects.Text;
    private readonly shield: Phaser.GameObjects.Text;
    private readonly wave: Phaser.GameObjects.Text;
    private readonly gold: Phaser.GameObjects.Text;
    private readonly heldTitle: Phaser.GameObjects.Text;
    private readonly blessing: Phaser.GameObjects.Text;
    private readonly held: Phaser.GameObjects.Text[];
    private readonly charge: Phaser.GameObjects.Text;
    private readonly arcaneCharge: Phaser.GameObjects.Text;
    private readonly dodge: Phaser.GameObjects.Text;
    private readonly resolve: Phaser.GameObjects.Text;
    private readonly healthOffset: number;
    private readonly statusX: number;
    private readonly debug: Phaser.GameObjects.Text;
    private overlay?: Phaser.GameObjects.Container;
    private banner?: Phaser.GameObjects.Container;
    private warrior?: WarriorVisual;
    private warriorMotion?: Motion;
    private warriorMotionStarted = 0;

    constructor(private readonly scene: Phaser.Scene, private readonly mobile = false) {
        ensureTextures(scene);
        this.world = scene.add.layer();
        this.hud = scene.add.layer();
        const worldCamera = scene.cameras.main;
        const hudCamera = scene.cameras.add(0, 0, VIEW.width, VIEW.height).setName('hud');
        worldCamera.ignore(this.hud);
        hudCamera.ignore(this.world);

        this.world.add(this.drawFloor());

        this.obstacles = scene.physics.add.staticGroup();
        for (const obstacle of OBSTACLES) {
            const { x, y, width, height } = obstacle;
            const shape = scene.add.rectangle(x, y, width, height, 0x324748);
            this.world.add(shape);
            this.obstacles.add(shape);
            const stone = scene.add.graphics();
            stone.fillStyle(0x102329, 0.65).fillRoundedRect(x - width / 2 - 4, y - height / 2 + 8, width + 8, height + 5, 8);
            stone.fillStyle(0x40575a).fillRoundedRect(x - width / 2, y - height / 2, width, height, 6);
            stone.lineStyle(2, 0x657970).strokeRoundedRect(x - width / 2, y - height / 2, width, height, 6);
            stone.lineStyle(2, 0x354a4b).lineBetween(x - width / 2 + 8, y + height / 2 - 9, x + width / 2 - 8, y + height / 2 - 9);
            stone.lineBetween(x - 10, y - height / 2 + 2, x + 4, y - 11);
            this.world.add(stone);
        }

        this.cues = scene.add.graphics().setDepth(2);
        this.debugGraphics = scene.add.graphics().setDepth(16).setVisible(false);
        this.particles = scene.add.particles(0, 0, 'impact-dot', {
            emitting: false, lifespan: { min: 170, max: 320 }, speed: { min: 38, max: 115 },
            scale: { start: 0.62, end: 0 }, alpha: { start: 0.9, end: 0 },
        }).setDepth(13);
        this.world.add([this.cues, this.particles, this.debugGraphics]);

        this.healthOffset = mobile ? 94 : 0;
        this.statusX = mobile ? (VIEW.width - 228) / 2 : 24;
        const healthOffset = this.healthOffset;
        const statusX = this.statusX;
        const healthPanel = panel(scene, 24, 22 + healthOffset, 282, 115, 0x182b31).setAlpha(0.96);
        const wavePanel = panel(scene, 501, 24, 278, 61, 0x182b31).setAlpha(0.96);
        const goldPanel = panel(scene, 568, 91, 144, 35, 0x182b31, 0x746550).setAlpha(0.96);
        const relicPanel = panel(scene, 943, 22, 313, 150, 0x182b31).setAlpha(0.96);
        const statusPanel = panel(scene, statusX, 586, 228, 106, 0x182b31).setAlpha(0.96);
        this.meter = scene.add.graphics();
        this.hp = label(scene, 43, 54 + healthOffset, '', 29).setFontStyle('bold');
        this.shield = label(scene, 283, 83 + healthOffset, '', 15, COLORS.gold).setOrigin(1, 0);
        this.wave = label(scene, 640, 54, '', 21).setOrigin(0.5).setFontStyle('bold');
        this.gold = label(scene, 640, 108, '', 18, COLORS.gold).setOrigin(0.5).setFontStyle('bold');
        this.heldTitle = label(scene, 962, 36, '', 15, COLORS.gold);
        this.blessing = label(scene, 1237, 182, '', 15).setOrigin(1, 0);
        this.held = [962, 1103].map(x => label(scene, x, 63, '', 14).setLineSpacing(1));
        this.dodge = label(scene, statusX + 20, 639, '', 16, COLORS.muted).setFontStyle('bold');
        this.resolve = label(scene, statusX + 20, 597, '', 16, COLORS.gold).setFontStyle('bold');
        this.charge = label(scene, 44, 146 + healthOffset, '', 17, COLORS.gold);
        this.arcaneCharge = label(scene, 44, 173 + healthOffset, '', 16, '#d6b0fc');
        this.debug = label(scene, 20, 205, '', 15, COLORS.mint).setBackgroundColor('#102329').setVisible(false);
        this.hud.add([
            healthPanel, wavePanel, goldPanel, relicPanel, statusPanel,
            label(scene, 44, 33 + healthOffset, '战士  /  生命', 15, COLORS.muted),
            this.heldTitle, this.blessing,
            this.hp, this.shield, this.wave, this.gold, ...this.held, this.dodge, this.resolve, this.charge, this.arcaneCharge,
            this.meter, this.debug,
        ]);
        if (!mobile) this.hud.add(label(scene, 1250, 675, 'Esc  暂停', 15, COLORS.muted).setOrigin(1, 0));
    }

    private drawFloor() {
        const g = this.scene.add.graphics();
        g.fillStyle(0x253c3d).fillRect(0, 0, FIELD.width, FIELD.height);
        for (let y = 0; y < FIELD.height; y += 72) {
            for (let x = 0; x < FIELD.width; x += 72) {
                if ((x / 72 + y / 72) % 2 === 0) g.fillStyle(0x2b4443, 0.48).fillRect(x, y, 72, 72);
            }
        }
        g.lineStyle(1, 0x58706a, 0.26);
        for (let x = 0; x < FIELD.width; x += 72) g.lineBetween(x, 0, x, FIELD.height);
        for (let y = 0; y < FIELD.height; y += 72) g.lineBetween(0, y, FIELD.width, y);
        g.lineStyle(8, 0x182c31, 1).strokeRect(4, 4, FIELD.width - 8, FIELD.height - 8);
        g.lineStyle(2, 0x7d8b72, 0.52).strokeRoundedRect(17, 17, FIELD.width - 34, FIELD.height - 34, 16);
        g.lineStyle(2, 0x9f9e7c, 0.27).strokeCircle(800, 500, 127).strokeCircle(800, 500, 108);
        polygon(g, 0x3c5350, [[800, 461], [834, 500], [800, 539], [766, 500]]);
        return g;
    }

    actor(kind: TextureKind, at: Point) {
        const size = kind === 'warrior' ? WARRIOR.radius : ENEMIES[kind].radius;
        const sprite = this.scene.physics.add.sprite(at.x, at.y, `actor-${kind}`)
            .setCollideWorldBounds(true)
            .setDepth(8);
        sprite.setCircle(size, sprite.displayOriginX - size, sprite.displayOriginY - size);
        this.world.add(sprite);
        return sprite;
    }

    createWarrior(at: Point) {
        const bodySprite = this.actor('warrior', at);
        if (hasWarriorTextures(this.scene)) {
            this.warrior = new WarriorVisual(this.scene, at.x, at.y + WARRIOR.radius, WARRIOR_DRAW_SCALE, true);
            this.world.add(this.warrior.root.setDepth(8));
            bodySprite.setVisible(false);
        }
        return bodySprite;
    }

    drawWarrior(bodySprite: Phaser.Physics.Arcade.Sprite, frame: WarriorFrame) {
        if (!this.warrior) {
            bodySprite.clearTint().setFlipX(frame.mirrored);
            if (frame.tint !== undefined) bodySprite.setTint(frame.tint);
            if (frame.hitFlash) bodySprite.setTintMode(Phaser.TintModes.FILL);
            return;
        }

        if (frame.motion !== this.warriorMotion) {
            this.warriorMotion = frame.motion;
            this.warriorMotionStarted = frame.time;
        }
        const elapsed = frame.attackTime ?? frame.time - this.warriorMotionStarted;
        this.warrior.root.setPosition(bodySprite.x, bodySprite.y + WARRIOR.radius);
        const timing = frame.motion === 'ultimate' ? WARRIOR.ultimate : WARRIOR.attack;
        this.warrior.render(undefined, warriorPose(frame.motion, elapsed, timing, WARRIOR.dodge.duration), frame.mirrored);
        this.warrior.setTint(frame.tint, frame.hitFlash);
    }

    enemyHealth(enemy: EnemyView, time: number, showChill: boolean) {
        const { vital, sprite, bars } = enemy;
        bars.clear();
        const hasPoise = vital.maxPoise > 0;
        const x = sprite.x - 25;
        const y = sprite.y - (hasPoise ? sprite.displayOriginY + 3 : 24);
        bars.fillStyle(0x15252a, 0.95).fillRoundedRect(x - 2, y - 2, 54, hasPoise ? 13 : 8, 2);
        bars.fillStyle(0x5d4347).fillRect(x, y, 50, 4);
        bars.fillStyle(0xd77f77).fillRect(x, y, 50 * vital.hp / vital.maxHp, 4);
        this.drawStatuses(enemy, x, y, time, showChill);
        if (!hasPoise) return;

        const recovering = time < vital.stunUntil;
        const fill = recovering
            ? Phaser.Math.Clamp(1 - (vital.stunUntil - time) / BREAK.stun, 0, 1)
            : vital.poise / vital.maxPoise;
        bars.fillStyle(0x485759).fillRect(x, y + 6, 50, 3);
        bars.fillStyle(recovering ? 0xb1bec5 : 0xefc18a).fillRect(x, y + 6, 50 * fill, 3);
        if (time < vital.vulnerableUntil) {
            bars.lineStyle(2, 0xf1c784, 0.75).strokeCircle(sprite.x, sprite.y, 28);
        }
    }

    private drawStatuses(enemy: EnemyView, barX: number, barY: number, time: number, showChill: boolean) {
        const { bars, sprite, statuses, vital } = enemy;
        const phase = Math.sin(time * 11);
        const burning = statuses.stacks('burning', time);
        const poisoned = statuses.stacks('poison', time);
        if (burning) {
            for (let i = 0; i < burning; i += 1) {
                const x = barX + 5 + i * 6;
                const y = barY - 5;
                polygon(bars, 0xffa06d, [[x - 2, y], [x + phase, y - 5], [x + 3, y]]);
            }
        }
        if (poisoned) {
            for (let i = 0; i < poisoned; i += 1) {
                bars.lineStyle(1, 0xb4e18b, 0.95)
                    .strokeCircle(barX + 25 + (i % 3) * 6, barY - 6 - Math.floor(i / 3) * 6 + phase, 2.4);
            }
        }
        if (statuses.isSlowed(time)) {
            bars.fillStyle(0x9eddf4, 0.27).fillEllipse(sprite.x, sprite.y + 16, 42, 12);
            bars.lineStyle(1, 0xb6eeff, 0.85).strokeEllipse(sprite.x, sprite.y + 16, 42, 12);
            const x = barX + 43;
            const y = barY - 6;
            polygon(bars, 0xb6eeff, [[x, y - 3], [x + 3, y], [x, y + 3], [x - 3, y]]);
            if (sprite.body && sprite.body.velocity.lengthSq() > 0) {
                bars.fillStyle(0xc3efff, 0.65).fillCircle(sprite.x + phase * 13, sprite.y + 17, 1.6);
            }
        }
        if (showChill) {
            const stacks = statuses.chillStacks(time);
            for (let i = 0; i < FROST.chill.maxStacks; i += 1) {
                bars.fillStyle(i < stacks ? 0xa4e7fa : 0x435b68, 0.95).fillRect(barX + 9 + i * 8, barY - 18, 6, 3);
            }
        }
        if (time < vital.vulnerableUntil) bars.fillStyle(0xffd29b).fillCircle(barX + 48, barY - 5, 2.3);
        if (time < vital.markedUntil) {
            const x = barX + 59;
            const y = barY + 2;
            polygon(bars, 0xe0bcff, [[x, y - 5], [x + 4, y], [x, y + 5], [x - 4, y]]);
        }
    }

    showHit(at: Point, amount: number, tone: number, labelPrefix = '') {
        const critical = labelPrefix === '暴击 ';
        const text = label(this.scene, at.x, at.y - 38, labelPrefix + String(Number(amount.toFixed(1))), critical ? 28 : 22)
            .setOrigin(0.5).setFontStyle('bold').setStroke('#17272e', critical ? 5 : 4)
            .setColor(Phaser.Display.Color.IntegerToColor(tone).rgba).setDepth(14);
        this.world.add(text);
        this.particles.setParticleTint(tone);
        this.particles.explode(6, at.x, at.y);
        this.scene.tweens.add({ targets: text, y: '-=31', alpha: 0, duration: 540, onComplete: () => text.destroy() });
    }

    showGold(at: Point, amount: number) {
        const text = label(this.scene, at.x, at.y - 65, `+${amount} 金币`, 16, COLORS.gold)
            .setOrigin(0.5).setFontStyle('bold').setStroke('#17272e', 4).setDepth(14);
        this.world.add(text);
        this.scene.tweens.add({ targets: text, y: '-=23', alpha: 0, duration: 700, onComplete: () => text.destroy() });
    }

    showPerfectGuard(at: Point) {
        const text = label(this.scene, at.x, at.y - 48, '完美格挡', 24, '#a9fff0')
            .setOrigin(0.5).setFontStyle('bold').setStroke('#17272e', 4).setDepth(14);
        this.world.add(text);
        this.particles.setParticleTint(0xa9fff0);
        this.particles.explode(12, at.x, at.y);
        this.scene.tweens.add({ targets: text, y: '-=27', alpha: 0, duration: 540, onComplete: () => text.destroy() });
        this.showBurst(at, 48, 0x9af9e0);
    }

    showLightning(from: Point, to: Point, duration = 190) {
        const arc = this.scene.add.graphics().setDepth(13);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        arc.lineStyle(3, 0xd6b0fc, 1).beginPath().moveTo(from.x, from.y)
            .lineTo(from.x + dx * 0.38 - dy * 0.1, from.y + dy * 0.38 + dx * 0.1)
            .lineTo(from.x + dx * 0.62 + dy * 0.1, from.y + dy * 0.62 - dx * 0.1)
            .lineTo(to.x, to.y).strokePath();
        this.world.add(arc);
        this.scene.tweens.add({ targets: arc, alpha: 0, duration, onComplete: () => arc.destroy() });
    }

    showArcaneSpark(at: Point) {
        const spark = this.scene.add.graphics().setPosition(at.x, at.y).setDepth(13);
        polygon(spark, 0xd6b0fc, [[0, -13], [3, -3], [13, 0], [3, 3], [0, 13], [-3, 3], [-13, 0], [-3, -3]]);
        this.world.add(spark);
        this.scene.tweens.add({ targets: spark, scale: 1.6, alpha: 0, duration: 180, onComplete: () => spark.destroy() });
    }

    drawBlade(at: Point, heading: number, time: number) {
        this.cues.lineStyle(3, 0x8be4d4, 0.55)
            .lineBetween(at.x - 23 * Math.cos(heading), at.y - 23 * Math.sin(heading), at.x, at.y);
        const spin = time * 24;
        const dx = Math.cos(spin);
        const dy = Math.sin(spin);
        polygon(this.cues, 0xbdf7e7, [
            [at.x + 15 * dx, at.y + 15 * dy], [at.x - 6 * dy, at.y + 6 * dx],
            [at.x - 15 * dx, at.y - 15 * dy], [at.x + 6 * dy, at.y - 6 * dx],
        ]);
    }

    drawEnemyAim(at: Point, heading: number, range: number, progress: number, radius = ARCHER.projectile.radius) {
        const dx = Math.cos(heading) * range;
        const dy = Math.sin(heading) * range;
        const end = { x: at.x + dx, y: at.y + dy };
        const reach = Math.min(1, firstWallContact(at, end, OBSTACLES, radius), firstBoundaryContact(at, end, FIELD, radius));
        this.cues.lineStyle(2, 0xff646d, 0.38 + progress * 0.56)
            .lineBetween(at.x, at.y, at.x + dx * reach, at.y + dy * reach);
    }

    drawEnemyProjectile(projectile: EnemyProjectile) {
        const { x, y, heading, radius, shape } = projectile;
        if (shape === 'orb') {
            this.cues.fillStyle(0xff5767).fillCircle(x, y, radius);
            return;
        }
        const dx = Math.cos(heading) * radius;
        const dy = Math.sin(heading) * radius;
        if (shape === 'diamond') {
            polygon(this.cues, 0xff5466,
                [[x + dx, y + dy], [x + dy, y - dx], [x - dx, y - dy], [x - dy, y + dx]]);
            return;
        }
        const tailX = x - dx * 3.4, tailY = y - dy * 3.4;
        const tipX = x + dx * 0.9, tipY = y + dy * 0.9;
        const width = radius * 0.8;
        this.cues.lineStyle(width, 0xff5264).lineBetween(tailX, tailY, tipX, tipY);
        this.cues.fillStyle(0xff5264).fillCircle(tailX, tailY, width / 2).fillCircle(tipX, tipY, width / 2);
    }

    drawSpecialWarning(active: ActiveSpecialAttack, color: number, bodyRadius: number, reach: number, time: number) {
        const { attack, origin, heading } = active;
        const progress = Math.max(0, Math.min(1, 1 - (active.deadline - time) / active.tell));
        const opacity = 0.15 + progress * 0.28;
        if (attack.kind === 'volley') {
            for (const offset of attack.headings) {
                this.drawEnemyAim(origin, heading + offset * Math.PI / 180, attack.warningRange, progress, attack.projectile.radius);
            }
        } else if (active.stage !== 'tell') {
            return;
        } else if (attack.kind === 'cone') {
            sector(this.cues, origin, heading, attack.radius, attack.degrees, color, opacity);
        } else if (attack.kind === 'slam') {
            this.cues.fillStyle(color, opacity).fillCircle(origin.x, origin.y, attack.radius);
            this.cues.lineStyle(2, color, 0.9).strokeCircle(origin.x, origin.y, attack.radius)
                .strokeCircle(origin.x, origin.y, attack.radius * progress);
        } else {
            const dx = Math.cos(heading), dy = Math.sin(heading);
            const x = origin.x + dx * reach, y = origin.y + dy * reach;
            this.cues.lineStyle(2 * bodyRadius, color, opacity).lineBetween(origin.x, origin.y, x, y);
            this.cues.lineStyle(2, color, 0.85).lineBetween(origin.x, origin.y, x, y).strokeCircle(x, y, bodyRadius);
        }
    }

    showBurst(at: Point, radius: number, color: number) {
        const ring = this.scene.add.graphics().setPosition(at.x, at.y).setScale(0.35).setDepth(3);
        ring.fillStyle(color, 0.24).fillCircle(0, 0, radius);
        ring.lineStyle(3, color, 0.85).strokeCircle(0, 0, radius);
        this.world.add(ring);
        this.scene.tweens.add({
            targets: ring, scale: 1, alpha: 0, duration: 250, ease: 'Quad.Out',
            onComplete: () => ring.destroy(),
        });
    }

    showShatter(at: Point, radius: number) {
        this.showBurst(at, radius, 0x9ddff5);
        this.particles.setParticleTint(0xd8f8ff);
        this.particles.explode(14, at.x, at.y);
    }

    showExtraSlash(at: Point, heading: number, range: number, angle: number) {
        const slash = this.scene.add.graphics().setDepth(4);
        sector(slash, at, heading, range, angle, 0xdfbaf5, 0.32);
        this.world.add(slash);
        this.scene.tweens.add({ targets: slash, alpha: 0, duration: 190, onComplete: () => slash.destroy() });
    }

    showUltimateSlash(at: Point, heading: number, range: number, angle: number) {
        const slash = this.scene.add.graphics().setDepth(4);
        sector(slash, at, heading, range, angle, 0xffcf86, 0.42);
        const half = Phaser.Math.DegToRad(angle / 2);
        slash.lineStyle(7, 0xffedbd, 0.94).beginPath()
            .arc(at.x, at.y, range - 7, heading - half, heading + half).strokePath();
        this.world.add(slash);
        this.scene.tweens.add({ targets: slash, alpha: 0, duration: 310, onComplete: () => slash.destroy() });
    }

    drawEcho(at: Point, range: number, progress: number) {
        this.cues.lineStyle(1, 0x94bed5, 0.25).strokeCircle(at.x, at.y, range);
        this.cues.lineStyle(2, 0xaee8f5, 0.8).beginPath()
            .arc(at.x, at.y, range, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
            .strokePath();
    }

    private makeGhost(sprite: Phaser.Physics.Arcade.Sprite) {
        return this.warrior?.afterimage() ?? this.scene.add.image(sprite.x, sprite.y, sprite.texture.key)
            .setTint(0x99d4c0).setAlpha(0.30).setFlipX(sprite.flipX);
    }

    spawnEcho(sprite: Phaser.Physics.Arcade.Sprite, origin: Point) {
        const ghost = this.makeGhost(sprite)
            .setPosition(origin.x, origin.y + (this.warrior ? WARRIOR.radius : 0)).setAlpha(0.53);
        this.world.add(ghost.setDepth(5));
        return ghost;
    }

    trail(sprite: Phaser.Physics.Arcade.Sprite) {
        const ghost = this.makeGhost(sprite);
        this.world.add(ghost.setDepth(5));
        this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 175, onComplete: () => ghost.destroy() });
    }

    freeze(paused: boolean) {
        if (paused) {
            this.particles.pause();
            this.scene.tweens.pauseAll();
        } else {
            this.particles.resume();
            this.scene.tweens.resumeAll();
        }
    }

    updateHud(player: Vital, wave: number, remaining: number, gold: number, ids: ReadonlySet<RelicId>,
        dodge: number, dodgeCooldown: number, buffs: string, shield: number, featured?: string, blessing?: RelicFaction) {
        this.hp.setText(`${Math.ceil(player.hp)} / ${player.maxHp}`);
        this.shield.setText(shield > 0 ? `护盾 ${Number(shield.toFixed(1))}` : '');
        this.wave.setText(featured ?? (wave === 0 ? '准备开战' : `第 ${wave} / ${WAVES.length} 波   ·   剩余 ${remaining}`));
        this.gold.setText(`金币  ${gold}`);
        this.heldTitle.setText(ids.size > 9 ? `持有遗物 · ${ids.size} 件（最近 9 件）` : `持有遗物 · ${ids.size} 件`);
        this.blessing.setText(blessing ? `远征祝福 · ${RELIC_FACTION_NAMES[blessing]} ×${BLESSING_WEIGHT}` : '');
        if (blessing) this.blessing.setColor(FACTION_COLORS[blessing]);
        const held = [...ids].slice(-9).map(id => `${RELIC_FACTION_NAMES[RELIC_FACTIONS[id]]} · ${RELICS[id].label}`);
        this.held[0].setText(held.filter((_, index) => index % 2 === 0).join('\n') || '暂无遗物');
        this.held[1].setText(held.filter((_, index) => index % 2 === 1).join('\n'));
        this.charge.setText(buffs);
        const shortcut = this.mobile ? '' : 'Space  ';
        this.dodge.setText(shortcut + (dodge > 0 ? `闪避 · ${dodge.toFixed(1)} 秒` : '闪避就绪'));
        const hpBarY = 106 + this.healthOffset;
        const statusBarX = this.statusX + 20;
        this.meter.clear().fillStyle(0x34494a).fillRoundedRect(45, hpBarY, 239, 8, 4);
        const hpWidth = 239 * player.hp / player.maxHp;
        if (hpWidth > 0) this.meter.fillStyle(0xd79179).fillRoundedRect(45, hpBarY, hpWidth, 8, Math.min(4, hpWidth / 2));
        this.meter.fillStyle(0x34494a).fillRect(statusBarX, 672, 186, 5);
        this.meter.fillStyle(0x9cc4aa).fillRect(statusBarX, 672, 186 * (1 - dodge / dodgeCooldown), 5);
    }

    updateDebug(enabled: boolean, time: number, state: string, details: string) {
        this.debugGraphics.clear().setVisible(enabled);
        this.debug.setVisible(enabled);
        if (!enabled) return;
        this.debug.setText(`${Math.round(this.scene.game.loop.actualFps)} FPS  |  ${state}  |  ${time.toFixed(2)}s\n${details}`);
    }

    updateArcaneCharge(text: string, flashing: boolean) {
        this.arcaneCharge.setText(text).setColor(flashing ? '#f5dcff' : '#d6b0fc');
    }

    updateResolve(amount: number, casting: boolean) {
        const ready = amount === WARRIOR.resolve.max;
        const shortcut = this.mobile ? '' : 'Q  ';
        this.resolve.setText(shortcut + (casting ? '王庭断章 · 施放中' : ready ? '王庭断章 · 就绪' : `战意  ${amount} / ${WARRIOR.resolve.max}`));
        this.resolve.setColor(ready ? '#ffe4a4' : COLORS.gold);
        this.meter.fillStyle(0x34494a).fillRect(this.statusX + 20, 626, 186, 5);
        this.meter.fillStyle(ready ? 0xffe4a4 : 0xe3ac65).fillRect(this.statusX + 20, 626, 186 * amount / WARRIOR.resolve.max, 5);
    }

    waveBanner(wave: number, challenge: boolean, featured?: string) {
        this.banner?.destroy();
        const bar = panel(this.scene, -121, -28, 242, 56, 0x263b40, 0x7f8c77);
        const suffix = challenge ? ' · 强化战斗' : '';
        const text = heading(this.scene, 0, 0, featured ?? `第 ${wave} 波${suffix}`, 23).setOrigin(0.5);
        const banner = this.scene.add.container(640, 166, [bar, text]).setDepth(1);
        this.banner = banner;
        this.hud.add(banner);
        this.scene.tweens.add({
            targets: banner, y: 145, alpha: 0, delay: 550, duration: 350,
            onComplete: () => {
                if (this.banner === banner) this.banner = undefined;
                banner.destroy();
            },
        });
    }

    hideOverlay() {
        this.overlay?.destroy();
        this.overlay = undefined;
    }

    pauseOverlay(resume: () => void) {
        this.hideOverlay();
        this.overlay = this.scene.add.container(0, 0, [
            this.scene.add.rectangle(640, 360, VIEW.width, VIEW.height, 0x0a151b, 0.73),
            panel(this.scene, 408, 223, 464, 267),
            heading(this.scene, 640, 310, '战斗暂停', 43).setOrigin(0.5),
            button(this.scene, 525, 382, '继续游戏', resume),
        ]).setDepth(10);
        this.hud.add(this.overlay);
    }

    rewardOverlay(ids: RelicId[], prompt: string, choose: (id: RelicId) => void,
        goldOption?: { amount: number; choose: () => void }) {
        this.hideOverlay();
        const scene = this.scene;
        const children: Phaser.GameObjects.GameObject[] = [
            scene.add.rectangle(640, 360, VIEW.width, VIEW.height, 0x0a151b, 0.78),
            heading(scene, 640, 148, goldOption ? '开局补给' : '选择遗物', 48).setOrigin(0.5),
            label(scene, 640, 199, prompt, 21, COLORS.muted).setOrigin(0.5),
        ];
        const cards = ids.map(id => ({
            id, ...RELICS[id], action: () => choose(id), buttonText: '选择', border: 0x657969,
        }));
        const options = goldOption ? [...cards, {
            id: undefined, icon: '◇', label: `${goldOption.amount} 金币`, description: '存入本局钱包\n可在商店购买遗物',
            action: goldOption.choose, buttonText: '金币开局', border: 0xa98a61,
        }] : cards;
        options.forEach(({ id, icon, label: title, description, action, buttonText, border }, index) => {
            const width = 255;
            const x = 640 + (index - (options.length - 1) / 2) * 283;
            const card = panel(scene, x - width / 2, 258, width, 265, 0x243a3f, border);
            children.push(
                card,
                label(scene, x, 324, icon, 43, COLORS.gold).setOrigin(0.5),
                heading(scene, x, 371, title, 24).setOrigin(0.5),
                label(scene, x, 417, description, 17, COLORS.muted).setOrigin(0.5).setAlign('center'),
                button(scene, x - 74, 457, buttonText, action, 148),
            );
            if (id) children.push(factionBadge(scene, x, 279, id));
        });
        this.overlay = scene.add.container(0, 0, children).setDepth(10);
        this.hud.add(this.overlay);
    }

    blessingOverlay(factions: readonly RelicFaction[], choose: (faction: RelicFaction) => void) {
        const scene = this.scene;
        const children: Phaser.GameObjects.GameObject[] = [
            heading(scene, 640, 169, '远征祝福', 46).setOrigin(0.5),
            label(scene, 640, 228, `免费选择一个派系，该派系遗物的抽取权重本局 ×${BLESSING_WEIGHT}`,
                20, COLORS.muted).setOrigin(0.5),
        ];
        factions.forEach((faction, index) => {
            const x = 640 + (index - (factions.length - 1) / 2) * 278;
            children.push(
                panel(scene, x - 124, 286, 248, 214, 0x243a3f, 0x657969),
                heading(scene, x, 352, RELIC_FACTION_NAMES[faction], 36).setColor(FACTION_COLORS[faction]).setOrigin(0.5),
                button(scene, x - 74, 411, '选择', () => choose(faction), 148),
            );
        });
        this.showMenu(children);
    }

    eventOverlay(cleared: number, cards: readonly EventCard[], choose: (card: EventCard) => void) {
        const scene = this.scene;
        const next = cleared + 1;
        const prompt = `进入第 ${next} 波前，选择一张事件卡`;
        const rewardDetail = hasFutureShop(cleared)
            ? `50% · ${REWARD_BASE_GOLD} 金币和一件遗物\n50% · ${cashCardPayout(cleared)} 金币`
            : `恢复 ${percent(LATE_REWARD_HEAL)}% 最大生命\n从最多两件遗物中选一件`;
        const children: Phaser.GameObjects.GameObject[] = [
            heading(scene, 640, 149, `第 ${cleared} 波已清场`, 44).setOrigin(0.5),
            label(scene, 640, 201, prompt, 20, COLORS.muted).setOrigin(0.5),
        ];
        cards.forEach((card, index) => {
            const { title, icon, detail, accent } = EVENT_CARDS[card];
            const x = 640 + (index - (cards.length - 1) / 2) * 324;
            children.push(
                panel(scene, x - 148, 250, 296, 283, 0x243a3f, accent),
                label(scene, x, 304, icon, 40, COLORS.gold).setOrigin(0.5),
                heading(scene, x, 357, title, 28).setOrigin(0.5),
                label(scene, x, 411, card === 'reward' ? rewardDetail : detail, 17, COLORS.muted).setOrigin(0.5).setAlign('center'),
                button(scene, x - 82, 458, `选择${title}`, () => choose(card), 164),
            );
        });
        this.showMenu(children);
    }

    lootOverlay(reward: EventReward, proceed: () => void) {
        const scene = this.scene;
        const relic = reward.kind === 'relic' ? RELICS[reward.id] : undefined;
        const title = reward.kind === 'gold' ? `+${reward.amount} 金币`
            : `${RELICS[reward.id].label}${reward.gold ? ` · +${reward.gold} 金币` : ''}`;
        const children: Phaser.GameObjects.GameObject[] = [
            panel(scene, 408, 182, 464, 357, 0x243a3f, 0x8e795b),
            heading(scene, 640, 227, '获得奖励', 32).setOrigin(0.5),
            label(scene, 640, 296, relic?.icon ?? '◇', 43, COLORS.gold).setOrigin(0.5),
            heading(scene, 640, 354, title, 28).setOrigin(0.5),
            label(scene, 640, 405, relic?.description ?? '已存入本局金币余额', 17, COLORS.muted)
                .setOrigin(0.5).setAlign('center'),
            button(scene, 525, 463, '继续', proceed),
        ];
        if (reward.kind === 'relic') children.push(factionBadge(scene, 640, 258, reward.id));
        this.showMenu(children);
    }

    restOverlay(title: string, recovered: number, player: Vital, proceed: () => void) {
        const scene = this.scene;
        this.showMenu([
            panel(scene, 408, 182, 464, 357, 0x243a3f, 0x94be9e),
            label(scene, 640, 256, '✚', 43, COLORS.mint).setOrigin(0.5),
            heading(scene, 640, 322, title, 32).setOrigin(0.5),
            label(scene, 640, 384,
                `恢复 ${Number(recovered.toFixed(1))} 生命   ·   ${hpLine(player)}`, 20, COLORS.mint).setOrigin(0.5),
            button(scene, 525, 454, '开始下一波', proceed),
        ]);
    }

    encounterOverlay(session: EncounterSession, context: EncounterContext, choose: (index: number) => void) {
        const scene = this.scene;
        const { title, description, category, choices } = session.event;
        const children: Phaser.GameObjects.GameObject[] = [
            panel(scene, 244, 129, 792, 473, 0x1b3036, 0x647a7c),
            label(scene, 640, 170, ENCOUNTER_ICONS[category], 30, COLORS.gold).setOrigin(0.5),
            heading(scene, 640, 210, title, 36).setOrigin(0.5),
            label(scene, 640, 252, description, 18, COLORS.muted).setOrigin(0.5),
            label(scene, 640, 282, `金币 ${context.economy.gold}   ·   ${hpLine(context.player)}`, 17, COLORS.gold).setOrigin(0.5),
        ];
        choices.forEach((choice, index) => {
            const y = 309 + index * 91;
            const blocked = session.choiceBlock(index, context);
            children.push(
                panel(scene, 278, y, 724, 81, 0x243a3f, blocked ? 0x465759 : 0x687b72),
                label(scene, 298, y + 10, choice.detail, 17).setLineSpacing(2),
                button(scene, 792, y + 12, choice.label, blocked ? undefined : () => choose(index), 192),
            );
            if (blocked) children.push(label(scene, 298, y + 56, blocked, 14, '#edaa99'));
        });
        this.showMenu(children);
    }

    encounterResultOverlay(title: string, result: EncounterResult, context: EncounterContext, proceed: () => void) {
        const scene = this.scene;
        this.showMenu([
            panel(scene, 350, 146, 580, 438, 0x243a3f, 0x8e795b),
            heading(scene, 640, 220, title, 36).setOrigin(0.5),
            label(scene, 640, 265, result.action, 19, COLORS.gold).setOrigin(0.5),
            label(scene, 640, 340, result.summary.join('\n'), 20).setOrigin(0.5).setAlign('center').setLineSpacing(10),
            label(scene, 640, 439, `金币 ${context.economy.gold}   ·   ${hpLine(context.player)}`, 18, COLORS.gold).setOrigin(0.5),
            button(scene, 525, 485, '开始下一波', proceed),
        ]);
    }

    shopOverlay(next: number, gold: number, offers: readonly (Readonly<ShopOffer> | null)[], canRefresh: boolean,
        supply: { player: Vital; claimed?: ShopSupply; hasUnownedRelic: boolean; choose: (kind: ShopSupply['kind']) => void },
        buy: (index: number) => void, refresh: () => void, leave: () => void) {
        const scene = this.scene;
        const { player, claimed, hasUnownedRelic, choose } = supply;
        const children: Phaser.GameObjects.GameObject[] = [
            heading(scene, 640, 99, '整备商店', 44).setOrigin(0.5),
            label(scene, 640, 145, `金币 ${gold}   ·   ${hpLine(player)}   ·   下一波为第 ${next} 波`, 20, COLORS.gold).setOrigin(0.5),
            panel(scene, 233, 167, 814, 68, 0x1b3036, 0x607871),
            label(scene, 255, 201, claimed ? '已领取补给' : '免费补给 · 二选一', 19, COLORS.mint).setOrigin(0, 0.5),
        ];
        if (claimed) {
            const receipt = claimed.kind === 'heal' ? `恢复 ${Number(claimed.amount.toFixed(1))} 生命`
                : `获得遗物 · ${RELIC_FACTION_NAMES[RELIC_FACTIONS[claimed.id]]} · ${RELICS[claimed.id].label}`;
            children.push(label(scene, 705, 201, receipt, 22, COLORS.mint).setOrigin(0.5));
        } else {
            const canHeal = player.hp < player.maxHp;
            children.push(
                button(scene, 437, 173, canHeal ? `恢复 ${percent(REST_FRACTION)}% 最大生命` : '生命已满',
                    canHeal ? () => choose('heal') : undefined, 282),
                button(scene, 739, 173, hasUnownedRelic ? '获得随机遗物' : '遗物已集齐',
                    hasUnownedRelic ? () => choose('relic') : undefined, 282),
            );
        }
        offers.forEach((offer, index) => {
            const x = 170 + index * 235;
            const relic = offer && RELICS[offer.id];
            const sold = offer?.sold ?? false;
            const canBuy = offer && !sold && gold >= offer.price;
            children.push(
                panel(scene, x - 110, 244, 220, 275, sold ? 0x1b2e34 : 0x243a3f, sold ? 0x405354 : 0x657969),
                label(scene, x, 295, sold ? '—' : relic?.icon ?? '—', 33, sold ? COLORS.muted : COLORS.gold).setOrigin(0.5),
                heading(scene, x, 334, sold ? '已售罄' : relic?.label ?? '空栏位', 21).setOrigin(0.5),
                label(scene, x, 385, sold ? '' : relic?.description ?? '暂无商品', 15, COLORS.muted)
                    .setOrigin(0.5).setAlign('center').setWordWrapWidth(192, true),
                label(scene, x, 437, offer && !sold ? `${offer.price} 金币` : '', 17, COLORS.gold).setOrigin(0.5),
                button(scene, x - 82, 452, sold ? '已购买' : !offer ? '无库存' : canBuy ? '购买' : '金币不足',
                    canBuy ? () => buy(index) : undefined, 164),
            );
            if (offer && !sold) children.push(factionBadge(scene, x, 262, offer.id));
        });
        children.push(
            button(scene, 371, 555, `刷新 · ${REFRESH_COST} 金币`, canRefresh ? refresh : undefined, 250),
            button(scene, 659, 555, `离开并开始第 ${next} 波`, leave, 250),
            label(scene, 640, 636, !canRefresh && gold >= REFRESH_COST ? '当前没有可刷新的库存' : '售罄栏位保留至离店',
                16, COLORS.muted).setOrigin(0.5),
        );
        this.showMenu(children);
    }

    private showMenu(children: Phaser.GameObjects.GameObject[]) {
        this.hideOverlay();
        const shade = this.scene.add.rectangle(640, 360, VIEW.width, VIEW.height, 0x0a151b, 0.83);
        this.overlay = this.scene.add.container(0, 0, [shade, ...children]).setDepth(10);
        this.hud.add(this.overlay);
    }
}
