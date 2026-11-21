import assert from 'node:assert/strict';
import test from 'node:test';
import {
    activeShield, createVital, hitProfile, inSector, recoverPoise, resolveHit,
    segmentHits, swingHasContact, swingPhase, swingRange, vulnerabilityBonus,
} from '../src/game/combat.ts';
import { ARCHER, ENEMIES, FROST, RELICS, RELIC_FACTIONS, WAVES, WARRIOR } from '../src/game/config.ts';
import { cancelArcherAim, createArcherState, updateArcher } from '../src/game/archer.ts';
import { advanceEnemyProjectile, launchEnemyProjectile } from '../src/game/enemyProjectiles.ts';
import { GUARDIAN_PHASE, SPECIAL_PATTERNS } from '../src/game/enemyPatterns.ts';
import { advanceSpecial, cancelSpecialAttack, changeGuardianPhase, createSpecialState } from '../src/game/specialEnemy.ts';
import { RunRelics } from '../src/game/relics.ts';
import { calculateStatusChance, closestStatusTargets, EnemyStatuses, spreadPoison } from '../src/game/statuses.ts';
import { REFRESH_COST, RunEconomy, blessingChoices, eventCardsAfter, hasFutureShop, isSupplyStop, killGold, takeRelic, waveSpec } from '../src/game/expedition.ts';
import { WarriorBlock, WarriorResolve } from '../src/game/warrior.ts';
import { MobileInput, stickVector } from '../src/game/mobileControls.ts';
import { normalizeSettings, rotationDegrees, usesMobileControls } from '../src/game/settings.ts';

const origin = { x: 0, y: 0 };
const right = { x: 60, y: 0 };

test('screen preferences validate stored modes, rotation and zoom, and auto mode uses the primary pointer', () => {
    assert.deepEqual(normalizeSettings({ controls: 'invalid', zoom: 10 }), { controls: 'auto', zoom: 1, rotate: 'none' });
    assert.deepEqual(normalizeSettings({ controls: 'mobile', zoom: 1.4 }), { controls: 'mobile', zoom: 1.4, rotate: 'none' });
    assert.deepEqual(normalizeSettings({ rotate: 'cw' }), { controls: 'auto', zoom: 1, rotate: 'cw' });
    assert.deepEqual(normalizeSettings({ rotate: 'sideways' }), { controls: 'auto', zoom: 1, rotate: 'none' });
    assert.equal(rotationDegrees('cw'), 90);
    assert.equal(rotationDegrees('ccw'), -90);
    assert.equal(rotationDegrees('none'), 0);
    assert.equal(usesMobileControls('auto', true), true);
    assert.equal(usesMobileControls('auto', false), false);
    assert.equal(usesMobileControls('desktop', true), false);
    assert.equal(usesMobileControls('mobile', false), true);
});

test('stick input on a rotated frame still points where the player drags', () => {
    const touch = new MobileInput();
    touch.begin('move', 1);
    // Screen-space "up" while the picture is rotated 90° clockwise means "left" in game space.
    touch.move('move', 1, 0, -40, 40, Math.PI / 2);
    const frame = touch.frame(0);
    assert.ok(Math.abs(frame.movement.x + 1) < 1e-9);
    assert.ok(Math.abs(frame.movement.y) < 1e-9);
    touch.move('move', 1, -40, 0, 40, Math.PI / 2);
    assert.ok(Math.abs(touch.frame(0).movement.y - 1) < 1e-9);
    touch.move('move', 1, 0, -40, 40, -Math.PI / 2);
    const counter = touch.frame(0);
    assert.ok(Math.abs(counter.movement.x - 1) < 1e-9);
    assert.ok(Math.abs(counter.movement.y) < 1e-9);
});

test('independent touch pointers move and attack at once, and a brief attack tap is retained', () => {
    const touch = new MobileInput();
    assert.deepEqual(stickVector(2, 2, 40), { x: 0, y: 0 });
    assert.equal(touch.begin('move', 1), true);
    assert.equal(touch.begin('attack', 1), false);
    touch.move('move', 1, 50, 50, 40);
    touch.begin('attack', 2);
    touch.move('attack', 2, 0, -50, 40);
    const frame = touch.frame(0);
    assert.ok(Math.abs(Math.hypot(frame.movement.x, frame.movement.y) - 1) < 1e-9);
    assert.equal(frame.attack, true);
    assert.equal(frame.heading, -Math.PI / 2);
    assert.equal(touch.frame(0).attack, true);
    touch.end('attack', 2);
    touch.begin('attack', 3);
    touch.move('attack', 3, -40, 0, 40);
    touch.end('attack', 3);
    const tap = touch.frame(0);
    assert.equal(tap.heading, Math.PI);
    assert.equal(tap.attack, true);
    assert.equal(touch.frame(0).attack, false);
    assert.ok(touch.frame(0).movement.x > 0);
});

test('held guard follows the drag and ultimate aiming releases once or safely cancels', () => {
    const touch = new MobileInput();
    touch.begin('guard', 1);
    touch.move('guard', 1, 0, 50, 40);
    assert.equal(touch.frame(0).guard, true);
    assert.equal(touch.frame(0).heading, Math.PI / 2);
    touch.move('guard', 1, -50, 0, 40);
    assert.equal(touch.frame(0).heading, Math.PI);
    touch.begin('ultimate', 2);
    touch.move('ultimate', 2, 0, -50, 40);
    touch.move('ultimate', 2, 0, 0, 40);
    const aimed = touch.frame(0);
    assert.equal(aimed.aimingUltimate, true);
    assert.equal(aimed.heading, -Math.PI / 2);
    assert.equal(aimed.castHeading, undefined);
    touch.end('ultimate', 2);
    assert.equal(touch.frame(0).castHeading, -Math.PI / 2);
    assert.equal(touch.frame(0).castHeading, undefined);
    touch.begin('ultimate', 3);
    touch.end('ultimate', 3, true);
    assert.equal(touch.frame(0).castHeading, undefined);
    touch.reset();
    assert.equal(touch.frame(0).guard, false);
});

test('the active window survives late frames and the sector respects direction and range', () => {
    const swing = { heading: 0, started: 0, speed: 1.2, damageScale: 1, hit: new Set() };
    assert.equal(swingPhase(swing, 0.08), 'windup');
    assert.equal(swingPhase(swing, 0.11), 'active');
    assert.equal(swingPhase(swing, 0.13), 'recovery');
    assert.equal(swingPhase(swing, 0.40), 'recovery');
    assert.equal(swingPhase(swing, 0.42), 'done');
    const baseSwing = { ...swing, speed: 1 };
    assert.equal(swingPhase(baseSwing, 0.49), 'recovery');
    assert.equal(swingPhase(baseSwing, 0.50), 'done');
    assert.equal(swingHasContact(swing, 0.08, 0.13), true);
    assert.equal(swingHasContact(swing, 0.13, 0.17), false);
    assert.equal(inSector(origin, right, 0, 90, 100), true);
    assert.equal(inSector(origin, { x: 0, y: -60 }, -Math.PI / 2, 90, 100), true);
    assert.equal(inSector(origin, right, Math.PI, 90, 100), false);
    assert.equal(inSector(origin, { x: 91, y: 0 }, 0, 90, 100), false);
});

test('a directional block charges only on an actual blocked hit and is single-use', () => {
    const player = createVital(100);
    const block = new WarriorBlock();
    block.update(true, true, 0, 0);
    const enemyHit = { origin: right, target: origin, amount: 20, source: 'enemy', block };
    const rear = resolveHit(player, { ...enemyHit, origin: { x: -60, y: 0 } }, 0);
    assert.equal(rear.damage, 20);
    assert.equal(block.counter, undefined);
    assert.equal(resolveHit(player, enemyHit, 0.2), null);
    assert.equal(block.counter, undefined);
    assert.equal(resolveHit(player, enemyHit, 0.31).blocked, true);
    assert.equal(player.hp, 74);
    assert.equal(block.takeCounter(), 'block');
    assert.equal(block.takeCounter(), undefined);
});

test('a perfect guard consumes one front hit, preserves shields and does not grant free invulnerability', () => {
    const player = createVital(100);
    player.shield = 7;
    player.shieldUntil = 1;
    const block = new WarriorBlock();
    block.update(true, true, 0, 0);
    const hit = { origin: right, target: origin, amount: 20, source: 'enemy', block };
    const perfect = resolveHit(player, hit, 0.2);
    assert.equal(perfect.guard, 'perfect');
    assert.equal(perfect.damage, 0);
    assert.equal(player.hp, 100);
    assert.equal(player.shield, 7);
    assert.equal(player.immunityUntil, 0);
    assert.equal(player.knockUntil, 0);
    const repeated = resolveHit(player, hit, 0.21);
    assert.equal(repeated.guard, 'block');
    assert.equal(block.takeCounter(), 'perfect');
    assert.equal(block.takeCounter(), undefined);
});

