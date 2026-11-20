export const DIFFICULTIES = {
    normal: { label: '普通', enemyHp: 0.90, enemyDamage: 0.80, projectileSpeed: 0.90 },
    trial: { label: '磨砺', enemyHp: 1, enemyDamage: 1, projectileSpeed: 1 },
} as const;

export type Difficulty = keyof typeof DIFFICULTIES;

const TRIAL_UNLOCK_KEY = 'little-expedition-trial-unlocked-v1';
let unlockedThisSession = false;

export function isTrialUnlocked() {
    if (unlockedThisSession) return true;
    try {
        return globalThis.localStorage.getItem(TRIAL_UNLOCK_KEY) === '1';
    } catch {
        return false;
    }
}

export function unlockTrial() {
    if (isTrialUnlocked()) return false;
    unlockedThisSession = true;
    try {
        globalThis.localStorage.setItem(TRIAL_UNLOCK_KEY, '1');
    } catch {
        // Storage can be unavailable, but the current game session can still use the unlock.
    }
    return true;
}
