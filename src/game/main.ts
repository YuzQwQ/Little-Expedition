import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { MainMenuScene, ResultScene } from './scenes/Screens';
import { VIEW } from './config';
import { mountFullscreen } from './fullscreen';
import { mountRotation, prepareRotation } from './rotation';

export default function startGame(parent: string) {
    const container = document.getElementById(parent);
    // The rotation class has to be on the DOM first: Phaser measures the parent box while booting.
    if (container) prepareRotation(container);
    const game = new Phaser.Game({
        type: Phaser.AUTO,
        ...VIEW,
        parent,
        backgroundColor: '#101b20',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
        input: { mouse: { preventDefaultDown: true, preventDefaultUp: true } },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 }, fixedStep: true, fps: 60, customUpdate: true },
        },
        scene: [MainMenuScene, BattleScene, ResultScene],
    });
    if (container) {
        const refreshScale = () => {
            game.scale.getParentBounds();
            game.scale.refresh();
        };
        const cleanup = mountFullscreen(container, refreshScale);
        const stopRotation = mountRotation(game);
        game.events.once(Phaser.Core.Events.DESTROY, () => {
            cleanup();
            stopRotation();
        });
    }
    return game;
}