test('perfect guard cannot refresh by holding, rapid tapping or pressing during a locked action', () => {
    const block = new WarriorBlock();
    block.update(true, true, 0, 0);
    assert.equal(block.perfectReady(0.249), true);
    assert.equal(block.perfectReady(0.25), false);
    block.update(false, true, 0, 0.26);
    block.update(true, true, 0, 0.27);
    assert.equal(block.perfectReady(0.27), false);
    block.update(false, true, 0, 0.46);
    block.update(true, false, 0, 0.47);
    block.update(true, true, 0, 0.55);
    assert.equal(block.perfectReady(0.55), false);
    assert.equal(block.active, true);
    block.update(false, true, 0, 0.56);
    block.update(true, true, 0, 0.57);
    assert.equal(block.perfectReady(0.57), true);
});

test('a parry uses the shared break rules and an armored hit gives no block or knockback', () => {
    const enemy = createVital(100, 45);
    const parry = resolveHit(enemy, { origin, target: right, amount: 0, poise: WARRIOR.block.perfectPoise, source: 'parry' }, 1);
    assert.equal(parry.healthDamage, 0);
    assert.equal(parry.breakDamage, 5);
    assert.equal(parry.tags.canTriggerOnHit, false);
    const player = createVital(100);
    const armored = resolveHit(player, { origin: right, target: origin, amount: 20, source: 'enemy',
        damageReduction: WARRIOR.ultimate.damageReduction, ignoreKnockback: true }, 1);
    assert.equal(armored.healthDamage, 5);
    assert.equal(armored.blocked, false);
    assert.equal(player.knockUntil, 0);
});

test('resolve enforces per-target and rolling gain caps and only spends a full meter', () => {
    const meter = new WarriorResolve(), enemy = createVital(100);
    assert.equal(meter.spend(), false);
    assert.equal(meter.onNormalHit(enemy, 0), true);
    assert.equal(meter.onNormalHit(enemy, 0.39), false);
    assert.equal(meter.onNormalHit(enemy, 0.4), true);
    meter.onGuard('block', 0.4);
    meter.onGuard('perfect', 0.45);
    assert.equal(meter.amount, 21);
    meter.onPoiseBreak(0.8);
    assert.equal(meter.amount, 35);
    meter.onGuard('perfect', 0.99);
    assert.equal(meter.amount, 35);
    meter.onGuard('perfect', 1.01);
    assert.equal(meter.amount, 37);
    for (const time of [2.5, 4, 5.5, 7, 8.5]) meter.onPoiseBreak(time);
    assert.equal(meter.amount, 100);
    assert.equal(meter.spend(), true);
    assert.equal(meter.ready, false);
    assert.equal(meter.amount, 0);
});

test('break damage resolves once and the stun expires before the vulnerability', () => {
    const skeleton = createVital(150, 100);
    skeleton.poise = 15;
    const hit = { origin, target: right, amount: 20, poise: 15, source: 'normal' };
    const first = resolveHit(skeleton, hit, 1);
    assert.equal(first.damage, 20);
    assert.equal(first.breakDamage, 7.5);
    assert.equal(skeleton.hp, 122.5);
    assert.equal(skeleton.stunUntil, 3);
    assert.equal(skeleton.vulnerableUntil, 5);
    const followup = resolveHit(skeleton, hit, 2);
    assert.equal(followup.damage, 25);
    assert.equal(followup.breakDamage, 0);
    assert.equal(skeleton.poise, 0);
    recoverPoise(skeleton, 3);
    assert.equal(skeleton.poise, 100);
    assert.equal(resolveHit(skeleton, hit, 3).damage, 25);
    assert.equal(resolveHit(skeleton, hit, 5).damage, 20);
});

test('the original relics apply once and supplemental damage stays out of hit counters', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    player.hp = 40;
    for (const id of ['whetstone', 'feather', 'badge', 'charm', 'thorn', 'ring']) relics.acquire(id, player);
    relics.acquire('charm', player);
    assert.equal(player.hp, 70);
    assert.equal(player.maxHp, 130);
    assert.equal(relics.attackSpeed(player), 1.2);
    assert.equal(relics.attackDamage, 1.2);
    assert.equal(relics.poiseDamage, 1.4);
    assert.equal(relics.onPlayerDamaged('enemy').damage, 10);
    assert.equal(relics.onPlayerDamaged('thorns'), null);
    const hits = ['normal', 'lightning', 'normal', 'thorns', 'blade', 'aftershock', 'collapse', 'normal', 'normal'];
    assert.deepEqual(hits.map(source => relics.onAttackHit(source)), [0, 0, 0, 0, 0, 0, 0, 0, 15]);
});

test('reward draws contain up to three unique unowned relics', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    const count = Object.keys(RELICS).length;
    assert.equal(count, 66);
    for (let pick = 0; pick < count; pick += 1) {
        const choices = relics.choices(() => 0);
        assert.equal(choices.length, Math.min(3, count - pick));
        assert.equal(new Set(choices).size, choices.length);
        assert.ok(choices.every(id => !relics.held.has(id)));
        relics.acquire(choices[0], player);
    }
    assert.deepEqual(relics.choices(), []);
});

test('the three new status relics enter reward draws and the shop at valid prices', () => {
    const ids = ['catalyst', 'decayBottle', 'statusAmplifier'];
    const held = new Set(Object.keys(RELICS).filter(id => !ids.includes(id)));
    const relics = new RunRelics();
    for (const id of held) relics.acquire(id, createVital(100));
    assert.deepEqual(relics.choices(() => 0), ids);
    const economy = new RunEconomy();
    assert.equal(economy.claimReward(1, held, () => 0).id, 'catalyst');
    economy.openShop(held, () => 0);
    assert.deepEqual(economy.offers.slice(0, 3).map(offer => offer.id), ids);
    assert.ok(economy.offers.slice(0, 3).every(offer => offer.price >= 50 && offer.price <= 300));
});

test('normal waves grow in count and wave 20 fields only a scaling guardian', () => {
    assert.equal(WAVES.length, 20);
    for (let i = 1; i < WAVES.length; i += 1) {
        const before = WAVES[i - 1], next = WAVES[i];
        const count = spec => Object.keys(ENEMIES).reduce((sum, kind) => sum + spec[kind], 0);
        assert.ok(Object.keys(ENEMIES).every(kind => next[kind] >= 0));
        if (i < 19) assert.ok(count(next) >= count(before));
        else assert.equal(count(next), 1);
        assert.ok(next.hpScale > before.hpScale && next.damageScale > before.damageScale);
        for (const kind of ['slime', 'skeleton', 'archer']) {
            assert.ok(killGold(kind, i + 1) >= killGold(kind, i));
        }
    }
    assert.equal(WAVES.findIndex(wave => wave.zealot) + 1, 4);
    assert.equal(WAVES.findIndex(wave => wave.boar) + 1, 6);
    assert.equal(WAVES.findIndex(wave => wave.caster) + 1, 8);
    assert.equal(WAVES.at(-1).guardian, 1);
    assert.equal(killGold('slime', 1), 3);
    assert.equal(killGold('slime', 20), 20);
    assert.equal(killGold('skeleton', 1), 8);
    assert.equal(killGold('skeleton', 20), 50);
});

test('supply stops go straight to the shop with no event cards', () => {
    const supplyNodes = [5, 8, 10, 14, 17];
    for (let wave = 1; wave < WAVES.length; wave += 1) {
        assert.equal(isSupplyStop(wave), supplyNodes.includes(wave));
        assert.deepEqual(eventCardsAfter(wave), isSupplyStop(wave) ? [] : ['battle', 'reward', 'encounter']);
    }
    assert.deepEqual(eventCardsAfter(WAVES.length), []);
});

test('shop supplies heal for free only once per visit and respect the life cap', () => {
    const economy = new RunEconomy();
    const player = createVital(100);
    const held = new Set();
    economy.openShop(held, () => 0);
    assert.equal(economy.claimShopSupply('heal', player, held), undefined);
    player.hp = 25;
    assert.deepEqual(economy.claimShopSupply('heal', player, held), { kind: 'heal', amount: 35 });
    assert.equal(player.hp, 60);
    assert.equal(economy.gold, 0);
    assert.equal(economy.claimShopSupply('relic', player, held, () => 0), undefined);
    economy.openShop(held, () => 0);
    player.hp = 85;
    assert.equal(economy.claimShopSupply('heal', player, held).amount, 15);
    assert.equal(player.hp, 100);
});

test('a free random relic removes matching stock and refreshing does not reset the free claim', () => {
    const economy = new RunEconomy();
    const player = createVital(100);
    const held = new Set();
    economy.openShop(held, () => 0);
    assert.equal(economy.offers[0].id, 'whetstone');
    economy.addGold(50);
    const claim = economy.claimShopSupply('relic', player, held, () => 0);
    held.add(claim.id);
    assert.equal(claim.id, 'whetstone');
    assert.equal(economy.gold, 50);
    assert.equal(new Set(economy.offers.map(offer => offer?.id)).size, 5);
    assert.ok(economy.offers.every(offer => offer && !held.has(offer.id)));
    assert.equal(economy.refresh(held, () => 0), true);
    player.hp = 50;
    assert.equal(economy.claimShopSupply('heal', player, held), undefined);
    assert.deepEqual(economy.claimedSupply, claim);
});

test('a challenge adds 25% HP and a single slime without changing enemy damage', () => {
    for (let wave = 1; wave <= WAVES.length; wave += 1) {
        const base = waveSpec(wave, false);
        const challenge = waveSpec(wave, true);
        assert.equal(challenge.hpScale, base.hpScale * 1.25);
        assert.equal(challenge.damageScale, base.damageScale);
        assert.equal(challenge.slime, base.slime + (base.guardian ? 0 : 1));
        assert.equal(challenge.skeleton, base.skeleton);
        assert.equal(challenge.archer, base.archer);
    }
});

