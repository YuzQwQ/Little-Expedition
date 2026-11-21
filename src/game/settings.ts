export type ControlMode = 'auto' | 'desktop' | 'mobile';
export const BATTLE_ZOOMS = [1, 1.2, 1.4, 1.6] as const;
export type BattleZoom = typeof BATTLE_ZOOMS[number];

export interface GameSettings {
    controls: ControlMode;
    zoom: BattleZoom;
}

const SETTINGS_KEY = 'little-expedition-settings-v1';
export const SETTINGS_CHANGED = 'little-expedition-settings-changed';
let current: GameSettings | undefined;

export function normalizeSettings(value?: Partial<GameSettings> | null): GameSettings {
    const controls = value?.controls === 'desktop' || value?.controls === 'mobile' ? value.controls : 'auto';
    const zoom = BATTLE_ZOOMS.find(option => option === value?.zoom) ?? 1;
    return { controls, zoom };
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

export function showSettingsButton(parent: HTMLElement, onChange: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-settings-button';
    button.textContent = '设置';
    const dialog = document.createElement('dialog');
    dialog.className = 'game-settings';
    dialog.setAttribute('aria-labelledby', 'game-settings-heading');
    dialog.innerHTML = `
        <h2 id="game-settings-heading">设置</h2>
        <label>操作端
            <select name="controls">
                <option value="auto">自动</option>
                <option value="desktop">键鼠</option>
                <option value="mobile">触屏</option>
            </select>
        </label>
        <label>战场放大倍率
            <select name="zoom">${BATTLE_ZOOMS.map(zoom => `<option value="${zoom}">${zoom}×</option>`).join('')}</select>
        </label>
        <form method="dialog"><button type="submit">完成</button></form>
    `;
    const controls = dialog.querySelector<HTMLSelectElement>('[name="controls"]')!;
    const zoom = dialog.querySelector<HTMLSelectElement>('[name="zoom"]')!;
    button.onclick = () => {
        const saved = getSettings();
        controls.value = saved.controls;
        zoom.value = String(saved.zoom);
        dialog.showModal();
    };
    dialog.onchange = () => {
        setSettings({ controls: controls.value as ControlMode, zoom: Number(zoom.value) as BattleZoom });
        onChange();
    };
    parent.append(button, dialog);
    return () => {
        if (dialog.open) dialog.close();
        dialog.remove();
        button.remove();
    };
}
