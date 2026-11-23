import { direction, distance, type Point } from './combat.ts';
import { BOSS_PHASES, SPECIAL_PATTERNS, type BossPhase, type PatternSpec, type SpecialAttack, type SpecialEnemyKind } from './enemyPatterns.ts';

export interface ActiveSpecialAttack {
    attack: SpecialAttack;
    origin: Point;
    heading: number;
    stage: 'tell' | 'volley' | 'charge';
    deadline: number;
    tell: number;
    shots: number;
    hit: boolean;
}

export interface SpecialEnemyState {
    kind: SpecialEnemyKind;
    phase: 1 | 2;
    active?: ActiveSpecialAttack;
    readyAt: number;
    rotation: number;
    steps: readonly SpecialAttack[];
    nextStep: number;
    offset: number;
}

export function createSpecialState(kind: SpecialEnemyKind, time: number, slot: number): SpecialEnemyState {
    const spec = SPECIAL_PATTERNS[kind];
    const offset = slot * spec.stagger;
    return { kind, phase: 1, readyAt: time + spec.openingDelay + offset, rotation: 0, steps: [], nextStep: 0, offset };
}

export function cancelSpecialAttack(state: SpecialEnemyState, readyAt: number) {
    state.active = undefined;
    state.steps = [];
    state.nextStep = 0;
    state.readyAt = Math.max(state.readyAt, readyAt);
}

function bossPhase(state: SpecialEnemyState): BossPhase | undefined {
    return state.phase === 2 ? BOSS_PHASES[state.kind] : undefined;
}

/** Boss 的第二次阶段：打断当前招式，进入更快的出招循环。 */
export function changeBossPhase(state: SpecialEnemyState, hp: number, maxHp: number, time: number) {
    const spec = BOSS_PHASES[state.kind];
    if (!spec || state.phase !== 1 || hp <= 0 || hp >= maxHp * spec.threshold) return false;
    state.phase = 2;
    state.rotation = 0;
    cancelSpecialAttack(state, time + spec.transition);
    // 换阶段是固定的一次硬直，紧接着就按新节奏出招，不该被上一轮的长收招拖住。
    state.readyAt = time + spec.transition;
    return true;
}

function nextSequence(state: SpecialEnemyState) {
    const attacks = SPECIAL_PATTERNS[state.kind].attacks;
    const order = BOSS_PHASES[state.kind]?.orders[state.phase - 1];
    if (!order) return attacks[state.rotation % attacks.length];
    return attacks[order[state.rotation % order.length]];
}

function finishStep(state: SpecialEnemyState, time: number) {
    state.active = undefined;
    state.nextStep += 1;
    if (state.nextStep < state.steps.length) return;
    const recovery = SPECIAL_PATTERNS[state.kind].recovery * (bossPhase(state)?.recoveryMultiplier ?? 1);
    state.steps = [];
    state.nextStep = 0;
    state.readyAt = time + recovery + state.offset;
}

export function advanceSpecial(state: SpecialEnemyState, at: Point, target: Point, time: number, clearShot: boolean) {
    const active = state.active;
    if (active) {
        if (time < active.deadline) return;
        const { attack } = active;
        if (active.stage === 'charge') {
            finishStep(state, time);
            return;
        }
        if (attack.kind === 'charge') {
            active.stage = 'charge';
            active.deadline = time + attack.distance / attack.speed;
            return { kind: 'charge' as const, active };
        }
        if (attack.kind === 'volley' && ++active.shots < attack.count) {
            active.stage = 'volley';
            active.deadline = time + attack.gap;
        } else {
            finishStep(state, time);
        }
        return { kind: 'execute' as const, active };
    }

    const sequence = state.steps.length ? state.steps : nextSequence(state);
    const attack = sequence[state.nextStep];
    const pattern: PatternSpec = SPECIAL_PATTERNS[state.kind];
    const engage = attack.kind === 'slam' && attack.anchor === 'self' ? attack.radius : pattern.engage;
    const inRange = distance(at, target) <= engage && (clearShot || state.kind !== 'zealot' && !pattern.keepDistance);
    if (!state.steps.length && !inRange) return { kind: 'chase' as const };
    if (time < state.readyAt) return;
    if (!state.steps.length) {
        state.steps = sequence;
        state.rotation += 1;
    }
    const anchor = attack.kind === 'slam' && attack.anchor === 'player' ? target : at;
    const tell = attack.tell * (bossPhase(state)?.tellMultiplier ?? 1);
    state.active = {
        attack, origin: { x: anchor.x, y: anchor.y }, heading: direction(at, target),
        stage: 'tell', deadline: time + tell, tell, shots: 0, hit: false,
    };
    return;
}
