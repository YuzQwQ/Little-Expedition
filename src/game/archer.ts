import { ARCHER, ENEMIES } from './config.ts';
import { direction, distance, type Point } from './combat.ts';

export interface ArcherState {
    phase: 'positioning' | 'aiming' | 'cooldown';
    heading: number;
    aimUntil: number;
    readyAt: number;
    offset: number;
    retreatUntil?: number;
}

export function createArcherState(time = 0, slot = 0): ArcherState {
    const offset = slot * ARCHER.stagger;
    return { phase: 'positioning', heading: 0, aimUntil: 0, readyAt: time + offset, offset };
}

export function cancelArcherAim(state: ArcherState) {
    if (state.phase !== 'aiming') return;
    state.phase = 'positioning';
    state.aimUntil = 0;
}

// Move towards (1), retreat (-1), hold (0), or fire once along the previewed heading.
export function updateArcher(state: ArcherState, at: Point, player: Point, time: number, clearShot: boolean) {
    const spec = ENEMIES.archer;
    if (state.phase === 'aiming') {
        if (time >= state.aimUntil) {
            state.phase = 'cooldown';
            state.readyAt = time + spec.interval - spec.windup + state.offset;
            return 'fire';
        }
        if (state.aimUntil - time > ARCHER.fixedAimDuration) state.heading = direction(at, player, state.heading);
        return 0;
    }

    state.heading = direction(at, player, state.heading);
    const separation = distance(at, player);
    if (separation >= ARCHER.retreatResetDistance) state.retreatUntil = undefined;
    if (separation < ARCHER.minDistance) {
        state.retreatUntil ??= time + ARCHER.retreatDuration;
        if (time < state.retreatUntil) return -1;
    }
    if (time >= state.readyAt) {
        state.phase = 'positioning';
        if (separation <= spec.approach && clearShot) {
            state.phase = 'aiming';
            state.aimUntil = time + spec.windup;
            return 0;
        }
    }
    return separation > spec.approach || !clearShot ? 1 : 0;
}
