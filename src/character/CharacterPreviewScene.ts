import Phaser from 'phaser';
import { REFERENCE, type PartId, type Rig } from './warriorRig';
import { loadWarriorTextures, PREVIEW_ATTACK, warriorPose, WarriorVisual, type Motion } from './warriorVisual';

export const STAGE = { width: 1020, height: 720 };
const FIGURE_SCALE = 0.89;
const BASELINE = 657;
const ATTACK_DURATION = PREVIEW_ATTACK.windup + PREVIEW_ATTACK.active + PREVIEW_ATTACK.recovery;

export type PreviewMotion = Exclude<Motion, 'dodge'>;
export interface PreviewState {
    rig: Rig;
    motion: PreviewMotion;
    revision: number;
    selected: PartId;
    mirrored: boolean;
    showPivot: boolean;
    onAttackComplete: () => void;
    onLoadError: (file: string) => void;
}

export class CharacterPreviewScene extends Phaser.Scene {
    private actor!: WarriorVisual;
    private marker!: Phaser.GameObjects.Graphics;
    private elapsed = 0;
    private lastRevision = -1;

    constructor(private readonly state: PreviewState) {
        super('character-preview');
    }

    preload() {
        this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => this.state.onLoadError(file.key));
        loadWarriorTextures(this);
        this.load.image('reference', import.meta.env.BASE_URL + REFERENCE.asset);
    }

    create() {
        const background = this.add.graphics();
        for (const left of [12, 514]) {
            background.fillStyle(0xe6ebed).fillRoundedRect(left, 12, 494, 696, 14);
            background.lineStyle(1, 0xb8c5ca).strokeRoundedRect(left, 12, 494, 696, 14);
            background.lineStyle(1, 0x9aaeb7, 0.63).lineBetween(left + 22, BASELINE, left + 472, BASELINE);
        }
        this.title(32, '图集原始角色');
        this.title(534, 'Phaser 分层组装');
        this.add.image(249, BASELINE, 'reference')
            .setOrigin(REFERENCE.pivotX, REFERENCE.pivotY).setScale(FIGURE_SCALE);

        this.actor = new WarriorVisual(this, 755, BASELINE, FIGURE_SCALE);
        this.marker = this.add.graphics().setDepth(10);
        this.update(0, 0);
    }

    private title(x: number, value: string) {
        this.add.text(x, 28, value, {
            color: '#273e49', fontSize: 20, fontStyle: 'bold', fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
        });
    }

    update(_time: number, delta: number) {
        const { motion, revision, rig, mirrored, selected, showPivot } = this.state;
        if (revision !== this.lastRevision) {
            this.lastRevision = revision;
            this.elapsed = 0;
        }
        this.elapsed += Math.min(delta, 50) / 1000;
        this.actor.render(rig, warriorPose(motion, this.elapsed), mirrored);

        this.marker.clear();
        if (showPivot) {
            const { x, y } = this.actor.pivot(selected);
            this.marker.lineStyle(2, 0x006482).strokeCircle(x, y, 9)
                .lineBetween(x - 14, y, x + 14, y).lineBetween(x, y - 14, x, y + 14);
        }

        if (motion === 'attack' && this.elapsed >= ATTACK_DURATION) this.state.onAttackComplete();
    }
}
