import Phaser from 'phaser';
import { playCue } from './audio.ts';
import { RELIC_FACTIONS, RELIC_FACTION_NAMES, RELICS, type RelicFaction, type RelicId } from './config';

export const COLORS = {
    background: 0x142329,
    panel: 0x1b3036,
    border: 0x415555,
    ink: '#f8eedb',
    muted: '#b5c2b8',
    gold: '#f0c890',
    mint: '#b5d9b2',
};

export const FACTION_COLORS: Record<RelicFaction, string> = {
    martial: '#f2c784',
    fire: '#ffa88a',
    nature: '#b5df9c',
    frost: '#abe2f4',
    arcane: '#dfbcff',
    break: '#e4b5a3',
    technique: '#98dece',
    survival: '#efd0d4',
};

export function label(scene: Phaser.Scene, x: number, y: number, value: string, size = 20, color = COLORS.ink) {
    return scene.add.text(x, y, value, {
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif',
        fontSize: size,
        color,
    });
}

export function panel(
    scene: Phaser.Scene, x: number, y: number, width: number, height: number,
    fill = COLORS.panel, stroke = COLORS.border,
) {
    const graphics = scene.add.graphics();
    graphics.fillStyle(fill, 1).fillRoundedRect(x, y, width, height, 14);
    graphics.lineStyle(1, stroke, 1).strokeRoundedRect(x, y, width, height, 14);
    return graphics;
}

export function button(
    scene: Phaser.Scene, x: number, y: number, text: string, action: (() => void) | undefined,
    width = 230, height = 56,
) {
    const surface = scene.add.graphics();
    const draw = (hover: boolean) => {
        surface.clear().fillStyle(action ? (hover ? 0xfbe0b0 : 0xf0c890) : 0x35484a)
            .fillRoundedRect(0, 0, width, height, 10);
    };
    draw(false);
    const title = label(scene, width / 2, height / 2, text, 22, action ? '#213034' : COLORS.muted)
        .setFontStyle('bold').setOrigin(0.5);
    const root = scene.add.container(x, y, [surface, title]);
    if (!action) return root;
    root.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    if (root.input) root.input.cursor = 'pointer';
    root.on('pointerover', () => draw(true));
    root.on('pointerout', () => draw(false));
    root.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button === 0) {
            playCue('ui');
            action();
        }
    });
    return root;
}

export function heading(scene: Phaser.Scene, x: number, y: number, value: string, size: number) {
    return label(scene, x, y, value, size)
        .setFontFamily('"Microsoft YaHei UI", "PingFang SC", serif')
        .setFontStyle('bold');
}

export function factionBadge(scene: Phaser.Scene, x: number, y: number, id: RelicId) {
    const faction = RELIC_FACTIONS[id];
    return label(scene, x, y, RELIC_FACTION_NAMES[faction], 14, FACTION_COLORS[faction])
        .setBackgroundColor('#16292e').setPadding(8, 2, 8, 2).setOrigin(0.5);
}

const relicTextureKey = (id: RelicId) => `relic-${id}`;
const COIN_TEXTURE = 'currency-gold';

export function loadCoinTexture(scene: Phaser.Scene) {
    if (!scene.textures.exists(COIN_TEXTURE)) {
        scene.load.image(COIN_TEXTURE, `${import.meta.env.BASE_URL}assets/ui/coin.png`);
    }
}

export function coinIcon(scene: Phaser.Scene, x: number, y: number, size: number) {
    return scene.textures.exists(COIN_TEXTURE)
        ? scene.add.image(x, y, COIN_TEXTURE).setDisplaySize(size, size)
        : label(scene, x, y, '◇', Math.round(size * 0.65), COLORS.gold).setOrigin(0.5);
}

export function coinLabel(scene: Phaser.Scene, x: number, y: number, value: string, size: number, floating = false) {
    const text = label(scene, (size + 6) / 2, 0, value, size, COLORS.gold).setOrigin(0.5);
    if (floating) text.setFontStyle('bold').setStroke('#17272e', 4);
    return scene.add.container(x, y, [coinIcon(scene, -(text.width + 6) / 2, 0, size + 2), text]);
}

export function loadRelicTextures(scene: Phaser.Scene) {
    for (const id of Object.keys(RELIC_FACTIONS) as RelicId[]) {
        const key = relicTextureKey(id);
        if (!scene.textures.exists(key)) {
            scene.load.image(key, `${import.meta.env.BASE_URL}assets/relics/${RELIC_FACTIONS[id]}/${id}.png`);
        }
    }
}

export function relicIcon(scene: Phaser.Scene, x: number, y: number, id: RelicId, size: number) {
    const key = relicTextureKey(id);
    return scene.textures.exists(key)
        ? scene.add.image(x, y, key).setDisplaySize(size, size)
        : label(scene, x, y, RELICS[id].icon, Math.round(size * 0.65), COLORS.gold).setOrigin(0.5);
}
