import { direction, distance, type Point } from './combat.ts';
import { GUARDIAN_PHASE, SPECIAL_PATTERNS, type SpecialAttack, type SpecialEnemyKind } from './enemyPatterns.ts';

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

export function changeGuardianPhase(state: SpecialEnemyState, hp: number, maxHp: number, time: number) {
    if (state.kind !== 'guardian' || state.phase !== 1 || hp <= 0 || hp >= maxHp * GUARDIAN_PHASE.threshold) return false;
    state.phase = 2;
    state.rotation = 0;
    cancelSpecialAttack(state, time + GUARDIAN_PHASE.transition);
    return true;
}

function nextSequence(state: SpecialEnemyState) {
    const attacks = SPECIAL_PATTERNS[state.kind].attacks;
    if (state.kind !== 'guardian') return attacks[state.rotation % attacks.length];
    const order = state.phase === 1 ? GUARDIAN_PHASE.firstPhaseOrder : GUARDIAN_PHASE.secondPhaseOrder;
    return attacks[order[state.rotation % order.length]];
}

function finishStep(state: SpecialEnemyState, time: number) {
    state.active = undefined;
    state.nextStep += 1;
    if (state.nextStep < state.steps.length) return;
    const recovery = SPECIAL_PATTERNS[state.kind].recovery * (state.phase === 2 ? GUARDIAN_PHASE.recoveryMultiplier : 1);
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
    const engage = attack.kind === 'slam' && attack.anchor === 'self' ? attack.radius : SPECIAL_PATTERNS[state.kind].engage;
    const inRange = distance(at, target) <= engage && (attack.kind !== 'volley' || clearShot || state.kind === 'guardian');
    if (!state.steps.length && !inRange) return { kind: 'chase' as const };
    if (time < state.readyAt) return;
    if (!state.steps.length) {
        state.steps = sequence;
        state.rotation += 1;
    }
    const anchor = attack.kind === 'slam' && attack.anchor === 'player' ? target : at;
    const tell = attack.tell * (state.phase === 2 ? GUARDIAN_PHASE.tellMultiplier : 1);
    state.active = {
        attack, origin: { x: anchor.x, y: anchor.y }, heading: direction(at, target),
        stage: 'tell', deadline: time + tell, tell, shots: 0, hit: false,
    };
    return;
}
