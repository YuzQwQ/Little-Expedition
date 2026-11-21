import Phaser from 'phaser';
import { ARCHER, ENEMIES, ENEMY_MOVEMENT, FIELD, OBSTACLES, type EnemyKind } from './config';
import { offsetAlong, routeAroundWalls } from './enemyMovement';
import { cancelArcherAim, createArcherState, updateArcher, type ArcherState } from './archer';
import { firstWallContact } from './enemyProjectiles';
import { SPECIAL_PATTERNS, isSpecialEnemy } from './enemyPatterns';
import { advanceSpecial, cancelSpecialAttack, changeGuardianPhase, createSpecialState, type SpecialEnemyState } from './specialEnemy';
import { createVital, direction, distance, inSector, recoverPoise, type Point } from './combat';
import { EnemyStatuses } from './statuses';
import type { BattleView, EnemyView } from './view';

type EnemyState = 'idle' | 'chase' | 'windup' | 'attack' | 'recovery' | 'stunned';

export interface Enemy extends EnemyView {
    kind: EnemyKind;
    state: EnemyState;
    heading: number;
    started: number;
    nextAttack: number;
    movementOffset: number;
    retreatUntil?: number;
    waypoint?: Point;
    parryPush?: { velocity: Point; until: number };
    archer?: ArcherState;
    special?: SpecialEnemyState;
}

export function spawnPoint(player: Point, allies: Point[], radius: number): Point {
    const margin = 84;
    const candidates: Point[] = [];
    for (let y = margin; y <= FIELD.height - margin; y += 120) {
        for (let x = margin; x <= FIELD.width - margin; x += 120) {
            if (OBSTACLES.some(stone =>
                Math.abs(stone.x - x) < stone.width / 2 + radius + 30
                && Math.abs(stone.y - y) < stone.height / 2 + radius + 30)) continue;
            if (distance({ x, y }, player) < 310 || allies.some(ally => distance({ x, y }, ally) < 100)) continue;
            candidates.push({ x, y });
        }
    }
    // Start within useful pursuit distance whenever the arrangement of the arena allows it.
    const nearby = candidates.filter(at => distance(at, player) < 650);
    const pool = nearby.length ? nearby : candidates;
    return pool[Phaser.Math.Between(0, pool.length - 1)];
}

export function createEnemy(view: BattleView, scene: Phaser.Scene, kind: EnemyKind, at: Point, hpScale: number,
    time = 0, slot = 0): Enemy {
    const spec = ENEMIES[kind];
    const sprite = view.actor(kind, at);
    const bars = scene.add.graphics().setDepth(12);
    view.world.add(bars);
    return { kind, sprite, bars, vital: createVital(Math.round(spec.hp * hpScale), spec.poise, spec.resistances),
        statuses: new EnemyStatuses(spec.statusResistance, kind === 'guardian' ? 'boss' : spec.poise ? 'medium' : 'small'),
        state: 'idle', heading: 0, started: 0, nextAttack: 0, movementOffset: slot * 0.31,
        archer: kind === 'archer' ? createArcherState(time, slot) : undefined,
        special: isSpecialEnemy(kind) ? createSpecialState(kind, time, slot) : undefined };
}

export function freezeEnemy(enemy: Enemy, time: number) {
    if (enemy.special) cancelSpecialAttack(enemy.special, time);
    if (enemy.archer) cancelArcherAim(enemy.archer);
    if (enemy.state === 'windup' || enemy.state === 'attack') enemy.state = 'recovery';
    enemy.sprite.setVelocity(0).setImmovable(true);
}

export function chargeReach(at: Point, heading: number, range: number, radius: number) {
    const dx = Math.cos(heading) * range, dy = Math.sin(heading) * range;
    const edgeX = dx > 0 ? (FIELD.width - radius - at.x) / dx : dx < 0 ? (radius - at.x) / dx : Infinity;
    const edgeY = dy > 0 ? (FIELD.height - radius - at.y) / dy : dy < 0 ? (radius - at.y) / dy : Infinity;
    const wall = firstWallContact(at, { x: at.x + dx, y: at.y + dy }, OBSTACLES, radius);
    return Math.max(0, Math.min(1, edgeX, edgeY, wall)) * range;
}

