import type { EnemyProjectileSpec } from './enemyProjectiles.ts';

type Attack = { tell: number; damage: number } & (
    { kind: 'cone'; radius: number; degrees: number } |
    { kind: 'slam'; radius: number; anchor: 'self' | 'player' } |
    { kind: 'charge'; speed: number; distance: number } |
    { kind: 'volley'; projectile: EnemyProjectileSpec; warningRange: number; headings: readonly number[]; count: number; gap: number }
);

interface PatternSpec {
    engage: number;
    recovery: number;
    openingDelay: number;
    stagger: number;
    attacks: readonly (readonly Attack[])[];
}

const spell: EnemyProjectileSpec = { speed: 320, radius: 11, damageType: 'arcane', piercesPlayer: false, shape: 'orb' };
const fan = [-30, -15, 0, 15, 30];
const ring = Array.from({ length: 12 }, (_, index) => index * 30);

export const SPECIAL_PATTERNS = {
    caster: {
        engage: 340, recovery: 1.65, openingDelay: 0.55, stagger: 0.32,
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
} satisfies Record<string, PatternSpec>;

export type SpecialEnemyKind = keyof typeof SPECIAL_PATTERNS;
export type SpecialAttack = Attack;
export const GUARDIAN_PHASE = {
    threshold: 0.5, transition: 0.85, tellMultiplier: 0.90, recoveryMultiplier: 0.83,
    firstPhaseOrder: [0, 1, 2], secondPhaseOrder: [3, 1, 2, 0],
};

export function isSpecialEnemy(kind: string): kind is SpecialEnemyKind {
    return Object.prototype.hasOwnProperty.call(SPECIAL_PATTERNS, kind);
}