test('archers enter from wave three, retreat only briefly, and fire on the last previewed line', () => {
    assert.deepEqual(WAVES.slice(0, 3).map(wave => wave.archer), [0, 0, 1]);
    assert.equal(WAVES.at(-1).archer, 0);
    const state = createArcherState();
    assert.equal(updateArcher(state, origin, { x: 380, y: 0 }, 0, true), 1);
    assert.equal(updateArcher(state, origin, right, 0, true), -1);
    assert.equal(updateArcher(state, origin, right, ARCHER.retreatDuration - 0.01, true), -1);
    assert.equal(updateArcher(state, origin, right, 0.65, true), 0);
    assert.equal(state.phase, 'aiming');
    assert.equal(updateArcher(state, origin, { x: 0, y: 100 }, 1, true), 0);
    const preview = state.heading;
    assert.equal(updateArcher(state, origin, { x: -100, y: 0 }, 1.2, true), 0);
    assert.equal(updateArcher(state, origin, { x: -100, y: 0 }, state.aimUntil, true), 'fire');
    assert.equal(state.heading, preview);
    assert.equal(preview, Math.PI / 2);
    assert.equal(updateArcher(state, origin, right, state.readyAt - 0.01, true), 0);
    assert.equal(state.phase, 'cooldown');
    assert.equal(updateArcher(state, origin, { x: 210, y: 0 }, state.readyAt, false), 1);
    assert.equal(updateArcher(state, origin, right, state.readyAt + 0.1, true), -1);
});

test('caster alternates three spaced round shots and a five-way diamond fan', () => {
    const state = createSpecialState('caster', 0, 0);
    const later = createSpecialState('caster', 0, 1);
    const at = { x: 260, y: 0 };
    assert.equal(advanceSpecial(state, origin, at, state.readyAt, true), undefined);
    assert.equal(state.active.stage, 'tell');
    advanceSpecial(later, origin, at, state.readyAt, true);
    assert.equal(later.active, undefined);
    for (let i = 0; i < 3; i++) {
        assert.equal(advanceSpecial(state, origin, at, state.active.deadline - 0.01, true), undefined);
        const shot = advanceSpecial(state, origin, { x: 0, y: 260 }, state.active.deadline, true);
        assert.equal(shot.active.heading, 0);
        assert.deepEqual(shot.active.attack.headings, [0]);
        assert.equal(shot.active.attack.projectile.shape, 'orb');
    }
    advanceSpecial(state, origin, at, state.readyAt, true);
    const fan = advanceSpecial(state, origin, at, state.active.deadline, true);
    assert.equal(fan.active.attack.headings.length, 5);
    assert.equal(fan.active.attack.projectile.shape, 'diamond');
    assert.equal(killGold('caster', 8), killGold('skeleton', 8));
});

test('boar commits to a straight charge and zealot gives each of two strikes its own tell', () => {
    const boar = createSpecialState('boar', 0, 0);
    advanceSpecial(boar, origin, right, boar.readyAt, true);
    const charge = advanceSpecial(boar, origin, { x: 0, y: 100 }, boar.active.deadline, true);
    assert.equal(charge.kind, 'charge');
    assert.equal(charge.active.heading, 0);
    assert.ok(charge.active.attack.speed > ENEMIES.zealot.speed);
    cancelSpecialAttack(boar, 3);
    assert.equal(boar.active, undefined);
    assert.equal(boar.readyAt, 3);
    const zealot = createSpecialState('zealot', 0, 0);
    advanceSpecial(zealot, origin, right, zealot.readyAt, true);
    const first = advanceSpecial(zealot, origin, right, zealot.active.deadline, true);
    assert.equal(first.active.attack.kind, 'cone');
    assert.equal(advanceSpecial(zealot, origin, { x: 0, y: 50 }, 0.6, true), undefined);
    assert.equal(zealot.active.stage, 'tell');
    const second = advanceSpecial(zealot, origin, right, zealot.active.deadline, true);
    assert.equal(second.active.heading, Math.PI / 2);
    assert.ok(second.active.attack.damage > first.active.attack.damage);
    assert.equal(ENEMIES.zealot.poise, 0);
});

test('guardian cancels its tell exactly once below half HP and unlocks three distinct slam markers', () => {
    const boss = createSpecialState('guardian', 0, 0);
    advanceSpecial(boss, origin, right, boss.readyAt, true);
    assert.equal(boss.active.attack.kind, 'slam');
    assert.equal(changeGuardianPhase(boss, 50, 100, 1), false);
    assert.equal(changeGuardianPhase(boss, 49, 100, 1), true);
    assert.equal(boss.active, undefined);
    assert.equal(changeGuardianPhase(boss, 25, 100, 1.2), false);
    assert.equal(boss.readyAt, 1 + GUARDIAN_PHASE.transition);
    let time = boss.readyAt;
    for (let i = 0; i < 3; i++) {
        const marked = { x: 55, y: i * 15 };
        advanceSpecial(boss, origin, marked, time, true);
        assert.deepEqual(boss.active.origin, marked);
        time = boss.active.deadline;
        const strike = advanceSpecial(boss, origin, right, time, true);
        assert.equal(strike.active.attack.anchor, 'player');
        time += 0.01;
    }
    assert.equal(boss.phase, 2);
    assert.equal(SPECIAL_PATTERNS.guardian.attacks[2][0].headings.length, 12);
    assert.equal(killGold('guardian', 20), 50);
});

test('enemy shots sweep against walls and moving players and can pierce once', () => {
    const arena = { width: 200, height: 160 };
    const wall = { x: 55, y: 80, width: 8, height: 16 };
    const target = { x: 90, y: 80 };
    const start = { x: 25, y: 80 };
    const fire = () => launchEnemyProjectile(start, 0, ENEMIES.archer.damage, ARCHER.projectile);
    const mustMiss = () => assert.fail('Arrow should miss');
    assert.equal(advanceEnemyProjectile(fire(), 0.3, [wall], arena, target, target, 10, mustMiss), false);
    const dodged = { x: 90, y: 135 };
    assert.equal(advanceEnemyProjectile(fire(), 0.3, [], arena, target, dodged, 10, mustMiss), true);
    let hits = 0;
    const hit = (_, __, fraction) => { hits++; assert.ok(fraction >= 0 && fraction <= 1); return true; };
    assert.equal(advanceEnemyProjectile(fire(), 0.3, [], arena, target, target, 10, hit), false);
    const orb = launchEnemyProjectile(start, 0, 10, { ...ARCHER.projectile, piercesPlayer: true, shape: 'orb', damageType: 'fire' });
    assert.equal(advanceEnemyProjectile(orb, 0.22, [], arena, target, target, 10, hit), true);
    assert.equal(advanceEnemyProjectile(orb, 0.18, [], arena, target, target, 10, mustMiss), true);
    assert.equal(advanceEnemyProjectile(orb, 0.1, [], arena, target, target, 10, mustMiss), false);
    assert.equal(hits, 2);
});

test('enemy projectiles fly past the old range, survive an immune contact, and end at the arena edge', () => {
    const arena = { width: 1200, height: 600 };
    const projectile = launchEnemyProjectile({ x: 50, y: 150 }, 0, 12, ARCHER.projectile);
    const target = { x: 95, y: 150 };
    let avoided = 0;
    const immune = () => { avoided += 1; return false; };
    assert.equal(advanceEnemyProjectile(projectile, 1.5, [], arena, target, target, 10, immune), true);
    assert.equal(avoided, 1);
    assert.equal(projectile.hitPlayer, false);
    assert.ok(projectile.x > 50 + 520);
    assert.equal(advanceEnemyProjectile(projectile, 2, [], arena, target, target, 10, immune), false);
    assert.equal(avoided, 1);
    const vertical = launchEnemyProjectile({ x: 100, y: 80 }, -Math.PI / 2, 12, ARCHER.projectile);
    assert.equal(advanceEnemyProjectile(vertical, 0.5, [], arena, target, target, 10, () => assert.fail('Arrow missed')), false);
});
test('shop-bound reward cards include guaranteed gold and a relic or cash bonus', () => {
    const economy = new RunEconomy();
    const held = new Set(['whetstone']);
    assert.equal(economy.collectKill('slime', 1), 3);
    assert.equal(economy.collectKill('skeleton', 9), 20);
    assert.deepEqual(economy.claimReward(4, held, () => 0), { kind: 'relic', id: 'feather', gold: 50 });
    assert.equal(economy.gold, 73);
    assert.deepEqual(economy.claimReward(4, held, () => 0.50), { kind: 'gold', amount: 110 });
    const exhausted = new Set(Object.keys(RELICS));
    assert.deepEqual(economy.claimReward(16, exhausted, () => 0), { kind: 'gold', amount: 220 });
});

test('rewards after the last shop can use a smaller unowned relic draw', () => {
    assert.equal(hasFutureShop(16), true);
    assert.equal(hasFutureShop(18), false);
    assert.equal(hasFutureShop(19), false);
    const relics = new RunRelics();
    relics.acquire('whetstone', createVital(100));
    assert.deepEqual(relics.choices(() => 0, 2), ['feather', 'charm']);
    assert.deepEqual(relics.choices(() => 0), ['feather', 'charm', 'badge']);
});

