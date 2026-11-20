import Phaser from 'phaser';
import { hasWarriorTextures, loadWarriorTextures, WarriorVisual } from '../../character/warriorVisual';
import { COLORS, button, heading, label, panel, relicRows } from '../ui';
import { ENEMIES, RELICS, VIEW, WAVES, type RelicId } from '../config';
import { SPECIAL_PATTERNS, isSpecialEnemy, type SpecialEnemyKind } from '../enemyPatterns';
import { DIFFICULTIES, isTrialUnlocked, type Difficulty } from '../difficulty';
import type { EventReward } from '../expedition';
import { ensureTextures } from '../view';

export interface RunResult {
    victory: boolean;
    time: number;
    kills: number;
    gold: number;
    relics: RelicId[];
    finalReward?: EventReward;
    testEnemy?: SpecialEnemyKind;
    difficulty: Difficulty;
    unlockedTrial: boolean;
}

function backdrop(scene: Phaser.Scene) {
    const graphics = scene.add.graphics();
    graphics.fillStyle(0x122025).fillRect(0, 0, VIEW.width, VIEW.height);
    graphics.lineStyle(1, 0x39524f, 0.4);
    for (let x = 48; x < VIEW.width; x += 48) graphics.lineBetween(x, 0, x, VIEW.height);
    for (let y = 48; y < VIEW.height; y += 48) graphics.lineBetween(0, y, VIEW.width, y);
    graphics.lineStyle(1, 0x66796e, 0.7).strokeRoundedRect(42, 36, 1196, 648, 18);
    graphics.lineStyle(1, 0x56716a, 0.45).strokeRoundedRect(52, 46, 1176, 628, 14);
}

export class MainMenuScene extends Phaser.Scene {
    constructor() { super('menu'); }

    preload() { loadWarriorTextures(this); }

    create() {
        backdrop(this);
        ensureTextures(this);
        if (new URLSearchParams(window.location.search).get('debug') === 'enemies') {
            heading(this, 640, 148, '敌人调试场', 56).setOrigin(0.5);
            label(this, 640, 219, '按基础属性生成一名敌人 · WASD 移动 · 鼠标攻击 · Space 闪避', 20, COLORS.muted)
                .setOrigin(0.5);
            Object.keys(SPECIAL_PATTERNS).filter(isSpecialEnemy).forEach((kind, index) => {
                const x = 365 + index % 2 * 283;
                const y = 276 + Math.floor(index / 2) * 83;
                button(this, x, y, ENEMIES[kind].label, () => this.scene.start('battle', { testEnemy: kind }), 266);
            });
            return;
        }
        const art = this.add.graphics();
        const x = 950;
        const y = 351;
        art.fillStyle(0x1c3539).fillCircle(x, y, 187);
        art.lineStyle(2, 0x56746b).strokeCircle(x, y, 188);
        art.lineStyle(1, 0x799184, 0.65).strokeCircle(x, y, 217).strokeCircle(x, y, 157);
        art.lineStyle(1, 0xad9272, 0.5);
        art.lineBetween(x - 217, y, x + 217, y);
        art.lineBetween(x, y - 217, x, y + 217);
        for (let i = 0; i < 8; i += 1) {
            const angle = i * Math.PI / 4;
            art.fillStyle(0xd6b785, 0.75).fillCircle(x + 202 * Math.cos(angle), y + 202 * Math.sin(angle), 3);
        }
        if (hasWarriorTextures(this)) {
            new WarriorVisual(this, x + 3, y + 102, 0.31);
        } else {
            this.add.image(x + 3, y - 7, 'actor-warrior').setScale(3.6);
        }
        this.add.image(x - 133, y + 99, 'actor-slime').setScale(1.3);
        this.add.image(x + 141, y - 87, 'actor-skeleton').setScale(1.35).setFlipX(true);

        label(this, 108, 122, 'LITTLE EXPEDITION', 17, COLORS.gold).setLetterSpacing(4);
        heading(this, 103, 151, '小小远征', 80);
        label(this, 109, 262, `战士试炼 · ${WAVES.length} 波生存战`, 26, COLORS.muted);
        const trialUnlocked = isTrialUnlocked();
        button(this, 108, 326, '普通 · 开始', () => this.scene.start('battle', { difficulty: 'normal' }), 212);
        button(this, 337, 326, trialUnlocked ? '磨砺 · 开始' : '磨砺 · 未解锁',
            trialUnlocked ? () => this.scene.start('battle', { difficulty: 'trial' }) : undefined, 212);
        label(this, 109, 396, trialUnlocked ? '磨砺 · 敌人更强，弹幕更快' : '通关普通难度后解锁磨砺', 17, COLORS.muted);

        const controls = [
            ['WASD', '移动'], ['鼠标', '瞄准'], ['左键', '挥剑 / 长按连击'],
            ['右键', '坚守反击'], ['Space', '闪避'], ['Q', '王庭断章'], ['Esc', '暂停'],
        ];
        label(this, 110, 439, '操作说明', 17, COLORS.gold).setFontStyle('bold');
        controls.forEach(([key, action], index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            label(this, 110 + col * 206, 481 + row * 39, key, 17).setFontStyle('bold');
            label(this, 184 + col * 206, 481 + row * 39, action, 17, COLORS.muted);
        });
    }
}

