import { distance, type Point } from './combat.ts';
import { FIELD, OBSTACLES } from './config.ts';
import { firstWallContact } from './enemyProjectiles.ts';

export function routeAroundWalls(at: Point, goal: Point, radius: number, waypoint?: Point): Point {
    const clearance = Math.max(0, radius - 1);
    const wall = OBSTACLES.reduce<(typeof OBSTACLES)[number] | undefined>((nearest, candidate) => {
        const hit = firstWallContact(at, goal, [candidate], clearance);
        if (hit === Infinity) return nearest;
        return !nearest || hit < firstWallContact(at, goal, [nearest], clearance) ? candidate : nearest;
    }, undefined);
    if (!wall) return goal;
    if (waypoint && distance(at, waypoint) >= 8
        && firstWallContact(at, waypoint, OBSTACLES, clearance) === Infinity) return waypoint;

    const x = wall.width / 2 + radius + 9;
    const y = wall.height / 2 + radius + 9;
    const corners = [-x, x].flatMap(dx => [-y, y].map(dy => ({ x: wall.x + dx, y: wall.y + dy })));
    let best = at;
    let cost = Infinity;
    for (const corner of corners) {
        const travel = distance(at, corner);
        if (travel < 8 || corner.x < radius || corner.x > FIELD.width - radius
            || corner.y < radius || corner.y > FIELD.height - radius
            || firstWallContact(at, corner, OBSTACLES, clearance) !== Infinity) continue;
        const remaining = firstWallContact(corner, goal, [wall], clearance) === Infinity
            ? distance(corner, goal)
            : Math.min(...corners.filter(exit => firstWallContact(corner, exit, [wall], clearance) === Infinity
                && firstWallContact(exit, goal, [wall], clearance) === Infinity)
                .map(exit => distance(corner, exit) + distance(exit, goal)));
        // A short repositioning target can itself be inside the wall.
        const score = travel + (Number.isFinite(remaining) ? remaining : distance(corner, goal) + x + y);
        if (score >= cost) continue;
        cost = score;
        best = corner;
    }
    return best;
}

export function offsetAlong(at: Point, heading: number, amount: number): Point {
    return { x: at.x + Math.cos(heading) * amount, y: at.y + Math.sin(heading) * amount };
}
