import assert from 'node:assert/strict';
import test from 'node:test';
import { createVital } from '../src/game/combat.ts';
import { RELICS } from '../src/game/config.ts';
import { ENCOUNTERS, EncounterSession, drawEncounter } from '../src/game/encounters.ts';
import { RunEconomy } from '../src/game/expedition.ts';
import { RunRelics } from '../src/game/relics.ts';

function context({ gold = 100, hp = 75, wave = 6 } = {}) {
    const economy = new RunEconomy();
    const player = createVital(100);
    economy.addGold(gold);
    player.hp = hp;
    return { wave, economy, player, relics: new RunRelics() };
}

const session = id => new EncounterSession(ENCOUNTERS.find(event => event.id === id));

test('all eight events can be drawn at their weight and conditions remove ineligible events', () => {
    const state = context();
    const weight = ENCOUNTERS.reduce((sum, event) => sum + event.weight, 0);
    assert.equal(ENCOUNTERS.length, 8);
    let offset = 0;
    for (const event of ENCOUNTERS) {
        const run = drawEncounter(state, () => (offset + event.weight / 2) / weight);
        assert.equal(run.event.id, event.id);
        assert.ok(run.event.choices.length >= 2 && run.event.choices.length <= 3);
        offset += event.weight;
    }
    const early = context({ gold: 49, wave: 2 });
    const eligible = new Set(Array.from({ length: 100 }, (_, i) => drawEncounter(early, () => i / 100).event.id));
    assert.equal(eligible.size, 6);
    assert.ok(!eligible.has('collector') && !eligible.has('elf'));
    const late = context({ wave: 18 });
    const lateEvents = new Set(Array.from({ length: 100 }, (_, i) => drawEncounter(late, () => i / 100).event.id));
    assert.equal(lateEvents.size, 6);
    assert.ok(!lateEvents.has('purse') && !lateEvents.has('gamble') && lateEvents.has('collector'));
});

test('an unaffordable purchase cannot charge gold, roll an outcome, or award a relic', () => {
    const state = context({ gold: 64 });
    const offer = session('collector');
    assert.match(offer.choiceBlock(0, state), /65 金币/);
    assert.equal(offer.resolve(0, state, () => assert.fail('blocked choice rolled RNG')), undefined);
    assert.equal(state.economy.gold, 64);
    assert.equal(state.relics.held.size, 0);
    state.economy.addGold(1);
    state.relics.acquire('whetstone', state.player);
    assert.ok(offer.resolve(0, state, () => 0));
    assert.deepEqual([...state.relics.held], ['whetstone', 'feather']);
    assert.equal(state.economy.gold, 0);
    assert.equal(state.player.hp, 90);
    assert.equal(state.economy.spendGold(1), false);
    state.economy.addGold(-1);
    assert.equal(state.economy.gold, 0);
});

test('lethal costs and unavailable relics block an action before drawing any possible branch', () => {
    const state = context({ hp: 12 });
    const chest = session('chest');
    const altar = session('altar');
    assert.match(chest.choiceBlock(0, state), /高于 12/);
    assert.equal(chest.resolve(0, state, () => assert.fail('lethal choice rolled RNG')), undefined);
    assert.match(altar.choiceBlock(0, state), /高于 12/);
    state.player.hp = 13;
    assert.ok(chest.resolve(0, state, () => 0.99));
    assert.equal(state.player.hp, 1);
    assert.equal(state.economy.gold, 190);
    state.player.hp = 35;
    for (const id of Object.keys(RELICS)) state.relics.acquire(id, state.player);
    assert.match(altar.choiceBlock(0, state), /没有可用/);
    assert.ok(altar.resolve(2, state));
    assert.equal(state.relics.held.size, Object.keys(RELICS).length);
});

test('random encounter relics use the run blessing without changing the encounter cost', () => {
    const state = context();
    for (const id of Object.keys(RELICS)) if (!['feather', 'winterBud'].includes(id)) state.relics.held.add(id);
    assert.equal(state.relics.chooseBlessing('frost'), true);
    assert.ok(session('altar').resolve(0, state, () => 0.4));
    assert.equal(state.relics.held.has('winterBud'), true);
    assert.equal(state.relics.held.has('feather'), false);
    assert.equal(state.player.hp, 63);
    assert.equal(state.economy.gold, 125);
});

test('a resolution rolls once, applies steps in order, and cannot be claimed again', () => {
    const state = context({ gold: 35 });
    const gamble = session('gamble');
    let rolls = 0;
    const random = () => { rolls += 1; return 0.49; };
    assert.equal(gamble.choiceBlock(0, state), undefined);
    assert.equal(rolls, 0);
    const win = gamble.resolve(0, state, random);
    assert.deepEqual(win.summary.slice(1), ['金币 −35', '金币 +145']);
    assert.equal(state.economy.gold, 145);
    assert.equal(gamble.resolve(0, state, random), undefined);
    assert.equal(state.economy.gold, 145);
    assert.equal(rolls, 1);
    const loss = session('gamble').resolve(0, state, () => 0.50);
    assert.deepEqual(loss.summary.slice(1), ['金币 −35', '恢复 20 生命']);
    assert.equal(state.economy.gold, 110);
});

test('max health effects cap current health and show actual restoration after ordered changes', () => {
    const state = context({ hp: 100 });
    assert.ok(session('chalice').resolve(0, state, () => 0));
    assert.equal(state.player.maxHp, 88);
    assert.equal(state.player.hp, 88);
    const blessing = session('elf').resolve(0, state);
    assert.deepEqual(blessing.summary, ['生命上限 +18', '恢复 18 生命']);
    assert.equal(state.player.maxHp, 106);
    assert.equal(state.player.hp, 106);
    state.player.maxHp = 51;
    state.player.hp = 10;
    assert.match(session('chalice').choiceBlock(0, state), /不得低于 40/);
});

test('each event can conclude and temporary effects are issued to the next wave only once', () => {
    for (const event of ENCOUNTERS) {
        const state = context();
        const current = new EncounterSession(event);
        const action = current.resolve(0, state, () => 0);
        assert.ok(action?.summary.length, event.title);
        assert.equal(current.resolve(0, state), undefined);
    }
    const state = context();
    const brew = session('alchemist');
    assert.deepEqual(brew.resolve(1, state).modifiers, { normalAttack: 1.35 });
    assert.equal(state.player.hp, 65);
    assert.equal(brew.resolve(1, state), undefined);
    assert.deepEqual(session('chalice').resolve(1, state).modifiers, { enemyDamage: 1.15 });
});