export class ResultScene extends Phaser.Scene {
    constructor() { super('result'); }

    create(result: RunResult) {
        backdrop(this);
        panel(this, 260, 68, 760, 584);
        const center = 640;
        const tone = result.victory ? COLORS.gold : '#f0a99c';
        if (result.finalReward) {
            const reward = result.finalReward.kind === 'relic'
                ? RELICS[result.finalReward.id].label : `+${result.finalReward.amount} 金币`;
            label(this, center, 115, `✦  最终强化奖励 · ${reward}`, 21, tone).setOrigin(0.5);
        } else {
            label(this, center, 115, result.victory ? '✦' : '◇', 40, tone).setOrigin(0.5);
        }
        heading(this, center, 187, result.victory ? '远征胜利' : '远征失败', 63).setOrigin(0.5);
        if (!result.testEnemy) {
            const difficulty = DIFFICULTIES[result.difficulty].label;
            const text = result.unlockedTrial ? `${difficulty} · 已解锁磨砺` : difficulty;
            label(this, center, 239, text, 17, result.unlockedTrial ? COLORS.gold : COLORS.muted).setOrigin(0.5);
        }
        const minutes = Math.floor(result.time / 60);
        const seconds = Math.floor(result.time % 60).toString().padStart(2, '0');
        label(this, 448, 270, '存活时间', 18, COLORS.muted).setOrigin(0.5);
        label(this, center, 270, '击败敌人', 18, COLORS.muted).setOrigin(0.5);
        label(this, 832, 270, '结算金币', 18, COLORS.muted).setOrigin(0.5);
        heading(this, 448, 313, `${minutes}:${seconds}`, 35).setOrigin(0.5);
        heading(this, center, 313, String(result.kills), 35).setOrigin(0.5);
        heading(this, 832, 313, String(result.gold), 35).setOrigin(0.5);
        label(this, center, 366, `已获得遗物 · ${result.relics.length}`, 17, COLORS.muted).setOrigin(0.5);
        label(this, center, 395, relicRows(result.relics, 7, '无'), 17, tone)
            .setOrigin(0.5, 0).setAlign('center').setLineSpacing(4);
        if (result.testEnemy) {
            button(this, 390, 576, '重测该敌人', () => this.scene.start('battle', { testEnemy: result.testEnemy }));
            button(this, 660, 576, '返回调试场', () => this.scene.start('menu'));
        } else {
            button(this, 390, 576, '重新开始  →', () => this.scene.start('battle', { difficulty: result.difficulty }));
            button(this, 660, 576, '返回主菜单', () => this.scene.start('menu'));
        }
    }
}
