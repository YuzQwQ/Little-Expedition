import { BREAK, IMPACT, RELICS, WARRIOR } from './config.ts';
import type { WarriorBlock } from './warrior.ts';

export type DamageType = 'physical' | 'fire' | 'nature' | 'frost' | 'arcane';
export type DamageSource = 'basicAttack' | 'specialAttack' | 'relic' | 'damageOverTime' | 'environment';
export type Resistances = Partial<Record<DamageType, number>>;

export interface DamageBonuses {
    global?: number;
    damageOverTime?: number;
    types?: Partial<Record<DamageType, number>>;
    sources?: Partial<Record<DamageSource, number>>;
}

export interface Point {
    x: number;
    y: number;
}

export function distance(a: Point, b: Point) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

export function direction(a: Point, b: Point, fallback = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx || dy ? Math.atan2(dy, dx) : fallback;
}

export function inSector(origin: Point, target: Point, heading: number, range: number, degrees: number) {
    const separation = distance(origin, target);
    if (separation > range) return false;
    if (separation === 0 || degrees >= 360) return true;
    return Math.cos(direction(origin, target) - heading) >= Math.cos(degrees * Math.PI / 360) - 1e-10;
}

export function segmentHits(start: Point, end: Point, target: Point, radius: number) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared ? ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared : 0;
    const fraction = Math.max(0, Math.min(1, projection));
    return distance({ x: start.x + dx * fraction, y: start.y + dy * fraction }, target) <= radius;
}

export interface Vital {
    hp: number;
    maxHp: number;
    poise: number;
    maxPoise: number;
    stunUntil: number;
    vulnerableUntil: number;
    markedUntil: number;
    shield: number;
    shieldUntil: number;
    resistances: Resistances;
    immunityUntil: number;
    flashUntil: number;
    knockUntil: number;
    knock: Point;
}

export function createVital(hp: number, poise = 0, resistances: Resistances = {}): Vital {
    return {
        hp, maxHp: hp, poise, maxPoise: poise, stunUntil: 0, vulnerableUntil: 0,
        markedUntil: 0, shield: 0, shieldUntil: 0, resistances: { ...resistances },
        immunityUntil: 0, flashUntil: 0, knockUntil: 0, knock: { x: 0, y: 0 },
    };
}

export function heal(player: Vital, amount: number) {
    if (player.hp <= 0) return 0;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    return player.hp - before;
}

export function recoverPoise(target: Vital, time: number) {
    if (target.stunUntil && time >= target.stunUntil) {
        target.poise = target.maxPoise;
        target.stunUntil = 0;
    }
}

export type HitSource = 'normal' | 'enemy' | 'lightning' | 'thorns' | 'blade' | 'aftershock' | 'collapse'
    | 'extraSlash' | 'echo' | 'charge' | 'echoBlade' | 'dot' | 'prism' | 'poiseBreak' | 'environment'
    | 'goldenLily' | 'furnacePendant' | 'frostBell' | 'shatter'
    | 'starlightRing' | 'starBottle' | 'moonWatch' | 'meteorFragment' | 'dawnAstrolabe' | 'parry' | 'ultimate';

type ArcaneMode = 'original' | 'snapshot';

export interface ArcaneDamageEvent {
    readonly id: number;
    readonly canTriggerEffects: boolean;
    handled: boolean;
}

let arcaneEventId = 0;

function damageProfile(type: DamageType, source: DamageSource, arcaneMode?: ArcaneMode) {
    const basic = source === 'basicAttack';
    const dot = source === 'damageOverTime';
    const secondary = dot || (source === 'relic' && arcaneMode !== 'original');
    return { type, source, arcaneMode, tags: {
        direct: !secondary, secondary, dot, canCrit: basic, canTriggerOnHit: basic, canTriggerOnCrit: basic,
    } };
}

const DAMAGE_PROFILES: Record<HitSource, ReturnType<typeof damageProfile>> = {
    normal: damageProfile('physical', 'basicAttack'),
    enemy: damageProfile('physical', 'specialAttack'),
    parry: damageProfile('physical', 'specialAttack'),
    ultimate: damageProfile('physical', 'specialAttack'),
    lightning: damageProfile('arcane', 'relic', 'original'),
    thorns: damageProfile('nature', 'relic'),
    blade: damageProfile('physical', 'relic'),
    aftershock: damageProfile('physical', 'relic'),
    collapse: damageProfile('physical', 'relic'),
    extraSlash: damageProfile('physical', 'relic'),
    echo: damageProfile('physical', 'relic'),
    charge: damageProfile('physical', 'relic'),
    echoBlade: damageProfile('physical', 'relic'),
    dot: damageProfile('fire', 'damageOverTime'),
    prism: damageProfile('arcane', 'relic', 'original'),
    starlightRing: damageProfile('arcane', 'relic', 'original'),
    starBottle: damageProfile('arcane', 'relic', 'original'),
    moonWatch: damageProfile('arcane', 'relic'),
    meteorFragment: damageProfile('arcane', 'relic', 'snapshot'),
    dawnAstrolabe: damageProfile('arcane', 'relic', 'snapshot'),
    goldenLily: damageProfile('fire', 'relic'),
    furnacePendant: damageProfile('fire', 'relic'),
    frostBell: damageProfile('frost', 'relic'),
    shatter: damageProfile('frost', 'relic'),
    poiseBreak: damageProfile('physical', 'relic'),
    environment: damageProfile('physical', 'environment'),
};

export function hitProfile(source: HitSource) { return DAMAGE_PROFILES[source]; }