test('a shop charges exactly once for sales and keeps sold slots on refresh', () => {
    const economy = new RunEconomy();
    const held = new Set(['whetstone']);
    economy.openShop(held, () => 0);
    assert.equal(economy.offers.length, 5);
    assert.equal(new Set(economy.offers.map(offer => offer.id)).size, 5);
    assert.ok(economy.offers.every(offer => offer.price >= 50 && offer.price <= 300 && !held.has(offer.id)));
    assert.equal(economy.buy(0, held), undefined);
    assert.equal(economy.refresh(held), false);
    assert.equal(economy.gold, 0);
    for (let count = 0; count < 10; count += 1) economy.collectKill('skeleton', 20);
    const stock = economy.offers.map(offer => offer.id);
    const price = economy.offers[0].price;
    const balance = economy.gold;
    held.add(economy.buy(0, held));
    assert.equal(economy.buy(0, held), undefined);
    assert.equal(economy.gold, balance - price);
    assert.equal(economy.refresh(held, () => 0), true);
    assert.equal(economy.gold, balance - price - REFRESH_COST);
    assert.deepEqual(economy.offers[0], { id: stock[0], price, sold: true });
    assert.ok(economy.offers.slice(1).every(offer => !stock.includes(offer.id)));
    economy.openShop(held, () => 0);
    assert.ok(economy.offers.every(offer => !offer.sold && !held.has(offer.id)));
});

test('a limited market keeps five slots and cannot charge for an impossible restock', () => {
    const economy = new RunEconomy();
    const held = new Set(Object.keys(RELICS).filter(id => id !== 'seed'));
    for (let count = 0; count < 20; count += 1) economy.collectKill('skeleton', 20);
    economy.openShop(held);
    assert.deepEqual(economy.offers, [{ id: 'seed', price: 300, sold: false }, null, null, null, null]);
    assert.equal(economy.refresh(held), false);
    held.add(economy.buy(0, held));
    assert.equal(economy.refresh(held), false);
    assert.equal(economy.gold, 700);
    economy.clear();
    assert.equal(economy.gold, 0);
    assert.deepEqual(economy.offers, []);
});

test('the blade counts each released swing and uses swept contacts', () => {
    const relics = new RunRelics();
    relics.acquire('blade', createVital(100));
    assert.deepEqual(Array.from({ length: 6 }, () => relics.onAttackReleased()), [false, false, true, false, false, true]);
    assert.equal(segmentHits(origin, right, { x: 31, y: 8 }, 9), true);
    assert.equal(segmentHits(origin, right, { x: 31, y: 10 }, 9), false);
    assert.equal(segmentHits(origin, right, { x: 70, y: 0 }, 9), false);
});

test('boots grant one use within three seconds and berserk uses a strict threshold', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    relics.acquire('boots', player);
    relics.acquire('berserk', player);
    relics.acquire('feather', player);
    assert.equal(relics.takeDodgeBonus(0), 1);
    relics.onDodgeFinished(5, player);
    assert.equal(relics.takeDodgeBonus(7.99), 1.4);
    assert.equal(relics.takeDodgeBonus(7.99), 1);
    relics.onDodgeFinished(10, player);
    assert.equal(relics.takeDodgeBonus(13), 1);
    player.hp = 40;
    assert.equal(relics.attackSpeed(player), 1.2);
    player.hp = 39.99;
    assert.ok(Math.abs(relics.attackSpeed(player) - 1.55) < 1e-9);
});

test('kill effects respect chance, healing interval and max health', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    relics.acquire('aftershock', player);
    relics.acquire('fang', player);
    player.hp = 95;
    for (let i = 0; i < 4; i += 1) assert.equal(relics.onEnemyKilled(player, () => 0.35), null);
    assert.equal(player.hp, 95);
    assert.equal(relics.onEnemyKilled(player, () => 0.349).damage, 20);
    assert.equal(player.hp, 100);
    player.hp = 0;
    for (let i = 0; i < 5; i += 1) relics.onEnemyKilled(player, () => 1);
    assert.equal(player.hp, 0);
});

test('collapse adds its direct break bonus exactly once', () => {
    const target = createVital(150, 100);
    target.poise = 15;
    const relics = new RunRelics();
    relics.acquire('collapse', createVital(100));
    const hit = { origin, target: right, amount: 20, poise: 15, source: 'normal' };
    assert.equal(resolveHit(target, hit, 1, relics.poiseBurst.bonus).breakDamage, 27.5);
    assert.equal(target.hp, 102.5);
    assert.equal(resolveHit(target, hit, 1.5, RELICS.collapse.bonus).breakDamage, 0);
});

test('critical, follow-up and preparation procs honor their chance boundaries', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    for (const id of ['twin', 'falcon', 'bracer']) relics.acquire(id, player);
    assert.equal(relics.criticalMultiplier(() => 0.15), 1);
    assert.equal(relics.criticalMultiplier(() => 0.149), 1.5);
    assert.equal(relics.rollExtraSlash(() => 0.20), false);
    assert.equal(relics.rollExtraSlash(() => 0.199), true);
    for (const source of ['extraSlash', 'charge', 'echo', 'blade']) relics.onAttackHit(source, () => 0);
    assert.equal(relics.takeWindupSkip(), false);
    relics.onAttackHit('normal', () => 0.15);
    assert.equal(relics.takeWindupSkip(), false);
    relics.onAttackHit('normal', () => 0.149);
    assert.equal(relics.takeWindupSkip(), true);
    assert.equal(relics.takeWindupSkip(), false);
});

test('skipping windup changes the hit window and keeps the attack interval', () => {
    const swift = { heading: 0, started: 0, speed: 1, damageScale: 1, hit: new Set(), skipWindup: true };
    assert.equal(swingPhase(swift, 0), 'active');
    assert.equal(swingHasContact(swift, 0, 0.03), true);
    assert.equal(swingHasContact(swift, 0.05, 0.06), false);
    assert.equal(swingPhase(swift, 0.1), 'recovery');
    assert.equal(swingPhase(swift, 0.49), 'recovery');
    assert.equal(swingPhase(swift, 0.5), 'done');
});

test('tradeoffs combine with existing stats and execution only applies while vulnerable', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    for (const id of ['whetstone', 'feather', 'badge', 'gauntlet', 'iron', 'pendant', 'execution']) relics.acquire(id, player);
    assert.equal(relics.attackDamage, 1.5);
    assert.ok(Math.abs(relics.attackSpeed(player) - 0.95) < 1e-9);
    assert.equal(relics.poiseDamage, 1.65);
    assert.equal(relics.movementSpeed, 1.15);
    assert.equal(relics.dodgeCooldown, 1.02);
    const target = createVital(150, 100);
    target.vulnerableUntil = 5;
    assert.equal(relics.executionMultiplier(target, 4.99), 1.2);
    assert.equal(relics.executionMultiplier(target, 5), 1);
});

test('crest recovers once per wave, seed respects max HP, and crown refreshes on damage', () => {
    const relics = new RunRelics();
    const player = createVital(100);
    for (const id of ['crest', 'seed', 'crown', 'charm']) relics.acquire(id, player);
    player.hp = 39;
    relics.onDamageTaken(player, 43, 1);
    assert.equal(player.hp, 39);
    player.hp = 38;
    relics.onDamageTaken(player, 39, 2);
    assert.equal(player.hp, 58);
    assert.equal(relics.attackDamageAt(4.99), 1.25);
    assert.equal(relics.attackDamageAt(5), 1);
    player.hp = 38;
    relics.onDamageTaken(player, 58, 4);
    assert.equal(player.hp, 38);
    assert.equal(relics.attackDamageAt(6.99), 1.25);
    relics.onWaveCleared(player);
    assert.equal(player.hp, 51);
    relics.onWaveStarted();
    player.hp = 35;
    relics.onDamageTaken(player, 51, 6);
    assert.equal(player.hp, 55);
    player.hp = 126;
    relics.onWaveCleared(player);
    assert.equal(player.hp, 130);
    relics.onWaveStarted();
    player.hp = 0;
    relics.onDamageTaken(player, 41, 8);
    relics.onWaveCleared(player);
    assert.equal(player.hp, 0);
});

