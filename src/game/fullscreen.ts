import { getSettings, SETTINGS_CHANGED, usesMobileControls } from './settings';

export function mountFullscreen(parent: HTMLElement, refreshScale: () => void) {
    const coarsePointer = matchMedia('(pointer: coarse)');
    const orientation = screen.orientation as (ScreenOrientation & {
        lock?: (value: 'landscape') => Promise<void>;
    }) | undefined;
    let landscapeRequested = false;
    const unlockLandscape = () => {
        if (!landscapeRequested) return;
        landscapeRequested = false;
        orientation?.unlock?.();
    };
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-fullscreen-button';
    const status = document.createElement('div');
    status.className = 'game-fullscreen-status';
    status.setAttribute('role', 'status');
    parent.append(button, status);

    const sync = () => {
        const active = document.fullscreenElement === parent;
        button.hidden = !active && !usesMobileControls(getSettings().controls, coarsePointer.matches);
        button.textContent = active ? '退出全屏' : '全屏';
        button.setAttribute('aria-pressed', String(active));
        if (button.hidden) status.textContent = '';
    };
    const onFullscreenChange = () => {
        if (document.fullscreenElement !== parent) {
            unlockLandscape();
            status.textContent = '';
        }
        sync();
        refreshScale();
    };
    button.onclick = async () => {
        status.textContent = '';
        if (!document.fullscreenEnabled || !parent.requestFullscreen) {
            status.textContent = '当前浏览器不支持游戏全屏。';
            return;
        }
        button.disabled = true;
        try {
            if (document.fullscreenElement === parent) {
                await document.exitFullscreen();
            } else {
                await parent.requestFullscreen();
                if (document.fullscreenElement !== parent) return;
                try {
                    if (orientation?.lock) {
                        landscapeRequested = true;
                        await orientation.lock('landscape');
                    } else {
                        status.textContent = '请将手机横过来游玩。';
                    }
                } catch {
                    if (document.fullscreenElement === parent) {
                        status.textContent = '请将手机横过来游玩。';
                    }
                }
            }
        } catch {
            status.textContent = '无法切换全屏，请重试。';
        } finally {
            button.disabled = false;
            sync();
        }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener(SETTINGS_CHANGED, sync);
    coarsePointer.addEventListener('change', sync);
    sync();
    return () => {
        unlockLandscape();
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener(SETTINGS_CHANGED, sync);
        coarsePointer.removeEventListener('change', sync);
        button.remove();
        status.remove();
    };
}
