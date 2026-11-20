import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { MainMenuScene, ResultScene } from './scenes/Screens';
import { VIEW } from './config';

export default function startGame(parent: string) {
    return new Phaser.Game({
        type: Phaser.AUTO,
        ...VIEW,
        parent,
        backgroundColor: '#101b20',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        input: { mouse: { preventDefaultDown: true, preventDefaultUp: true } },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 }, fixedStep: true, fps: 60, customUpdate: true },
        },
        scene: [MainMenuScene, BattleScene, ResultScene],
    });
}