test('five types share damage resolution with separate source, critical and resistance factors', () => {
    for (const type of ['physical', 'fire', 'nature', 'frost', 'arcane']) {
        const victim = createVital(100, 0, { [type]: 0.2 });
        const hit = resolveHit(victim, { origin, target: right, amount: 10, source: 'environment', damageType: type }, 0);
        assert.equal(hit.type, type);
        assert.equal(hit.source, 'environment');
        assert.equal(hit.damage, 8);
    }
    const target = createVital(300, 100, { physical: 0.2 });
    target.vulnerableUntil = 4;
    target.markedUntil = 4;
    const bonuses = { global: 0.1, damageOverTime: 0.3, types: { physical: 0.2, fire: 0.5 }, sources: { basicAttack: 0.1 } };
    const normal = resolveHit(target, {
        origin, target: right, amount: 10, source: 'normal', critMultiplier: 1.5, sourceBonus: 0.2, bonuses,
    }, 0);
    assert.equal(vulnerabilityBonus(target, 0), 0.37);
    assert.ok(Math.abs(normal.damage - 10 * 1.1 * 1.2 * 1.3 * 1.5 * 1.37 * 0.8) < 1e-9);
    assert.equal(normal.tags.canTriggerOnHit, true);
    const dot = resolveHit(target, { origin, target: right, amount: 3, source: 'dot', poise: 99, critMultiplier: 9, bonuses }, 1);
    assert.ok(Math.abs(dot.damage - 3 * 1.1 * 1.3 * 1.5 * 1.37) < 1e-9);
    assert.equal(target.poise, 100);
    assert.equal(dot.critical, false);
    assert.equal(dot.tags.canTriggerOnHit, false);
    assert.equal(hitProfile('thorns').type, 'nature');
    assert.equal(hitProfile('lightning').type, 'arcane');
    for (const [resistance, damage] of [[2, 1], [-4, 20]]) {
        const victim = createVital(50, 0, { frost: resistance });
        const hit = resolveHit(victim, { origin, target: right, amount: 10, source: 'environment', damageType: 'frost' }, 0);
        assert.ok(Math.abs(hit.damage - damage) < 1e-9);
    }
});

test('resonance snapshots the HP loss and never reapplies modifiers or triggers ordinary hit events', () => {
    const target = createVital(190, 100, { physical: 0.5 });
    target.markedUntil = 4;
    const main = resolveHit(target, { origin, target: right, amount: 100, source: 'normal' }, 0);
    const echo = resolveHit(target, {
        origin, target: right, amount: main.healthDamage * 0.4, source: 'echoBlade',
        damageType: main.type, critMultiplier: 5, bonuses: { global: 5 },
    }, 0.2);
    assert.equal(echo.damage, main.healthDamage * 0.4);
    assert.equal(echo.critical, false);
    assert.equal(echo.tags.canTriggerOnHit, false);
    assert.equal(echo.tags.secondary, true);
    assert.equal(target.poise, 100);
});

test('only original arcane events can charge relics and every resolved event is unique', () => {
    const relics = new RunRelics(), target = createVital(300);
    const primary = ['lightning', 'prism', 'starlightRing', 'starBottle'];
    const secondaries = ['moonWatch', 'meteorFragment', 'dawnAstrolabe'];
    const ids = new Set();
    for (const source of [...primary, ...secondaries, 'enemy']) {
        const hit = resolveHit(target, { origin, target: right, source, amount: 1, damageType: 'arcane', critMultiplier: 2 }, 0);
        assert.equal(hit.arcane.canTriggerEffects, primary.includes(source));
        assert.equal(hit.tags.canTriggerOnHit, false);
        assert.equal(hit.critical, false);
        if (source !== 'enemy') assert.equal(hit.tags.secondary, secondaries.includes(source));
        assert.equal(ids.has(hit.arcane.id), false);
        ids.add(hit.arcane.id);
        if (primary.includes(source)) {
            assert.equal(relics.onArcaneDamage(hit.arcane, 0, 0), undefined);
            assert.ok(relics.onArcaneDamage(hit.arcane, hit.healthDamage, 0));
        }
        assert.equal(relics.onArcaneDamage(hit.arcane, hit.healthDamage, 0), undefined);
    }
});

test('moon watch and astrolabe count only confirmed original damage and keep charge across waves', () => {
    const relics = new RunRelics(), target = createVital(300);
    for (const id of ['moonWatch', 'dawnAstrolabe']) relics.acquire(id, target);
    for (let i = 1; i <= 6; i += 1) {
        const hit = resolveHit(target, { origin, target: right, source: 'lightning', amount: 5 }, i);
        assert.equal(relics.astrolabeReady, i % 3 === 0);
        assert.deepEqual(relics.onArcaneDamage(hit.arcane, hit.healthDamage, i), { pulse: i === 5, splash: i % 3 === 0 });
        relics.onWaveStarted();
        assert.equal(relics.moonWatchCharge, i % 5);
        assert.equal(relics.astrolabeCharge, i % 3);
        assert.equal(relics.astrolabeFlashing(i), i % 3 === 0);
        const pulse = resolveHit(target, { origin, target: right, source: 'moonWatch', amount: 1 }, i);
        assert.equal(relics.onArcaneDamage(pulse.arcane, pulse.healthDamage, i), undefined);
    }
    assert.equal(new RunRelics().moonWatchCharge, 0);
    assert.equal(new RunRelics().astrolabeCharge, 0);
});

test('derived arcane attacks preserve outgoing damage and resolve the new target independently', () => {
    const relics = new RunRelics();
    const primary = createVital(100);
    relics.acquire('glowPrism', primary);
    const bonuses = { types: { arcane: relics.arcaneDamageBonus } };
    const original = resolveHit(primary, { origin, target: right, source: 'lightning', amount: 15, bonuses }, 0);
    assert.equal(original.damage, 19.5);
    const victim = createVital(100, 100, { arcane: 0.25 });
    victim.vulnerableUntil = 3;
    const pulse = resolveHit(victim, { origin, target: right, source: 'moonWatch', amount: 20, bonuses }, 0);
    assert.equal(pulse.damage, 20 * 1.3 * 1.25 * 0.75);
    for (const [source, scale] of [['meteorFragment', 0.4], ['dawnAstrolabe', 0.3]]) {
        const amount = original.healthDamage * scale;
        const result = resolveHit(victim, { origin, target: right, source, amount,
            bonuses: { ...bonuses, global: 0.4, sources: { relic: 0.1 } } }, 0);
        assert.equal(result.damage, amount * 1.25 * 0.75);
        assert.equal(result.arcane.canTriggerEffects, false);
        assert.equal(victim.poise, 100);
    }
});

test('starlight counts five hits and star bottle waits for the next successful swing after three crits', () => {
    const relics = new RunRelics(), player = createVital(100);
    relics.acquire('starlightRing', player);
    relics.acquire('starBottle', player);
    for (let i = 1; i <= 10; i += 1) assert.equal(relics.onStarlightHit(), i % 5 === 0);
    assert.equal(relics.onStarBottleHit(false, true), false);
    for (let i = 0; i < 3; i += 1) assert.equal(relics.onStarBottleHit(true, i === 0), false);
    assert.equal(relics.starBottleCharge, 3);
    assert.equal(relics.onStarBottleHit(true, false), false);
    assert.equal(relics.starBottleReady, true);
    relics.onWaveStarted();
    assert.equal(relics.onStarBottleHit(true, true), true);
    assert.equal(relics.starBottleCharge, 0);
    assert.equal(relics.onStarBottleHit(false, false), false);
});

test('burn and poison tick independently through their last second, slow only affects movement', () => {
    const statuses = new EnemyStatuses();
    statuses.apply('burning', 0);
    statuses.apply('poison', 0.5);
    statuses.apply('slow', 0);
    assert.equal(statuses.movementMultiplier(1), 0.75);
    statuses.apply('slow', 1);
    assert.equal(statuses.movementMultiplier(3.9), 0.75);
    assert.equal(statuses.movementMultiplier(4), 1);
    const ticks = [];
    const record = (type, amount, time) => ticks.push([type, amount, time]);
    statuses.advance(0.49, record);
    assert.deepEqual(ticks, []);
    statuses.advance(0.5, record);
    assert.deepEqual(ticks, [['fire', 3, 0.5]]);
    statuses.advance(5.5, record);
    assert.deepEqual(ticks.filter(([type]) => type === 'fire').map(([, amount, time]) => [amount, time]),
        [[3, 0.5], [3, 1.5], [3, 2.5], [3, 3.5]]);
    assert.deepEqual(ticks.filter(([type]) => type === 'nature').map(([, amount, time]) => [amount, time]), [[2, 1.5], [2, 2.5], [2, 3.5], [2, 4.5], [2, 5.5]]);
    assert.equal(statuses.hasAilment(5.5), false);
});

test('burning refreshes the shortest stack without resetting that layer’s tick schedule', () => {
    const statuses = new EnemyStatuses();
    for (const time of [0, 0.5, 1, 2]) statuses.apply('burning', time);
    assert.equal(statuses.stacks('burning', 2), 3);
    assert.equal(statuses.stacks('burning', 4.2), 3);
    assert.equal(statuses.stacks('burning', 4.6), 2);
    const ticks = [];
    statuses.advance(6, (type, amount, time) => ticks.push({ type, amount, time }));
    assert.equal(ticks.length, 14);
    assert.equal(ticks.at(-1).time, 5.5);
    statuses.clear();
    statuses.advance(20, () => assert.fail('cleared statuses ticked'));
    assert.equal(statuses.hasAilment(20), false);
});

