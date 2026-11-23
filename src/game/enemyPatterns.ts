import type { EnemyProjectileSpec } from './enemyProjectiles.ts';

type Attack = { tell: number; damage: number } & (
    { kind: 'cone'; radius: number; degrees: number } |
    { kind: 'slam'; radius: number; anchor: 'self' | 'player' } |
    { kind: 'charge'; speed: number; distance: number } |
    { kind: 'volley'; projectile: EnemyProjectileSpec; warningRange: number; headings: readonly number[]; count: number; gap: number } |
    // 裂地剑气：沿朝向依次爆开 steps 段，每段宽 width、步长由 length 均分。
    { kind: 'line'; length: number; width: number; steps: number; interval: number }
);

export interface PatternSpec {
    engage: number;
    recovery: number;
    openingDelay: number;
    stagger: number;
    /** 保持距离型：被贴近会后撤，且要求视线通畅。 */
    keepDistance?: boolean;
    attacks: readonly (readonly Attack[])[];
}

const spell: EnemyProjectileSpec = { speed: 320, radius: 11, damageType: 'arcane', piercesPlayer: false, shape: 'orb' };
const soulBolt: EnemyProjectileSpec = { speed: 300, radius: 10, damageType: 'arcane', piercesPlayer: false, shape: 'diamond' };
const fan = [-30, -15, 0, 15, 30];
const ring = Array.from({ length: 12 }, (_, index) => index * 30);

export const SPECIAL_PATTERNS = {
    caster: {
        engage: 340, recovery: 1.65, openingDelay: 0.55, stagger: 0.32, keepDistance: true,
        attacks: [
            [{ kind: 'volley', tell: 0.67, damage: 9, projectile: spell, warningRange: 530, headings: [0], count: 3, gap: 0.18 }],
            [{ kind: 'volley', tell: 0.83, damage: 11, projectile: { ...spell, speed: 280, shape: 'diamond' }, warningRange: 530,
                headings: fan, count: 1, gap: 0 }],
        ],
    },
    boar: {
        engage: 230, recovery: 1.3, openingDelay: 0.35, stagger: 0.15,
        attacks: [[{ kind: 'charge', tell: 0.78, damage: 18, speed: 410, distance: 275 }]],
    },
    zealot: {
        engage: 66, recovery: 0.57, openingDelay: 0.15, stagger: 0.08,
        attacks: [[
            { kind: 'cone', tell: 0.36, damage: 8, radius: 70, degrees: 100 },
            { kind: 'cone', tell: 0.34, damage: 11, radius: 79, degrees: 105 },
        ]],
    },
    guardian: {
        engage: 365, recovery: 1.22, openingDelay: 0.8, stagger: 0,
        attacks: [
            [{ kind: 'slam', tell: 0.84, damage: 19, radius: 126, anchor: 'self' }],
            [{ kind: 'charge', tell: 1.0, damage: 22, speed: 355, distance: 335 }],
            [{ kind: 'volley', tell: 0.95, damage: 13, projectile: { ...spell, speed: 255, radius: 13 }, warningRange: 155,
                headings: ring, count: 1, gap: 0 }],
            Array.from({ length: 3 }, (): Attack => ({ kind: 'slam', tell: 0.62, damage: 15, radius: 85, anchor: 'player' })),
        ],
    },
    crownlessBody: {
        // 无冠者的铠甲：三段斩收尾很重，破地剑气逼横向走位，冲撞用来追缩距离的玩家。
        engage: 118, recovery: 0.72, openingDelay: 0.6, stagger: 0,
        attacks: [
            [
                { kind: 'cone', tell: 0.48, damage: 11, radius: 104, degrees: 118 },
                { kind: 'cone', tell: 0.30, damage: 13, radius: 110, degrees: 124 },
                { kind: 'cone', tell: 0.44, damage: 17, radius: 124, degrees: 132 },
            ],
            // 六段爆点间距小于判定半径，站住不动必被命中一次以上
            [{ kind: 'line', tell: 0.72, damage: 11, length: 430, width: 44, steps: 6, interval: 0.08 }],
            [{ kind: 'charge', tell: 0.7, damage: 19, speed: 400, distance: 300 }],
        ],
    },
    crownlessHead: {
        // 残魂之首：飘在远处放冷箭，被贴近就后撤，逼玩家先决定追头还是砍甲。
        engage: 320, recovery: 1.35, openingDelay: 0.7, stagger: 0.2, keepDistance: true,
        attacks: [
            [{ kind: 'volley', tell: 0.62, damage: 8, projectile: soulBolt, warningRange: 520, headings: [0], count: 3, gap: 0.2 }],
            [{ kind: 'volley', tell: 0.8, damage: 9, projectile: soulBolt, warningRange: 470, headings: [-24, -8, 8, 24], count: 1, gap: 0 }],
        ],
    },
} satisfies Record<string, PatternSpec>;

export type SpecialEnemyKind = keyof typeof SPECIAL_PATTERNS;
export type SpecialAttack = Attack;

export interface BossPhase {
    threshold: number;
    transition: number;
    tellMultiplier: number;
    recoveryMultiplier: number;
    /** 各阶段出招顺序，索引指向攻击序列。 */
    orders: readonly (readonly number[])[];
}

/** 有独立阶段机制的敌人：目前只有石像守卫，无冠者用「残魂熄灭」代替换阶段。 */
export const BOSS_PHASES: Partial<Record<SpecialEnemyKind, BossPhase>> = {
    guardian: {
        threshold: 0.5, transition: 0.85, tellMultiplier: 0.90, recoveryMultiplier: 0.83,
        orders: [[0, 1, 2], [3, 1, 2, 0]],
    },
};

const BOSS_KINDS: readonly string[] = ['guardian', 'crownlessBody'];

export function isBossKind(kind: string): boolean {
    return BOSS_KINDS.includes(kind);
}

export function isSpecialEnemy(kind: string): kind is SpecialEnemyKind {
    return Object.prototype.hasOwnProperty.call(SPECIAL_PATTERNS, kind);
}
