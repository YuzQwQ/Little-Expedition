import { distance, type DamageType, type Point } from './combat.ts';
import { FROST } from './config.ts';

const DOT = {
    burning: { type: 'fire', damage: 3, duration: 4, maxStacks: 3, firstTick: 0.5 },
    poison: { type: 'nature', damage: 2, duration: 5, maxStacks: 3, firstTick: 1 },
} as const;

type DotStatus = keyof typeof DOT;
export type StatusKind = DotStatus | 'slow';
export type StatusResistances = Partial<Record<StatusKind, number>>;
export type FrostTarget = keyof typeof FROST.targets;
interface ChillState { stacks: number; expiresAt: number }
interface SlowOptions { bonusChill?: number; canFreeze?: boolean; freezeDurationBonus?: number }
export interface DotModifiers {
    dotDamageBonus: number;
    dotDurationBonus: number;
    dotMaxStacksBonus: number;
    dotMaxStacksByStatus?: Partial<Record<DotStatus, number>>;
}

export function spreadPoison(origin: Point, targets: { at: Point; statuses: EnemyStatuses }[], time: number,
    spread: { layers: number; targets: number; range: number }, modifiers: DotModifiers) {
    const nearby = closestStatusTargets(origin, targets, spread);
    for (const target of nearby) {
        for (let i = 0; i < spread.layers; i += 1) target.statuses.apply('poison', time, modifiers);
    }
    return nearby.length;
}

export function closestStatusTargets<T extends { at: Point }>(origin: Point, targets: readonly T[],
    spread: { range: number; targets: number }) {
    return targets.map(target => ({ target, distance: distance(origin, target.at) }))
        .filter(candidate => candidate.distance <= spread.range)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, spread.targets)
        .map(candidate => candidate.target);
}

interface Layer {
    nextTick: number;
    expires: number;
}
const STATUS_EPSILON = 1e-9;

export function calculateStatusChance(baseChance: number, hitBonus: number, applicationMultiplier: number, targetResistance: number) {
    const chance = baseChance * (1 + hitBonus) * applicationMultiplier * (1 - targetResistance);
    return Math.min(1, Math.max(0, chance));
}

export class EnemyStatuses {
    private readonly dots: Record<DotStatus, Layer[]> = { burning: [], poison: [] };
    private slowUntil = 0;
    private chill: ChillState = { stacks: 0, expiresAt: 0 };
    private frozenUntil = 0;
    private freezeProtectedUntil = 0;
    private readonly frostTarget: FrostTarget;
    readonly resistances: Readonly<StatusResistances>;

    constructor(resistances: StatusResistances = {}, frostTarget: FrostTarget = 'small') {
        this.frostTarget = frostTarget;
        this.resistances = { burning: 0, poison: 0, slow: 0, ...resistances };
    }

    stacks(kind: DotStatus, time: number, includeExpiring = false) {
        return this.dots[kind].filter(layer => time < layer.expires
            || (includeExpiring && Math.abs(time - layer.expires) <= STATUS_EPSILON)).length;
    }

    remaining(kind: StatusKind, time: number) {
        if (kind === 'slow') return this.isSlowed(time) ? [this.slowUntil - time] : [];
        return this.dots[kind].filter(layer => time < layer.expires).map(layer => layer.expires - time).sort((a, b) => a - b);
    }

    isSlowed(time: number) { return time < this.slowUntil; }
    isFrozen(time: number) { return time < this.frozenUntil; }
    isCold(time: number) { return this.isSlowed(time) || this.isFrozen(time); }
    chillStacks(time: number) { return time < this.chill.expiresAt ? this.chill.stacks : 0; }
    freezeRemaining(time: number) { return Math.max(0, this.frozenUntil - time); }
    protectionRemaining(time: number) {
        return this.isFrozen(time) ? 0 : Math.max(0, this.freezeProtectedUntil - time);
    }

    movementMultiplier(time: number) {
        if (this.isFrozen(time)) return 0;
        return this.isSlowed(time) ? 1 - FROST.slow.penalty * FROST.targets[this.frostTarget].slowScale : 1;
    }

    hasAilment(time: number) { return this.isCold(time) || this.stacks('burning', time) > 0 || this.stacks('poison', time) > 0; }

