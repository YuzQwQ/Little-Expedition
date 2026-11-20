import Phaser from 'phaser';
import { ARCHER, ENEMIES, FIELD, OBSTACLES, type EnemyKind } from './config';
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
        state: 'idle', heading: 0, started: 0, nextAttack: 0,
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
    const clearShot = state.kind !== 'caster' || firstWallContact(at, player, OBSTACLES, spellRadius) === Infinity;
    const event = advanceSpecial(state, at, player, time, clearShot);
    const { active } = state;
    const heading = active?.heading ?? event?.active?.heading ?? direction(at, player);
    sprite.setFlipX(Math.cos(heading) < 0);
    if (active?.stage === 'charge' && active.attack.kind === 'charge') {
        const remaining = Math.max(0, chargeReach(active.origin, heading, active.attack.distance, ENEMIES[enemy.kind].radius)
            - distance(active.origin, at));
        const speed = Math.min(active.attack.speed, remaining / delta);
        if (remaining <= 1) active.deadline = time;
        sprite.setVelocity(Math.cos(heading) * speed, Math.sin(heading) * speed);
    } else if (event?.kind === 'chase') {
        moveEnemy(enemy, heading, time, time < vital.knockUntil ? vital.knock : { x: 0, y: 0 });
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
    if (action === 'fire' || action === 0) enemy.sprite.setVelocity(offset.x, offset.y);
    else moveEnemy(enemy, state.heading + (action < 0 ? Math.PI : 0), time, offset);
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
        if (time - enemy.started < spec.windup) return false;
        enemy.state = 'attack';
        return inSector(at, player, enemy.heading, spec.range, spec.angle);
    }
    if (enemy.state === 'attack') enemy.state = 'recovery';
    if (enemy.state === 'recovery' && time < enemy.nextAttack) return false;

    const heading = direction(at, player, enemy.heading);
    enemy.heading = heading;
    if (player.x !== at.x) sprite.setFlipX(player.x < at.x);

    if (time >= enemy.nextAttack && distance(at, player) <= spec.approach) {
        enemy.state = 'windup';
        enemy.started = time;
        enemy.nextAttack = time + spec.interval;
        return false;
    }

    enemy.state = 'chase';
    moveEnemy(enemy, heading, time, offset);
    return false;
}

function moveEnemy(enemy: Enemy, heading: number, time: number, offset: Point) {
    const { sprite } = enemy;
    const speed = ENEMIES[enemy.kind].speed * enemy.statuses.movementMultiplier(time);
    let vx = Math.cos(heading) * speed;
    let vy = Math.sin(heading) * speed;
    const body = sprite.body;
    if (body) {
        // Bias the slide along a wall if direct pursuit points straight into it.
        if ((vx < 0 ? body.blocked.left : body.blocked.right) && Math.abs(vy) < speed * 0.55) {
            vy = (vy < 0 ? -1 : 1) * speed * 0.65;
        }
        if ((vy < 0 ? body.blocked.up : body.blocked.down) && Math.abs(vx) < speed * 0.55) {
            vx = (vx < 0 ? -1 : 1) * speed * 0.65;
        }
    }
    const desired = new Phaser.Math.Vector2(vx, vy).setLength(speed);
    sprite.setVelocity(desired.x + offset.x, desired.y + offset.y);
}