export function vulnerabilityBonus(target: Vital, time: number) {
    return (time < target.vulnerableUntil ? BREAK.vulnerability : 0)
        + (time < target.markedUntil ? RELICS.hunter.bonus : 0);
}

export function activeShield(target: Vital, time: number) {
    return time < target.shieldUntil ? target.shield : 0;
}

export interface Hit {
    origin: Point;
    target: Point;
    amount: number;
    poise?: number;
    source: HitSource;
    damageType?: DamageType;
    bonuses?: DamageBonuses;
    sourceBonus?: number;
    block?: WarriorBlock;
    damageReduction?: number;
    ignoreKnockback?: boolean;
    critMultiplier?: number;
    chainDepth?: number;
}

export function resolveHit(vital: Vital, hit: Hit, time: number, breakBonus = 0) {
    if (vital.hp <= 0 || time < vital.immunityUntil) return null;

    recoverPoise(vital, time);
    const profile = hitProfile(hit.source);
    const type = hit.damageType ?? profile.type;
    const { tags } = profile;
    const critical = tags.canCrit && (hit.critMultiplier ?? 1) > 1;
    const resistance = Math.max(-1, Math.min(0.9, vital.resistances[type] ?? 0));
    const global = hit.bonuses?.global ?? 0;
    const dot = tags.dot ? hit.bonuses?.damageOverTime ?? 0 : 0;
    const elemental = hit.bonuses?.types?.[type] ?? 0;
    const source = (hit.bonuses?.sources?.[profile.source] ?? 0) + (hit.sourceBonus ?? 0);
    // Resonance snapshots actual HP lost. It does not apply the target's modifiers a second time.
    const outgoingDamage = profile.arcaneMode === 'snapshot' ? hit.amount
        : hit.amount * (1 + global) * (1 + elemental) * (1 + dot) * (1 + source) * (critical ? hit.critMultiplier! : 1);
    const rawDamage = Math.max(0, hit.source === 'echoBlade' ? hit.amount
        : outgoingDamage * (1 + vulnerabilityBonus(vital, time)) * (1 - resistance));
    const guard = rawDamage > 0 ? hit.block?.guard(hit.target, hit.origin, time) : undefined;
    const reduction = guard === 'perfect' ? 1 : guard === 'block' ? WARRIOR.block.reduction : hit.damageReduction ?? 0;
    const damage = rawDamage * (1 - reduction);
    const shield = activeShield(vital, time);
    const absorbed = Math.min(shield, damage);
    vital.shield = shield - absorbed;
    const healthDamage = Math.min(vital.hp, damage - absorbed);
    vital.hp -= healthDamage;
    if (damage > 0) vital.flashUntil = time + IMPACT.flash;

    if (hit.source === 'enemy' && guard !== 'perfect') vital.immunityUntil = time + WARRIOR.hitImmunity;
    if (guard !== 'perfect' && !hit.ignoreKnockback && (hit.source === 'enemy' || hit.source === 'normal')) {
        const heading = direction(hit.origin, hit.target);
        vital.knock = { x: Math.cos(heading) * IMPACT.speed, y: Math.sin(heading) * IMPACT.speed };
        vital.knockUntil = time + IMPACT.duration;
    }

    let breakDamage = 0;
    if (!tags.dot && vital.hp > 0 && vital.maxPoise > 0 && !vital.stunUntil && hit.poise) {
        vital.poise = Math.max(0, vital.poise - hit.poise);
        if (vital.poise === 0) {
            breakDamage = vital.maxHp * BREAK.bonusHpFraction + breakBonus;
            vital.hp = Math.max(0, vital.hp - breakDamage);
            vital.stunUntil = time + BREAK.stun;
            vital.vulnerableUntil = time + BREAK.duration;
        }
    }

    const arcane: ArcaneDamageEvent | undefined = type === 'arcane'
        ? { id: ++arcaneEventId, canTriggerEffects: profile.arcaneMode === 'original', handled: false } : undefined;
    return { damage, healthDamage, absorbed, breakDamage, killed: vital.hp === 0, guard, blocked: guard !== undefined,
        critical, type, source: profile.source, tags, arcane, breakProfile: breakDamage ? hitProfile('poiseBreak') : undefined };
}

export interface Swing<T> {
    heading: number;
    started: number;
    speed: number;
    damageScale: number;
    hit: Set<T>;
    released?: boolean;
    skipWindup?: boolean;
    rangeMultiplier?: number;
    angle?: number;
    poiseMultiplier?: number;
    resolveHits?: number;
    attackBonus?: number;
    phoenixBurn?: boolean;
    landed?: boolean;
    pending?: { enemy: T; origin: Point; amount: number }[];
}

export function swingRange<T>(swing: Swing<T>) { return WARRIOR.attack.range * (swing.rangeMultiplier ?? 1); }

export function swingContactEnd<T>(swing: Swing<T>) {
    return swing.started + ((swing.skipWindup ? 0 : WARRIOR.attack.windup) + WARRIOR.attack.active) / swing.speed;
}

export function swingPhase<T>(swing: Swing<T>, time: number) {
    const elapsed = (time - swing.started) * swing.speed;
    const { active, interval } = WARRIOR.attack;
    const windup = swing.skipWindup ? 0 : WARRIOR.attack.windup;
    if (elapsed < windup) return 'windup';
    if (elapsed < windup + active) return 'active';
    if (elapsed < interval) return 'recovery';
    return 'done';
}

export function swingHasContact<T>(swing: Swing<T>, previous: number, time: number) {
    const windup = swing.skipWindup ? 0 : WARRIOR.attack.windup;
    return time >= swing.started + windup / swing.speed
        && previous < swingContactEnd(swing);
}