export function updateSpecialEnemy(enemy: Enemy, at: Point, player: Point, time: number, delta: number) {
    const state = enemy.special!;
    const { vital, sprite } = enemy;
    recoverPoise(vital, time);
    changeGuardianPhase(state, vital.hp, vital.maxHp, time);
    if (vital.stunUntil) {
        cancelSpecialAttack(state, vital.stunUntil);
        sprite.setVelocity(0);
        return;
    }
    const spellRadius = SPECIAL_PATTERNS.caster.attacks[0][0].projectile.radius;
    const sight = firstWallContact(at, player, OBSTACLES, state.kind === 'caster' ? spellRadius : 0) === Infinity;
    const gap = distance(at, player);
    const spacing = ENEMY_MOVEMENT;
    if (state.kind === 'caster' && !state.active) {
        if (gap >= spacing.casterRetreatReset) enemy.retreatUntil = undefined;
        if (gap < spacing.casterMinDistance) {
            enemy.retreatUntil ??= time + spacing.casterRetreatDuration;
            if (time < enemy.retreatUntil) {
                moveEnemy(enemy, at, offsetAlong(at, direction(player, at), 75), time, { x: 0, y: 0 });
                return;
            }
        }
    }
    const event = advanceSpecial(state, at, player, time, sight || state.kind === 'guardian');
    const { active } = state;
    const heading = active?.heading ?? event?.active?.heading ?? direction(at, player);
    sprite.setFlipX(Math.cos(heading) < 0);
    if (active?.stage === 'charge' && active.attack.kind === 'charge') {
        const remaining = Math.max(0, chargeReach(active.origin, heading, active.attack.distance, ENEMIES[enemy.kind].radius)
            - distance(active.origin, at));
        const speed = Math.min(active.attack.speed, remaining / delta);
        if (remaining <= 1) active.deadline = time;
        sprite.setVelocity(Math.cos(heading) * speed, Math.sin(heading) * speed);
    } else if (active?.stage === 'tell' && active.attack.kind === 'cone') {
        active.origin = { x: at.x, y: at.y };
        lunge(enemy, at, heading, active.deadline, time, spacing.lungeDistance.zealot, { x: 0, y: 0 });
    } else if (event?.kind === 'execute' && event.active.attack.kind === 'cone') {
        event.active.origin = { x: at.x, y: at.y };
        sprite.setVelocity(0);
        if (!sight) return;
    } else if (event?.kind === 'chase') {
        moveEnemy(enemy, at, player, time, time < vital.knockUntil ? vital.knock : { x: 0, y: 0 });
    } else if (!active && !event && !state.steps.length && state.kind !== 'guardian') {
        reposition(enemy, at, heading, gap, time, { x: 0, y: 0 },
            state.kind === 'caster' ? 0 : SPECIAL_PATTERNS[state.kind].engage + spacing.meleeSpacing);
    } else {
        sprite.setVelocity(0);
    }
    return event;
}
export function updateArcherEnemy(enemy: Enemy, at: Point, player: Point, time: number) {
    const state = enemy.archer!;
    const clear = state.phase === 'aiming' || firstWallContact(at, player, OBSTACLES, ARCHER.projectile.radius) === Infinity;
    const action = updateArcher(state, at, player, time, clear);
    enemy.sprite.setFlipX(Math.cos(state.heading) < 0);
    const offset = time < enemy.vital.knockUntil ? enemy.vital.knock : { x: 0, y: 0 };
    if (action === 'fire' || state.phase === 'aiming') enemy.sprite.setVelocity(offset.x, offset.y);
    else if (action === 0) reposition(enemy, at, state.heading, distance(at, player), time, offset);
    else moveEnemy(enemy, at, action < 0 ? offsetAlong(at, state.heading + Math.PI, 80) : player, time, offset);
    return action === 'fire';
}