    applySlow(time: number, options: SlowOptions = {}) {
        if ((this.resistances.slow ?? 0) >= 1) return { applied: false, frozen: false };
        this.slowUntil = time + FROST.slow.duration;
        this.chill.stacks = Math.min(FROST.chill.maxStacks, this.chillStacks(time) + 1 + (options.bonusChill ?? 0));
        this.chill.expiresAt = time + FROST.chill.duration;
        if (!options.canFreeze || this.chill.stacks < FROST.chill.maxStacks || this.isFrozen(time) || time < this.freezeProtectedUntil) {
            return { applied: true, frozen: false };
        }
        const target = FROST.targets[this.frostTarget];
        this.chill = { stacks: 0, expiresAt: 0 };
        this.frozenUntil = time + target.freeze * (1 + (options.freezeDurationBonus ?? 0));
        this.freezeProtectedUntil = this.frozenUntil + target.protection;
        return { applied: true, frozen: true };
    }

    shatter(time: number) {
        if (!this.isFrozen(time)) return;
        this.frozenUntil = 0;
        this.freezeProtectedUntil = time + FROST.targets[this.frostTarget].protection;
    }

    apply(kind: StatusKind, time: number, modifiers?: DotModifiers) {
        if (kind === 'slow') return this.applySlow(time).applied;
        const layers = this.dots[kind];
        const spec = DOT[kind];
        const duration = spec.duration * (1 + (modifiers?.dotDurationBonus ?? 0));
        if (duration <= 0) return false;
        const expires = time + duration;
        const bonusStacks = (modifiers?.dotMaxStacksBonus ?? 0) + (modifiers?.dotMaxStacksByStatus?.[kind] ?? 0);
        const maxStacks = Math.max(1, spec.maxStacks + Math.trunc(bonusStacks));
        // Expired stacks may still owe a final tick. Keep them until update ticks and prunes them.
        const active = layers.filter(layer => time < layer.expires);
        if (active.length >= maxStacks) {
            const shortest = active.reduce((a, b) => a.expires <= b.expires ? a : b);
            shortest.expires = expires;
            return true;
        }
        layers.push({ nextTick: time + spec.firstTick, expires });
        return true;
    }

    private consumeLayers(kind: DotStatus, count: number, time: number) {
        const active = this.dots[kind].filter(layer => time < layer.expires);
        if (active.length < count) return [];
        const consumed = active.sort((a, b) => a.expires - b.expires).slice(0, count);
        this.dots[kind] = this.dots[kind].filter(layer => !consumed.includes(layer));
        return consumed;
    }

    consumeBurning(count: number, time: number) {
        return this.consumeLayers('burning', count, time).length === count;
    }

    consumePoison(count: number, time: number) {
        let ticks = 0;
        for (const { nextTick, expires } of this.consumeLayers('poison', count, time)) {
            const futureTick = nextTick + Math.max(0, Math.ceil(time - nextTick - STATUS_EPSILON));
            ticks += Math.max(0, 1 + Math.floor(expires - futureTick + STATUS_EPSILON));
        }
        return ticks * DOT.poison.damage;
    }

    advance(time: number, deal: (type: DamageType, amount: number, tickTime: number) => void) {
        if (!this.dots.burning.length && !this.dots.poison.length) return;
        // Resolve overdue ticks in chronological order even if both ailments tick on this frame.
        const due: { type: DamageType; amount: number; time: number }[] = [];
        for (const kind of ['burning', 'poison'] as const) {
            const { type, damage } = DOT[kind];
            for (const layer of this.dots[kind]) {
                while (layer.nextTick <= time + STATUS_EPSILON && layer.nextTick <= layer.expires + STATUS_EPSILON) {
                    due.push({ type, amount: damage, time: layer.nextTick });
                    layer.nextTick += 1;
                }
            }
        }
        due.sort((a, b) => a.time - b.time);
        for (const tick of due) deal(tick.type, tick.amount, tick.time);
        this.dots.burning = this.dots.burning.filter(layer => time + STATUS_EPSILON < layer.expires);
        this.dots.poison = this.dots.poison.filter(layer => time + STATUS_EPSILON < layer.expires);
    }

    clear() {
        this.slowUntil = 0;
        this.chill = { stacks: 0, expiresAt: 0 };
        this.frozenUntil = 0;
        this.freezeProtectedUntil = 0;
        this.dots.burning.length = 0;
        this.dots.poison.length = 0;
    }
}
