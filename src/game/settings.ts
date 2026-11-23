export type ControlMode = 'auto' | 'desktop' | 'mobile';
export const BATTLE_ZOOMS = [1, 1.2, 1.4, 1.6] as const;
export type BattleZoom = typeof BATTLE_ZOOMS[number];
export type RotationMode = 'none' | 'cw' | 'ccw';

export const ROTATION_ANGLES: Record<RotationMode, number> = { none: 0, cw: 90, ccw: -90 };
export const ROTATION_OPTIONS: { value: RotationMode; label: string }[] = [
    { value: 'none', label: '不旋转' },
    { value: 'cw', label: '顺时针 90°' },
    { value: 'ccw', label: '逆时针 90°' },
];

export interface GameSettings {
    controls: ControlMode;
    zoom: BattleZoom;
    rotate: RotationMode;
    sound: boolean;
}

const SETTINGS_KEY = 'little-expedition-settings-v1';
export const SETTINGS_CHANGED = 'little-expedition-settings-changed';
let current: GameSettings | undefined;

export function normalizeSettings(value?: Partial<GameSettings> | null): GameSettings {
    const controls = value?.controls === 'desktop' || value?.controls === 'mobile' ? value.controls : 'auto';
    const zoom = BATTLE_ZOOMS.find(option => option === value?.zoom) ?? 1;
    const rotate: RotationMode = value?.rotate === 'cw' || value?.rotate === 'ccw' ? value.rotate : 'none';
    const sound = value?.sound !== false;
    return { controls, zoom, rotate, sound };
}

export function rotationDegrees(mode: RotationMode) {
    return ROTATION_ANGLES[mode] ?? 0;
}

export function getSettings() {
    if (current) return current;
    try {
        current = normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'));
    } catch {
        current = normalizeSettings();
    }
    return current;
}

export function setSettings(settings: GameSettings) {
    current = normalizeSettings(settings);
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    } catch {
        // Settings still apply for this session when storage is unavailable.
    }
    document.dispatchEvent(new Event(SETTINGS_CHANGED));
}

export function usesMobileControls(mode: ControlMode, coarse = matchMedia('(pointer: coarse)').matches) {
    return mode === 'mobile' || (mode === 'auto' && coarse);
}

export interface SettingsPanel {
    open(): void;
    close(): void;
    isOpen(): boolean;
    destroy(): void;
}

let panelCount = 0;

/**
 * The settings dialog on its own, so the pause menu can open it without a second floating button.
 * `controls: false` hides the 操作端 row: switching input mid-run would need a rebuilt HUD.
 */
export function createSettingsPanel(
    parent: HTMLElement, onChange: () => void, options: { controls?: boolean } = {},
): SettingsPanel {
    panelCount += 1;
    const headingId = `game-settings-heading-${panelCount}`;
    const dialog = document.createElement('dialog');
    dialog.className = 'game-settings';
    dialog.setAttribute('aria-labelledby', headingId);
    dialog.innerHTML = `
        <h2 id="${headingId}">设置</h2>
        ${options.controls === false ? '' : `<label>操作端
            <select name="controls">
                <option value="auto">自动</option>
                <option value="desktop">键鼠</option>
                <option value="mobile">触屏</option>
            </select>
        </label>`}
        <label>音效
            <select name="sound">
                <option value="on">开</option>
                <option value="off">关</option>
            </select>
        </label>
        <label>画面旋转
            <select name="rotate">${ROTATION_OPTIONS.map(option => `<option value="${option.value}">${option.label}</option>`).join('')}</select>
        </label>
        <p class="game-settings-hint">浏览器无法自动横屏时，把画面转过来再横握手机。</p>
        <label>战场放大倍率
            <select name="zoom">${BATTLE_ZOOMS.map(zoom => `<option value="${zoom}">${zoom}×</option>`).join('')}</select>
        </label>
        <form method="dialog"><button type="submit">完成</button></form>
    `;
    const controls = dialog.querySelector<HTMLSelectElement>('[name="controls"]');
    const sound = dialog.querySelector<HTMLSelectElement>('[name="sound"]')!;
    const rotate = dialog.querySelector<HTMLSelectElement>('[name="rotate"]')!;
    const zoom = dialog.querySelector<HTMLSelectElement>('[name="zoom"]')!;
    const panel: SettingsPanel = {
        open() {
            const saved = getSettings();
            if (controls) controls.value = saved.controls;
            sound.value = saved.sound ? 'on' : 'off';
            rotate.value = saved.rotate;
            zoom.value = String(saved.zoom);
            dialog.showModal();
        },
        close() {
            if (dialog.open) dialog.close();
        },
        isOpen: () => dialog.open,
        destroy() {
            panel.close();
            dialog.remove();
        },
    };
    dialog.onchange = () => {
        const saved = getSettings();
        setSettings({
            controls: controls ? controls.value as ControlMode : saved.controls,
            zoom: Number(zoom.value) as BattleZoom,
            rotate: rotate.value as RotationMode,
            sound: sound.value !== 'off',
        });
        onChange();
    };
    parent.append(dialog);
    return panel;
}

export function showSettingsButton(parent: HTMLElement, onChange: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-settings-button';
    button.textContent = '设置';
    const panel = createSettingsPanel(parent, onChange);
    button.onclick = () => panel.open();
    parent.append(button);
    return () => {
        panel.destroy();
        button.remove();
    };
}