test('crescent counts starts, combo and hunter track separate per-target windows', () => {
    const relics = new RunRelics();
    const first = createVital(100), second = createVital(100);
    for (const id of ['crescent', 'combo', 'hunter', 'corrosion']) relics.acquire(id, first);
    for (let i = 0; i < 4; i += 1) assert.equal(relics.onAttackStarted(), null);
    const enhanced = relics.onAttackStarted();
    assert.equal(enhanced.bonus, 0.3);
    assert.equal(swingRange({ rangeMultiplier: 1 + enhanced.rangeBonus }), 135);
    assert.equal(swingRange({}), 90);
    assert.equal(relics.onAttackStarted(), null);
    for (let i = 0; i < 3; i += 1) {
        assert.equal(relics.hitDamageBonus(first, i), 0);
        relics.onDirectHit(first, i);
    }
    assert.equal(relics.hitDamageBonus(second, 2), 0);
    assert.equal(first.markedUntil, 0);
    assert.equal(relics.hitDamageBonus(first, 3), 0.3);
    relics.onDirectHit(first, 3);
    assert.equal(first.markedUntil, 7);
    assert.equal(relics.hitDamageBonus(first, 7), 0);
    assert.equal(relics.hitDamageBonus(second, 7), 0);
    relics.forgetTarget(first);
    assert.equal(relics.hitDamageBonus(first, 7.5), 0);
});

test('status chances clamp and add catalyst and amplifier before multiplying', () => {
    assert.equal(calculateStatusChance(0.2, 0, 1, 0), 0.2);
    assert.equal(calculateStatusChance(0.8, 2, 1, 0), 1);
    assert.equal(calculateStatusChance(0.2, 0, 1, 2), 0);
    const relics = new RunRelics(), player = createVital(100);
    const nearEqual = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9);
    relics.acquire('catalyst', player);
    nearEqual(relics.statusChance('burning', RELICS.ember.chance), 0.26);
    nearEqual(relics.statusChance('poison', RELICS.needle.chance), 0.195);
    relics.acquire('statusAmplifier', player);
    nearEqual(relics.statusChance('burning', RELICS.ember.chance), 0.34);
    nearEqual(relics.statusChance('burning', RELICS.ember.chance, {
        resistances: { burning: 0.25 }, statusApplicationMultiplier: 0.5,
    }), 0.1275);
});

test('normal hits roll status separately per enemy and frost stays deterministic', () => {
    const relics = new RunRelics(), first = createVital(100, 0, { fire: 0.8 }), second = createVital(100);
    for (const id of ['ember', 'needle', 'frostPendant']) relics.acquire(id, first);
    const firstStatus = new EnemyStatuses();
    const secondStatus = new EnemyStatuses({ burning: 0.8, poison: 0.5, slow: 1 });
    const hit = (target, statuses) => relics.onDirectHit(target, 1, { resistances: statuses.resistances, random: () => 0.1 });
    assert.deepEqual(hit(first, firstStatus), { burning: true, poison: true, slow: false, echo: false, winterBud: false });
    assert.deepEqual(hit(second, secondStatus), { burning: false, poison: false, slow: false, echo: false, winterBud: false });
    assert.equal(hit(second, secondStatus).slow, false);
    assert.equal(hit(second, secondStatus).slow, false);
    assert.equal(hit(second, secondStatus).slow, true);
    assert.equal(secondStatus.apply('slow', 1), false);
    assert.equal(firstStatus.apply('slow', 1), true);
    assert.equal(firstStatus.movementMultiplier(3.99), 0.75);
    assert.equal(firstStatus.movementMultiplier(4), 1);
});

test('winter bud uses the status hit formula while frost pendant rolls no dice', () => {
    const relics = new RunRelics(), target = createVital(100);
    relics.acquire('frostPendant', target);
    const rolls = Array.from({ length: 5 }, () => relics.onDirectHit(target, 1, { random: () => assert.fail('random roll') }).slow);
    assert.deepEqual(rolls, [false, false, false, false, true]);
    relics.acquire('winterBud', target);
    const proc = (roll, resistances = {}) => relics.onDirectHit(target, 1, { random: () => roll, resistances }).winterBud;
    assert.equal(proc(0.199), true);
    assert.equal(proc(0.20), false);
    relics.acquire('catalyst', target);
    assert.equal(proc(0.25), true);
    assert.equal(proc(0.13, { slow: 0.5 }), false);
    assert.equal(proc(0, { slow: 1 }), false);
});

test('slow refreshes independently, chill expires, and only a fresh eligible application can freeze', () => {
    const status = new EnemyStatuses({ slow: 0.5 });
    for (let i = 0; i < 5; i += 1) assert.deepEqual(status.applySlow(1), { applied: true, frozen: false });
    assert.equal(status.chillStacks(1), 4);
    assert.equal(status.movementMultiplier(1), 0.75);
    assert.equal(status.movementMultiplier(4), 1);
    assert.equal(status.chillStacks(5.99), 4);
    assert.equal(status.chillStacks(6), 0);
    assert.equal(status.applySlow(6, { canFreeze: true, bonusChill: 2 }).frozen, false);
    assert.equal(status.applySlow(6, { canFreeze: true }).frozen, true);
    assert.equal(status.chillStacks(6), 0);
    assert.equal(status.movementMultiplier(6), 0);
    assert.equal(status.applySlow(6, { canFreeze: true }).frozen, false);
    status.clear();
    assert.equal(status.isCold(6), false);
    assert.equal(status.chillStacks(6), 0);
    assert.equal(status.protectionRemaining(7.5), 0);
});

test('freeze duration varies by size and shattering starts protection at the actual thaw', () => {
    const relics = new RunRelics();
    relics.acquire('northStar', createVital(100));
    for (const [size, spec] of Object.entries(FROST.targets)) {
        const status = new EnemyStatuses({}, size);
        status.applySlow(0);
        assert.equal(status.movementMultiplier(0), size === 'boss' ? 0.875 : 0.75);
        const options = { canFreeze: true, bonusChill: 2, freezeDurationBonus: relics.freezeDurationBonus };
        assert.equal(status.applySlow(0, options).frozen, true);
        const thaw = spec.freeze * 1.25;
        assert.equal(status.freezeRemaining(0), thaw);
        assert.equal(status.protectionRemaining(thaw), spec.protection);
        const shatter = thaw / 2;
        status.shatter(shatter);
        assert.equal(status.isFrozen(shatter), false);
        assert.equal(status.protectionRemaining(shatter), spec.protection);
        status.shatter(shatter + 0.01);
        const readyAt = shatter + spec.protection;
        status.applySlow(readyAt - 0.02, options);
        assert.equal(status.applySlow(readyAt - 0.01, options).frozen, false);
        assert.equal(status.chillStacks(readyAt), 4);
        assert.equal(status.isFrozen(readyAt), false);
        assert.equal(status.applySlow(readyAt, options).frozen, true);
    }
});

test('snow fox refreshes one charge which waits for a hit and expires after four seconds', () => {
    const relics = new RunRelics(), player = createVital(100);
    relics.acquire('snowFox', player);
    relics.onDodgeFinished(1, player);
    assert.equal(relics.snowFoxRemaining(3), 2);
    relics.onDodgeFinished(4, player);
    assert.equal(relics.takeSnowFoxHit(7.9), true);
    assert.equal(relics.takeSnowFoxHit(7.9), false);
    relics.onDodgeFinished(8, player);
    assert.equal(relics.takeSnowFoxHit(12), false);
});

test('north star boosts only cold targets and shatter and bell use secondary frost damage', () => {
    const relics = new RunRelics(), player = createVital(100);
    relics.acquire('northStar', player);
    assert.equal(relics.frostDamageBonus(false), 0);
    assert.equal(relics.frostDamageBonus(true), 0.30);
    for (const [source, amount] of [['frostBell', 3], ['shatter', 40]]) {
        const target = createVital(100, 100);
        const result = resolveHit(target, { origin, target: right, source, amount, critMultiplier: 2,
            bonuses: { types: { frost: relics.frostDamageBonus(true) }, sources: { basicAttack: 1 } } }, 0);
        assert.equal(result.healthDamage, amount * 1.3);
        assert.equal(result.type, 'frost');
        assert.equal(result.critical, false);
        assert.equal(result.tags.canTriggerOnHit, false);
        assert.equal(target.poise, 100);
    }
});

test('interrupting an archer clears its committed aim and requires a fresh windup', () => {
    const state = createArcherState();
    assert.equal(updateArcher(state, origin, { x: 200, y: 0 }, 0, true), 0);
    assert.equal(state.phase, 'aiming');
    cancelArcherAim(state);
    assert.equal(state.aimUntil, 0);
    assert.equal(updateArcher(state, origin, { x: 200, y: 0 }, 2, true), 0);
    assert.equal(state.phase, 'aiming');
    assert.equal(state.aimUntil, 2 + ENEMIES.archer.windup);
});

test('duration changes only new and refreshed layers, and stack bonuses can be status-specific', () => {
    const relics = new RunRelics(), player = createVital(100);
    const statuses = new EnemyStatuses();
    statuses.apply('burning', 0, relics.dotModifiers);
    statuses.apply('burning', 0.25, relics.dotModifiers);
    statuses.apply('burning', 0.5, relics.dotModifiers);
    relics.acquire('decayBottle', player);
    assert.deepEqual(statuses.remaining('burning', 1), [3, 3.25, 3.5]);
    statuses.apply('burning', 1, relics.dotModifiers);
    assert.deepEqual(statuses.remaining('burning', 1), [3.25, 3.5, 5.2]);
    assert.equal(statuses.stacks('burning', 4.25), 2);
    const extra = { ...relics.dotModifiers, dotMaxStacksBonus: 1, dotMaxStacksByStatus: { burning: 1 } };
    for (let i = 0; i < 6; i += 1) {
        statuses.apply('poison', 2, extra);
        statuses.apply('burning', 2, extra);
    }
    assert.deepEqual(statuses.remaining('poison', 2), [6.5, 6.5, 6.5, 6.5]);
    assert.equal(statuses.stacks('burning', 2), 5);
    const before = [];
    const newlyApplied = new EnemyStatuses();
    for (let i = 0; i < 4; i += 1) newlyApplied.apply('poison', 0, relics.dotModifiers);
    newlyApplied.advance(0.99, (...tick) => before.push(tick));
    assert.deepEqual(before, []);
});

