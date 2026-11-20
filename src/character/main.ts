import Phaser from 'phaser';
import { CharacterPreviewScene, STAGE, type PreviewMotion, type PreviewState } from './CharacterPreviewScene';
import { DEFAULT_RIG, FIELDS, NUMBER_FIELDS, PART_NAMES, PARTS, freshRig, parseRig, serializeRig, type PartId } from './warriorRig';

const STORAGE_KEY = 'little-expedition-warrior-rig-v2';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const status = byId<HTMLParagraphElement>('status');
const select = byId<HTMLSelectElement>('part');
const visibility = byId<HTMLInputElement>('visible');
const fileInput = byId<HTMLInputElement>('file');
const motionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-motion]'));

function message(value: string, error = false) {
    status.textContent = value;
    status.dataset.error = String(error);
}

const state: PreviewState = {
    rig: freshRig(),
    motion: 'idle',
    revision: 0,
    selected: 'arm_back',
    mirrored: false,
    showPivot: false,
    onAttackComplete: () => play('idle'),
    onLoadError: file => message(`素材加载失败：${file}`, true),
};

try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        state.rig = parseRig(saved);
    } else {
        const previous = localStorage.getItem('little-expedition-warrior-rig-v1');
        if (previous) {
            state.rig = parseRig(previous);
            if (state.rig.sword.depth === 8) state.rig.sword.depth = DEFAULT_RIG.sword.depth;
        }
    }
} catch {
    message('无法读取本地配置，已加载默认组装。', true);
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, serializeRig(state.rig));
        message('已保存到此浏览器。');
    } catch {
        message('浏览器无法保存，请导出 JSON。', true);
    }
}

function play(motion: PreviewMotion) {
    state.motion = motion;
    state.revision += 1;
    for (const button of motionButtons) button.setAttribute('aria-pressed', String(button.dataset.motion === motion));
}

for (const id of PARTS) select.add(new Option(PART_NAMES[id], id));
const inputs = FIELDS.map(field => {
    const { name, min, max, step } = NUMBER_FIELDS[field];
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    label.append(input);
    byId('fields').append(label);
    input.addEventListener('input', () => {
        const value = input.valueAsNumber;
        if (Number.isFinite(value) && value >= min && value <= max) {
            state.rig[state.selected][field] = value;
            save();
        }
    });
    input.addEventListener('change', () => { input.value = String(state.rig[state.selected][field]); });
    return { field, input };
});

function showSelection() {
    select.value = state.selected;
    const config = state.rig[state.selected];
    for (const { field, input } of inputs) input.value = String(config[field]);
    visibility.checked = config.visible;
}

select.addEventListener('change', () => {
    state.selected = select.value as PartId;
    showSelection();
});
visibility.addEventListener('change', () => {
    state.rig[state.selected].visible = visibility.checked;
    save();
});
byId<HTMLInputElement>('mirror').addEventListener('change', event => {
    state.mirrored = (event.currentTarget as HTMLInputElement).checked;
});
byId<HTMLInputElement>('pivot').addEventListener('change', event => {
    state.showPivot = (event.currentTarget as HTMLInputElement).checked;
});
for (const button of motionButtons) button.addEventListener('click', () => play(button.dataset.motion as PreviewMotion));

byId('reset').addEventListener('click', () => {
    state.rig = freshRig();
    state.mirrored = false;
    state.showPivot = false;
    byId<HTMLInputElement>('mirror').checked = false;
    byId<HTMLInputElement>('pivot').checked = false;
    play('idle');
    showSelection();
    save();
});
byId('export').addEventListener('click', () => {
    const URLForFile = URL.createObjectURL(new Blob([serializeRig(state.rig)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = URLForFile;
    link.download = 'warrior-rig.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(URLForFile), 1000);
});
byId('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
        state.rig = parseRig(await file.text());
        showSelection();
        save();
    } catch (error) {
        message(error instanceof SyntaxError ? '文件不是有效的 JSON。' : String((error as Error).message), true);
    } finally {
        fileInput.value = '';
    }
});

showSelection();
new Phaser.Game({
    type: Phaser.AUTO,
    ...STAGE,
    parent: 'preview-canvas',
    backgroundColor: '#ffffff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new CharacterPreviewScene(state),
});
