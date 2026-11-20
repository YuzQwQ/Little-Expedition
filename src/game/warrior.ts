import { inSector, type Point, type Vital } from './combat.ts';
import { WARRIOR } from './config.ts';

export type Guard = 'block' | 'perfect';

export class WarriorBlock {
    active = false;
    heading = 0;
    private held = false;
    private perfectUntil = 0;
    private rearmAt = 0;
    private queuedCounter?: Guard;

    update(held: boolean, available: boolean, heading: number, time: number) {
        this.active = held && available;
        if (this.active) {
            this.heading = heading;
            if (!this.held && time >= this.rearmAt) {
                this.perfectUntil = time + WARRIOR.block.perfectWindow;
                this.rearmAt = time + WARRIOR.block.perfectRearm;
            }
        } else {
            this.perfectUntil = 0;
        }
        this.held = held;
    }

    perfectReady(time: number) { return this.active && time < this.perfectUntil; }

    guard(player: Point, source: Point, time: number): Guard | undefined {
        if (!this.active || !inSector(player, source, this.heading, Infinity, WARRIOR.block.angle)) return;
        if (this.perfectReady(time)) {
            this.perfectUntil = 0;
            this.queuedCounter = 'perfect';
            return 'perfect';
        }
        this.queuedCounter ??= 'block';
        return 'block';
    }

    get counter() { return this.queuedCounter; }

    takeCounter() {
        const counter = this.queuedCounter;
        this.queuedCounter = undefined;
        return counter;
    }
}

export class WarriorResolve {
    private value = 0;
    private recentGains: { time: number; amount: number }[] = [];
    private readonly normalHitReadyAt = new WeakMap<Vital, number>();

    get amount() { return this.value; }
    get ready() { return this.value >= WARRIOR.resolve.max; }

    spend() {
        if (!this.ready) return false;
        this.value = 0;
        return true;
    }

    onNormalHit(target: Vital, time: number) {
        if (time < (this.normalHitReadyAt.get(target) ?? 0)) return false;
        this.normalHitReadyAt.set(target, time + WARRIOR.resolve.targetInterval);
        return this.gain(WARRIOR.resolve.hit, time);
    }

    onGuard(guard: Guard, time: number) { this.gain(WARRIOR.resolve[guard], time); }
    onPoiseBreak(time: number) { this.gain(WARRIOR.resolve.poiseBreak, time); }

    private gain(requested: number, time: number) {
        const spec = WARRIOR.resolve;
        this.recentGains = this.recentGains.filter(gain => time - gain.time < spec.gainWindow);
        const recentTotal = this.recentGains.reduce((sum, gain) => sum + gain.amount, 0);
        const amount = Math.min(requested, spec.gainCap - recentTotal, spec.max - this.value);
        if (amount <= 0) return false;
        this.value += amount;
        this.recentGains.push({ time, amount });
        return true;
    }
}