test('corrosion and catalyst add DOT damage and use the matching elemental bonuses and resistances', () => {
    const relics = new RunRelics();
    relics.acquire('corrosion', createVital(100));
    relics.acquire('catalyst', createVital(100));
    assert.equal(relics.dotDamageBonus, 0.5);
    const hit = { origin, target: right, amount: 10, bonuses: {
        damageOverTime: relics.dotDamageBonus, types: { fire: 0.5, nature: 0.25 }, sources: { basicAttack: 1 },
    } };
    for (const [damageType, damage] of [['fire', 18], ['nature', 15]]) {
        const victim = createVital(12, 100, { fire: 0.2, nature: 0.2 });
        const tick = resolveHit(victim, { ...hit, source: 'dot', damageType, poise: 100, critMultiplier: 2 }, 0);
        assert.equal(tick.damage, damage);
        assert.equal(tick.killed, true);
        assert.equal(tick.tags.canTriggerOnHit, false);
        assert.equal(tick.critical, false);
        assert.equal(victim.poise, 100);
        assert.equal(resolveHit(victim, { ...hit, source: 'dot', damageType }, 1), null);
    }
    assert.equal(resolveHit(createVital(100), { ...hit, source: 'normal' }, 0).damage, 20);
});

test('status synergies are weighted in the relic draft and shop without duplicate offers', () => {
    const relics = new RunRelics();
    relics.acquire('ember', createVital(100));
    const shop = new RunEconomy();
    const draftCorrosion = [], draftPrism = [], shopCorrosion = [], shopPrism = [];
    const sampleCount = (Object.keys(RELICS).length - 1 + 4) * 10;
    for (let i = 0; i < sampleCount; i += 1) {
        const sample = (i + 0.5) / sampleCount;
        const [picked] = relics.choices(() => sample, 1);
        if (picked === 'corrosion') draftCorrosion.push(picked);
        if (picked === 'prism') draftPrism.push(picked);
        let rolls = 0;
        shop.openShop(relics.held, () => rolls++ === 0 ? 0 : sample);
        const offers = shop.offers.map(offer => offer.id);
        assert.equal(new Set(offers).size, 5);
        assert.ok(!offers.includes('ember'));
        if (offers[1] === 'corrosion') shopCorrosion.push(offers[1]);
        if (offers[1] === 'prism') shopPrism.push(offers[1]);
    }
    assert.equal(draftCorrosion.length, 3 * draftPrism.length);
    assert.ok(shopCorrosion.length > 2 * shopPrism.length);
});

test('expedition blessing offers three distinct available factions and is locked to one per run', () => {
    const relics = new RunRelics();
    const factions = blessingChoices(relics.held, () => 0);
    assert.equal(factions.length, 3);
    assert.equal(new Set(factions).size, 3);
    const narrowPool = new Set(Object.keys(RELICS).filter(id => !['feather', 'winterBud', 'frostBell'].includes(id)));
    assert.deepEqual(blessingChoices(narrowPool, () => 0), ['martial', 'frost']);
    assert.deepEqual(blessingChoices(new Set(Object.keys(RELICS))), []);
    assert.equal(relics.chooseBlessing('frost'), true);
    assert.equal(relics.chooseBlessing('fire'), false);
    assert.equal(relics.held.size, 0);
    relics.onWaveStarted();
    assert.equal(relics.blessing, 'frost');
    assert.equal(new RunRelics().blessing, undefined);
});

test('blessing doubles only the chosen faction and multiplies the existing relic synergy weights', () => {
    const held = new Set(['starfire']);
    assert.equal(takeRelic(['ember', 'winterBud'], () => 0.8, held), 'winterBud');
    assert.equal(takeRelic(['ember', 'winterBud'], () => 0.8, held, 'fire'), 'ember');
    const relics = new RunRelics();
    const pool = ['feather', 'winterBud', 'frostBell'];
    for (const id of Object.keys(RELICS)) if (!pool.includes(id)) relics.held.add(id);
    assert.equal(relics.choices(() => 0.23)[0], 'feather');
    relics.chooseBlessing('frost');
    const choices = relics.choices(() => 0.23);
    assert.equal(choices[0], 'winterBud');
    assert.equal(new Set(choices).size, 3);
    assert.ok(choices.every(id => !relics.held.has(id)));
});

test('blessing weights apply to route rewards, shop stock, and the free relic draw', () => {
    const fullPool = Object.keys(RELICS);
    const economy = new RunEconomy();
    const held = new Set(fullPool.filter(id => !['feather', 'winterBud'].includes(id)));
    assert.equal(economy.claimReward(6, held, () => 0.4).id, 'feather');
    assert.equal(economy.claimReward(6, held, () => 0.4, 'frost').id, 'winterBud');
    assert.equal(economy.claimReward(6, held, () => 0.5, 'frost').kind, 'gold');
    economy.openShop(held, () => 0.4, 'frost');
    assert.equal(economy.offers[0].id, 'winterBud');
    const gold = economy.gold;
    assert.deepEqual(economy.claimShopSupply('relic', createVital(100), held, () => 0.4, 'frost'), { kind: 'relic', id: 'winterBud' });
    assert.equal(economy.gold, gold);
    assert.ok(economy.offers.every(offer => offer?.id !== 'winterBud'));

    const budgetHeld = new Set(fullPool.filter(id => !['whetstone', 'frostPendant', 'prism'].includes(id)));
    economy.openShop(budgetHeld, () => 0.4, 'frost');
    assert.deepEqual(economy.offers[0], { id: 'frostPendant', price: 75, sold: false });
});

test('blessed shop refresh weighs new offers while preserving sold slots and the refresh price', () => {
    const available = ['feather', 'charm', 'ring', 'prism', 'crimsonEmber', 'winterBud', 'frostBell', 'starlightRing'];
    const held = new Set(Object.keys(RELICS).filter(id => !available.includes(id)));
    const economy = new RunEconomy();
    economy.addGold(200);
    economy.openShop(held, () => 0);
    assert.equal(economy.buy(0, held), 'feather');
    held.add('feather');
    assert.equal(economy.refresh(held, () => 0.6, 'arcane'), true);
    assert.equal(economy.gold, 200 - 125 - REFRESH_COST);
    assert.deepEqual(economy.offers[0], { id: 'feather', price: 125, sold: true });
    assert.equal(economy.offers[1].id, 'starlightRing');
    const ids = economy.offers.slice(1).filter(Boolean).map(offer => offer.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => !held.has(id)));
});

test('serpent kiss applies on every fourth normal hit and crown raises only the poison cap', () => {
    const relics = new RunRelics(), player = createVital(100);
    assert.equal(relics.onSerpentHit(), false);
    relics.acquire('serpentKiss', player);
    assert.deepEqual(Array.from({ length: 8 }, () => relics.onSerpentHit()),
        [false, false, false, true, false, false, false, true]);
    relics.acquire('bloomCrown', player);
    const status = new EnemyStatuses();
    for (let i = 0; i < 7; i += 1) {
        status.apply('poison', 0, relics.dotModifiers);
        status.apply('burning', 0, relics.dotModifiers);
    }
    assert.equal(status.stacks('poison', 0), 6);
    assert.equal(status.stacks('burning', 0), 3);
    assert.equal(relics.poisonDamageBonus, 0.15);
});

test('wither seed applies fresh poison to the three closest targets and recognizes a lethal final tick', () => {
    const relics = new RunRelics();
    const status = new EnemyStatuses();
    status.apply('poison', 0);
    status.apply('poison', 0);
    status.advance(5, (_, __, time) => {
        if (time === 5) assert.equal(status.stacks('poison', time, true), 2);
    });
    assert.equal(status.stacks('poison', 5, true), 0);
    const targets = [124, 130, 40, 20, 10].map(x => ({ at: { x, y: 0 }, statuses: new EnemyStatuses() }));
    assert.equal(spreadPoison(origin, targets, 5, RELICS.witherSeed, relics.dotModifiers), 3);
    assert.deepEqual(targets.map(target => target.statuses.remaining('poison', 5)), [[], [], [5, 5], [5, 5], [5, 5]]);
});

test('mandrake consumes only three layers with their unpaid ticks and leaves later layers intact', () => {
    const relics = new RunRelics();
    relics.acquire('bloomCrown', createVital(100));
    const status = new EnemyStatuses();
    status.apply('poison', 0, relics.dotModifiers);
    status.apply('poison', 1, relics.dotModifiers);
    assert.equal(status.consumePoison(3, 1), 0);
    status.apply('poison', 2, relics.dotModifiers);
    status.apply('poison', 2, relics.dotModifiers);
    status.advance(2.5, () => {});
    assert.equal(status.consumePoison(3, 2.5), 2 * (3 + 4 + 5));
    assert.equal(status.stacks('poison', 2.5), 1);
    let damage = 0;
    status.advance(7, (_, amount) => { damage += amount; });
    assert.equal(damage, 10);
});

