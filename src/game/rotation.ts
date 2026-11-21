import type Phaser from 'phaser';
import { getSettings, rotationDegrees, SETTINGS_CHANGED } from './settings.ts';

const PORTRAIT_QUERY = '(orientation: portrait)';
const CLASS_ROTATED = 'game-rotated';
const CLASS_CW = 'game-rotated-cw';
const CLASS_CCW = 'game-rotated-ccw';
const CLASS_OVERLAY = 'game-overlay';

let portraitQuery: MediaQueryList | undefined;

function portrait() {
    if (typeof matchMedia !== 'function') return undefined;
    if (!portraitQuery) portraitQuery = matchMedia(PORTRAIT_QUERY);
    return portraitQuery;
}

function viewportIsPortrait() {
    return portrait()?.matches ?? false;
}

/**
 * CSS rotation in degrees (clockwise), or 0 when the picture should stay upright.
 *
 * A browser that refuses to rotate its layout keeps the game in a portrait window, so the
 * player has to turn the phone by hand. Rotating only makes sense while the viewport is
 * actually portrait, which also keeps desktop players and browsers that do rotate untouched.
 */
export function screenRotation() {
    const degrees = rotationDegrees(getSettings().rotate);
    return degrees !== 0 && viewportIsPortrait() ? degrees : 0;
}

/** The same rotation in radians, for turning pointer offsets back into game space. */
export function screenRotationRadians() {
    return screenRotation() * Math.PI / 180;
}

function markRotation(degrees: number) {
    const root = document.documentElement.classList;
    root.toggle(CLASS_ROTATED, degrees !== 0);
    root.toggle(CLASS_CW, degrees > 0);
    root.toggle(CLASS_CCW, degrees < 0);
}

/**
 * Overlay for the HTML buttons and sticks. The script keeps it the size of the measured game frame,
 * so its corners line up with what the player actually sees rather than the unrotated container box.
 */
export function overlayRoot(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>(`:scope > .${CLASS_OVERLAY}`) ?? container;
}

function ensureOverlay(container: HTMLElement) {
    const existing = container.querySelector<HTMLElement>(`:scope > .${CLASS_OVERLAY}`);
    if (existing) return existing;
    const overlay = document.createElement('div');
    overlay.className = CLASS_OVERLAY;
    container.append(overlay);
    return overlay;
}

/** Puts the rotation class on the DOM before Phaser measures the parent, so the first frame is not laid out portrait. */
export function prepareRotation(container: HTMLElement) {
    const degrees = screenRotation();
    markRotation(degrees);
    ensureOverlay(container);
    return degrees;
}

export function mountRotation(game: Phaser.Game) {
    const container = game.canvas.parentElement;
    if (!container) return () => undefined;
    const overlay = ensureOverlay(container);
    const input = game.input;
    const originalTransform = input.transformPointer;
    let angle = 0;

    // A CSS rotation only moves pixels; Phaser still maps pointers through the canvas bounding box,
    // so rotated input has to be folded back into the unrotated canvas frame by hand.
    const toGame = (pageX: number, pageY: number) => {
        const { displaySize, gameSize } = game.scale;
        const rect = game.canvas.getBoundingClientRect();
        const width = displaySize.width;
        const height = displaySize.height;
        const theta = -angle * Math.PI / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const dx = pageX - (window.scrollX || 0) - (rect.left + rect.width / 2);
        const dy = pageY - (window.scrollY || 0) - (rect.top + rect.height / 2);
        return {
            x: (dx * cos - dy * sin + width / 2) * (gameSize.width / width),
            y: (dx * sin + dy * cos + height / 2) * (gameSize.height / height),
        };
    };

    input.transformPointer = (pointer, pageX, pageY, wasMove) => {
        if (!angle) {
            originalTransform.call(input, pointer, pageX, pageY, wasMove);
            return;
        }
        const previous = pointer.prevPosition;
        const current = pointer.position;
        previous.x = current.x;
        previous.y = current.y;
        const mapped = toGame(pageX, pageY);
        const smooth = pointer.smoothFactor;
        if (!wasMove || smooth === 0) {
            current.x = mapped.x;
            current.y = mapped.y;
        } else {
            current.x = mapped.x * smooth + previous.x * (1 - smooth);
            current.y = mapped.y * smooth + previous.y * (1 - smooth);
        }
    };

    const sync = () => {
        angle = screenRotation();
        markRotation(angle);
        // Phaser caches the parent box, and rotating changes it, so remeasure before resizing the canvas.
        game.scale.getParentBounds();
        game.scale.refresh();
        const frame = game.scale.parentSize;
        overlay.style.width = `${frame.width}px`;
        overlay.style.height = `${frame.height}px`;
    };
    const query = portrait();
    document.addEventListener(SETTINGS_CHANGED, sync);
    document.addEventListener('fullscreenchange', sync);
    query?.addEventListener('change', sync);
    sync();

    return () => {
        angle = 0;
        markRotation(0);
        input.transformPointer = originalTransform;
        document.removeEventListener(SETTINGS_CHANGED, sync);
        document.removeEventListener('fullscreenchange', sync);
        query?.removeEventListener('change', sync);
        const root = document.documentElement.classList;
        root.remove(CLASS_ROTATED, CLASS_CW, CLASS_CCW);
        overlay.remove();
    };
}
