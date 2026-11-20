import type { DamageType, Point } from './combat.ts';

export interface EnemyProjectileSpec {
    speed: number;
    radius: number;
    damageType: DamageType;
    piercesPlayer: boolean;
    shape: 'arrow' | 'orb' | 'diamond';
}

export interface EnemyProjectile<Attacker = unknown> extends Point, EnemyProjectileSpec {
    heading: number;
    damage: number;
    hitPlayer: boolean;
    attacker?: Attacker;
}

type Wall = Point & { width: number; height: number };
type Arena = { width: number; height: number };

export function firstBoundaryContact(start: Point, end: Point, arena: Arena, radius: number) {
    let first = Infinity;
    for (const axis of ['x', 'y'] as const) {
        const maximum = (axis === 'x' ? arena.width : arena.height) - radius;
        if (start[axis] <= radius || start[axis] >= maximum) return 0;
        const edge = end[axis] <= radius ? radius : end[axis] >= maximum ? maximum : undefined;
        if (edge !== undefined) first = Math.min(first, (edge - start[axis]) / (end[axis] - start[axis]));
    }
    return first;
}

export function firstWallContact(start: Point, end: Point, walls: readonly Wall[], radius: number) {
    let first = Infinity;
    for (const wall of walls) {
        let enter = 0;
        let exit = 1;
        for (const axis of ['x', 'y'] as const) {
            const half = (axis === 'x' ? wall.width : wall.height) / 2 + radius;
            const offset = start[axis] - wall[axis];
            const step = end[axis] - start[axis];
            if (!step) {
                if (Math.abs(offset) > half) exit = -1;
                continue;
            }
            const a = (-half - offset) / step;
            const b = (half - offset) / step;
            enter = Math.max(enter, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
        }
        if (enter <= exit) first = Math.min(first, enter);
    }
    return first;
}

export function movingCircleContact(start: Point, end: Point, before: Point, after: Point, radius: number) {
    const x = start.x - before.x, y = start.y - before.y;
    const dx = end.x - after.x - x, dy = end.y - after.y - y;
    const c = x * x + y * y - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    const b = x * dx + y * dy;
    const discriminant = b * b - a * c;
    if (!a || b >= 0 || discriminant < 0) return Infinity;
    const impact = (-b - Math.sqrt(discriminant)) / a;
    return impact <= 1 ? impact : Infinity;
}

export function launchEnemyProjectile<Attacker>(at: Point, heading: number, damage: number,
    spec: EnemyProjectileSpec, speedScale = 1, attacker?: Attacker): EnemyProjectile<Attacker> {
    return { ...spec, speed: spec.speed * speedScale, x: at.x, y: at.y, heading, damage, hitPlayer: false, attacker };
}

export function advanceEnemyProjectile(projectile: EnemyProjectile, delta: number, walls: readonly Wall[], arena: Arena,
    before: Point, player: Point, playerRadius: number, onHit: (origin: Point, target: Point, frameFraction: number) => boolean) {
    const travel = projectile.speed * delta;
    const end = { x: projectile.x + Math.cos(projectile.heading) * travel,
        y: projectile.y + Math.sin(projectile.heading) * travel };
    const obstacle = Math.min(firstWallContact(projectile, end, walls, projectile.radius),
        firstBoundaryContact(projectile, end, arena, projectile.radius));
    const impact = projectile.hitPlayer ? Infinity : movingCircleContact(projectile, end, before, player,
        playerRadius + projectile.radius);
    if (impact < obstacle) {
        const target = { x: before.x + (player.x - before.x) * impact, y: before.y + (player.y - before.y) * impact };
        if (onHit({ x: projectile.x, y: projectile.y }, target, impact)) {
            projectile.hitPlayer = true;
            if (!projectile.piercesPlayer) return false;
        }
    }
    if (obstacle !== Infinity) return false;
    projectile.x = end.x;
    projectile.y = end.y;
    return true;
}