export function updateEnemy(enemy: Enemy, at: Point, player: Point, time: number) {
    const { sprite, vital } = enemy;
    if (enemy.kind !== 'slime' && enemy.kind !== 'skeleton') return false;
    const spec = ENEMIES[enemy.kind];
    recoverPoise(vital, time);
    const knocked = time < vital.knockUntil;
    const offset = knocked ? vital.knock : { x: 0, y: 0 };
    sprite.setVelocity(offset.x, offset.y);

    if (vital.stunUntil) {
        enemy.state = 'stunned';
        return false;
    }
    if (enemy.state === 'windup') {
        if (time - enemy.started < spec.windup) {
            if (!knocked) lunge(enemy, at, enemy.heading, enemy.started + spec.windup, time,
                ENEMY_MOVEMENT.lungeDistance[enemy.kind], offset);
            return false;
        }
        enemy.state = 'attack';
        return firstWallContact(at, player, OBSTACLES, 0) === Infinity
            && inSector(at, player, enemy.heading, spec.range, spec.angle);
    }
    if (enemy.state === 'attack') enemy.state = 'recovery';
    const heading = direction(at, player, enemy.heading);
    enemy.heading = heading;
    if (player.x !== at.x) sprite.setFlipX(player.x < at.x);

    const gap = distance(at, player);
    if (time < enemy.nextAttack) {
        reposition(enemy, at, heading, gap, time, offset, spec.approach + ENEMY_MOVEMENT.meleeSpacing);
        return false;
    }
    if (gap <= spec.approach + ENEMY_MOVEMENT.lungeDistance[enemy.kind] * 0.5
        && firstWallContact(at, player, OBSTACLES, 0) === Infinity) {
        enemy.state = 'windup';
        enemy.started = time;
        enemy.nextAttack = time + spec.interval;
        return false;
    }

    enemy.state = 'chase';
    moveEnemy(enemy, at, player, time, offset);
    return false;
}

function reposition(enemy: Enemy, at: Point, heading: number, gap: number, time: number, offset: Point, spacing = 0) {
    const tuning = ENEMY_MOVEMENT;
    if (gap < spacing - 4) {
        moveEnemy(enemy, at, offsetAlong(at, heading + Math.PI, 55), time, offset, tuning.retreatSpeed);
        return;
    }
    const cycle = (time + enemy.movementOffset) / tuning.sidestepPeriod;
    if ((cycle % 1) * tuning.sidestepPeriod >= tuning.sidestepDuration) {
        enemy.sprite.setVelocity(offset.x, offset.y);
        return;
    }
    const side = Math.floor(cycle) % 2 ? -1 : 1;
    moveEnemy(enemy, at, offsetAlong(at, heading + side * Math.PI / 2, 65), time, offset, tuning.sidestepSpeed);
}

function lunge(enemy: Enemy, at: Point, heading: number, deadline: number, time: number, reach: number, offset: Point) {
    const window = ENEMY_MOVEMENT.lungeWindow;
    const remaining = deadline - time;
    if (remaining > window || chargeReach(at, heading, reach, ENEMIES[enemy.kind].radius) <= 1) {
        enemy.sprite.setVelocity(offset.x, offset.y);
        return;
    }
    const speed = reach / window * enemy.statuses.movementMultiplier(time);
    enemy.sprite.setVelocity(Math.cos(heading) * speed + offset.x, Math.sin(heading) * speed + offset.y);
}

function moveEnemy(enemy: Enemy, at: Point, goal: Point, time: number, offset: Point, multiplier = 1) {
    const spec = ENEMIES[enemy.kind];
    const target = routeAroundWalls(at, goal, spec.radius, enemy.waypoint);
    enemy.waypoint = target === goal || target === at ? undefined : target;
    const speed = target === at ? 0 : spec.speed * enemy.statuses.movementMultiplier(time) * multiplier;
    const heading = direction(at, target);
    enemy.sprite.setVelocity(Math.cos(heading) * speed + offset.x, Math.sin(heading) * speed + offset.y);
}
