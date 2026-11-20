export const PART_NAMES = {
    shadow: '地面阴影',
    leg_back: '后腿',
    arm_back: '后手臂（持剑）',
    body: '身体与披风',
    leg_front: '前腿',
    head: '头部',
    arm_front: '前手臂',
    sword: '长剑',
} as const;

export type PartId = keyof typeof PART_NAMES;
export const PARTS = Object.keys(PART_NAMES) as PartId[];
export const REFERENCE = { asset: 'assets/warrior/reference.png', pivotX: 0.5168, pivotY: 0.9955 };

export interface PartConfig {
    asset: string;
    x: number;
    y: number;
    angle: number;
    pivotX: number;
    pivotY: number;
    scale: number;
    depth: number;
    visible: boolean;
}

export type Rig = Record<PartId, PartConfig>;

function part(
    id: PartId, x: number, y: number, pivotX: number, pivotY: number, scale: number, depth: number, angle = 0,
): PartConfig {
    return { asset: `assets/warrior/${id}.png`, x, y, angle, pivotX, pivotY, scale, depth, visible: true };
}

// Positions are in source pixels from the center of the soles. Origins are normalized to each PNG.
export const DEFAULT_RIG: Rig = {
    shadow: part('shadow', -9, 1, 0.5, 0.5, 1.65, 0),
    leg_back: part('leg_back', 47, -109, 0.46, 0.16, 0.65, 4),
    arm_back: part('arm_back', 70, -268, 0.37, 0.14, 0.55, 2),
    body: part('body', 25, -305, 0.64, 0.166, 0.88, 3),
    leg_front: part('leg_front', -45, -103, 0.55, 0.18, 0.58, 5),
    head: part('head', 0, -374, 0.58, 0.84, 1.26, 6),
    arm_front: part('arm_front', -80, -269, 0.59, 0.21, 0.68, 7),
    sword: part('sword', 106, -173, 0.237, 0.81, 0.67, 2, 27),
};

export const SWORD_ARM: PartId = 'arm_back';

export const NUMBER_FIELDS = {
    x: { name: 'X 偏移', min: -1600, max: 1600, step: 1 },
    y: { name: 'Y 偏移', min: -1600, max: 1600, step: 1 },
    angle: { name: '旋转角度 (°)', min: -360, max: 360, step: 1 },
    pivotX: { name: '旋转锚点 X', min: 0, max: 1, step: 0.001 },
    pivotY: { name: '旋转锚点 Y', min: 0, max: 1, step: 0.001 },
    scale: { name: '缩放比例', min: 0.05, max: 4, step: 0.01 },
    depth: { name: '渲染层级', min: -50, max: 50, step: 1 },
};

export type NumberField = keyof typeof NUMBER_FIELDS;
export const FIELDS = Object.keys(NUMBER_FIELDS) as NumberField[];

export function freshRig(): Rig {
    return structuredClone(DEFAULT_RIG);
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置应为 JSON 对象。');
    return value as Record<string, unknown>;
}

export function serializeRig(rig: Rig) {
    return JSON.stringify({ version: 1, parts: rig }, null, 2);
}

export function parseRig(text: string): Rig {
    const data = record(JSON.parse(text));
    if (data.version !== 1) throw new Error('只支持版本 1 的组装配置。');
    const parts = record(data.parts);
    const rig = freshRig();
    for (const id of PARTS) {
        const saved = record(parts[id]);
        if (saved.asset !== rig[id].asset || typeof saved.visible !== 'boolean') {
            throw new Error(`${PART_NAMES[id]}的素材路径或可见性无效。`);
        }
        for (const field of FIELDS) {
            const value = saved[field];
            const { name, min, max } = NUMBER_FIELDS[field];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
                throw new Error(`${PART_NAMES[id]}的${name}应介于 ${min} 和 ${max}。`);
            }
            rig[id][field] = value;
        }
        rig[id].visible = saved.visible;
    }
    return rig;
}