test('the six new relics belong to fire and have their configured shop prices', () => {
    const prices = { eternalWick: 150, crimsonEmber: 200, ashButterfly: 175,
        goldenLily: 250, furnacePendant: 175, phoenixFeather: 225 };
    const economy = new RunEconomy();
    for (const [id, price] of Object.entries(prices)) {
        assert.equal(RELIC_FACTIONS[id], 'fire');
        economy.openShop(new Set(Object.keys(RELICS).filter(relic => relic !== id)), () => 0);
        assert.deepEqual(economy.offers[0], { id, price, sold: false });
    }
});

test('the seven frost relics can appear in draft or shop and charge the listed prices', () => {
    const prices = { winterBud: 150, frostBell: 175, snowFox: 150, iceCrown: 225,
        snowMirror: 250, whiteGarland: 175, northStar: 225 };
    assert.equal(Object.values(RELIC_FACTIONS).filter(faction => faction === 'frost').length, 8);
    for (const [id, price] of Object.entries(prices)) {
        const relics = new RunRelics(), player = createVital(100), economy = new RunEconomy();
        for (const other of Object.keys(RELICS)) if (other !== id) relics.acquire(other, player);
        assert.equal(RELIC_FACTIONS[id], 'frost');
        assert.deepEqual(relics.choices(() => 0), [id]);
        economy.openShop(relics.held, () => 0);
        assert.deepEqual(economy.offers[0], { id, price, sold: false });
        economy.addGold(price);
        assert.equal(economy.buy(0, relics.held), id);
        assert.equal(economy.gold, 0);
        relics.acquire(id, player);
        assert.deepEqual(relics.choices(() => 0), []);
    }
});

test('the six new arcane relics belong to the reward pool and retain their listed shop prices', () => {
    const prices = { starlightRing: 150, glowPrism: 175, moonWatch: 200, meteorFragment: 200,
        starBottle: 225, dawnAstrolabe: 275, ring: 175, prism: 225 };
    assert.equal(Object.values(RELIC_FACTIONS).filter(faction => faction === 'arcane').length, 8);
    for (const [id, price] of Object.entries(prices)) {
        const relics = new RunRelics(), player = createVital(100), economy = new RunEconomy();
        for (const other of Object.keys(RELICS)) if (other !== id) relics.acquire(other, player);
        assert.equal(RELIC_FACTIONS[id], 'arcane');
        assert.deepEqual(relics.choices(() => 0), [id]);
        economy.openShop(relics.held, () => 0);
        assert.deepEqual(economy.offers[0], { id, price, sold: false });
        economy.addGold(price);
        assert.equal(economy.buy(0, relics.held), id);
        assert.equal(economy.gold, 0);
        relics.acquire(id, player);
        assert.deepEqual(relics.choices(() => 0), []);
    }
});

test('eternal wick adds a layer every fourth hit and crimson ember only buffs burning', () => {
    const relics = new RunRelics(), player = createVital(100), status = new EnemyStatuses();
    assert.equal(relics.onWickHit(), false);
    relics.acquire('eternalWick', player);
    assert.deepEqual(Array.from({ length: 8 }, () => relics.onWickHit()),
        [false, false, false, true, false, false, false, true]);
    relics.acquire('crimsonEmber', player);
    for (let i = 0; i < 6; i += 1) {
        assert.equal(status.apply('burning', i * 0.1, relics.dotModifiers), true);
        status.apply('poison', i * 0.1, relics.dotModifiers);
    }
    assert.equal(status.stacks('burning', 1), 5);
    assert.equal(status.stacks('poison', 1), 3);
    assert.equal(relics.burnDamageBonus, 0.30);
    assert.equal(relics.poisonDamageBonus, 0);
    assert.equal(relics.dotDamageBonus, 0);
});

test('ash butterfly selects at most three nearest targets within its spread radius', () => {
    const targets = [161, 50, 80, 160, 110].map(x => ({ at: { x, y: 0 } }));
    assert.deepEqual(closestStatusTargets(origin, targets, RELICS.ashButterfly), [targets[1], targets[2], targets[4]]);
    assert.deepEqual(closestStatusTargets(origin, [targets[0], targets[3]], RELICS.ashButterfly), [targets[3]]);
});

test('golden lily consumes the three oldest burns and times cooldowns per target', () => {
    const relics = new RunRelics(), player = createVital(100), status = new EnemyStatuses();
    const first = createVital(100), second = createVital(100);
    relics.acquire('goldenLily', player);
    relics.acquire('crimsonEmber', player);
    for (const time of [0, 0.25, 0.5, 0.75, 1]) status.apply('burning', time, relics.dotModifiers);
    assert.equal(relics.tryLilyBurst(first, 2, 1), false);
    assert.equal(relics.tryLilyBurst(first, status.stacks('burning', 1), 1), true);
    assert.equal(status.consumeBurning(3, 1), true);
    assert.deepEqual(status.remaining('burning', 1), [3.75, 4]);
    assert.equal(status.consumeBurning(3, 1), false);
    assert.equal(relics.tryLilyBurst(first, 3, 2.99), false);
    assert.equal(relics.tryLilyBurst(second, 3, 2), true);
    assert.equal(relics.tryLilyBurst(first, 3, 3), true);
});

test('lily and furnace use secondary fire damage without ordinary hit or DOT procs', () => {
    for (const source of ['goldenLily', 'furnacePendant']) {
        const vital = createVital(100);
        const hit = resolveHit(vital, { origin, target: right, source, amount: RELICS[source].damage,
            critMultiplier: 2, bonuses: { damageOverTime: 1 } }, 1);
        assert.equal(hit.type, 'fire');
        assert.equal(hit.healthDamage, RELICS[source].damage);
        assert.equal(hit.tags.canTriggerOnHit, false);
        assert.equal(hit.tags.dot, false);
        assert.equal(hit.tags.secondary, true);
    }
});

test('phoenix heals once per wave and keeps an unused burn for the next attack across waves', () => {
    const relics = new RunRelics(), player = createVital(100);
    relics.acquire('phoenixFeather', player);
    player.hp = 45;
    relics.onBurningKill(player);
    assert.equal(player.hp, 55);
    relics.onBurningKill(player);
    assert.equal(player.hp, 55);
    relics.onWaveStarted();
    assert.equal(relics.takePhoenixBurn(), true);
    assert.equal(relics.takePhoenixBurn(), false);
    relics.onBurningKill(player);
    assert.equal(player.hp, 65);
    assert.equal(relics.takePhoenixBurn(), true);
    player.hp = 0;
    relics.onWaveStarted();
    relics.onBurningKill(player);
    assert.equal(player.hp, 0);
    assert.equal(relics.takePhoenixBurn(), false);
});

test('amber shields health, refreshes without stacking, and expires in combat time', () => {
    const relics = new RunRelics(), player = createVital(100);
    for (const id of ['amber', 'crown']) relics.acquire(id, player);
    relics.onDodgeFinished(1, player);
    relics.onDodgeFinished(1.5, player);
    assert.equal(activeShield(player, 1.6), 15);
    const hit = { origin: right, target: origin, amount: 10, source: 'enemy' };
    const result = resolveHit(player, hit, 2);
    assert.equal(result.absorbed, 10);
    assert.equal(result.healthDamage, 0);
    assert.equal(player.hp, 100);
    relics.onDamageTaken(player, 100, 2);
    assert.equal(relics.crownRemaining(2), 0);
    assert.equal(activeShield(player, 3.5), 0);
    assert.equal(resolveHit(player, hit, 3.5).healthDamage, 10);
});

test('guardian, steady boots and watch produce the configured movement and dodge effects', () => {
    const relics = new RunRelics(), player = createVital(100);
    for (const id of ['guardian', 'steadyBoots', 'watch', 'pendant']) relics.acquire(id, player);
    assert.equal(relics.onSuccessfulBlock(0.8, 1), 0.4);
    assert.equal(relics.onSuccessfulBlock(0.3, 1), 0);
    assert.deepEqual([0.70, 0.55, 0.85].map(v => relics.attackMovementMultiplier(v)), [0.85, 0.775, 0.925]);
    player.hp = 35;
    assert.equal(relics.dodgeRecoveryRate(player), 1);
    player.hp = 34.9;
    assert.equal(relics.dodgeCooldown, 1.02);
    assert.ok(Math.abs(relics.dodgeCooldown / relics.dodgeRecoveryRate(player) - 0.714) < 1e-9);
});

test('prism cooldown and kill buff refresh independently', () => {
    const relics = new RunRelics(), target = createVital(100);
    for (const id of ['prism', 'finale']) relics.acquire(id, target);
    assert.equal(relics.prismReady(1), true);
    relics.spendPrism(1);
    assert.equal(relics.prismReady(1.29), false);
    assert.equal(relics.prismReady(1.3), true);
    relics.onVulnerableKill(2);
    relics.onVulnerableKill(3);
    assert.equal(relics.hitDamageBonus(target, 6.99), 0.2);
    assert.equal(relics.hitDamageBonus(target, 7), 0);
});
