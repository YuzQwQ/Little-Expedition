import { heal, type Vital } from './combat.ts';
import { RELIC_FACTIONS, RELIC_FACTION_NAMES, RELICS, type RelicId } from './config.ts';
import { hasFutureShop, takeRelic, unownedRelics, type RunEconomy } from './expedition.ts';
import type { RunRelics } from './relics.ts';

export type WaveModifiers = Partial<Record<'normalAttack' | 'enemyDamage', number>>;
type Resource = 'wave' | 'gold' | 'hp' | 'maxHp' | 'relics';
type Condition = { resource: Resource; minimum: number };
type Effect =
    | { type: 'gold' | 'hp' | 'heal' | 'maxHp'; amount: number }
    | { type: 'randomRelic' }
    | { type: 'nextWave'; modifier: keyof WaveModifiers; bonus: number }
    | { type: 'replaceRelic'; from: RelicId };

interface Outcome {
    weight: number;
    effects: readonly Effect[];
    message?: string;
}

interface Choice {
    label: string;
    detail: string;
    conditions?: readonly Condition[];
    outcomes: readonly Outcome[];
}

export interface Encounter {
    id: string;
    title: string;
    description: string;
    category: 'find' | 'trade' | 'risk' | 'blessing';
    weight: number;
    requiresFutureShop?: boolean;
    availabilityConditions?: readonly Condition[];
    choices: readonly Choice[];
}

export interface EncounterContext {
    wave: number;
    economy: RunEconomy;
    player: Vital;
    relics: RunRelics;
}

export interface EncounterResult {
    action: string;
    summary: string[];
    modifiers: WaveModifiers;
}

const MIN_MAX_HP = 40;
const once = (...effects: Effect[]): readonly Outcome[] => [{ weight: 1, effects }];
const leave: Choice = { label: '离开', detail: '保留当前状态', outcomes: once() };

export const ENCOUNTERS: readonly Encounter[] = [
    {
        id: 'purse', title: '遗失的钱袋', category: 'find', weight: 14, requiresFutureShop: true,
        description: '石缝里卡着一只沾了泥的钱袋，附近找不到失主。',
        choices: [{ label: '捡起钱袋', detail: '获得 80 金币', outcomes: once({ type: 'gold', amount: 80 }) }, leave],
    },
    {
        id: 'altar', title: '古老的祭坛', category: 'trade', weight: 12,
        description: '祭坛的铭文仍在发光。它接受鲜血，也接受金币。',
        choices: [
            { label: '以血献祭', detail: '支付 12 生命，获得随机遗物和 25 金币',
                outcomes: once({ type: 'hp', amount: -12 }, { type: 'randomRelic' }, { type: 'gold', amount: 25 }) },
            { label: '投币祈祷', detail: '支付 20 金币，恢复 45 生命',
                outcomes: once({ type: 'gold', amount: -20 }, { type: 'heal', amount: 45 }) },
            leave,
        ],
    },
    {
        id: 'chest', title: '神秘宝箱', category: 'risk', weight: 12,
        description: '箱扣连着一根拉线。摸索时，你在箱底发现了一个小夹层。',
        choices: [
            { label: '打开箱盖', detail: '75% 获得随机遗物和 30 金币\n25% 损失 12 生命，获得 90 金币',
                outcomes: [
                    { weight: 75, effects: [{ type: 'randomRelic' }, { type: 'gold', amount: 30 }], message: '箱盖顺利打开。' },
                    { weight: 25, effects: [{ type: 'hp', amount: -12 }, { type: 'gold', amount: 90 }], message: '拉线触发了机关。' },
                ] },
            { label: '摸索夹层', detail: '安全取出 50 金币和药剂，恢复 18 生命',
                outcomes: once({ type: 'gold', amount: 50 }, { type: 'heal', amount: 18 }) },
            leave,
        ],
    },
    {
        id: 'collector', title: '流浪收藏家', category: 'trade', weight: 11,
        availabilityConditions: [{ resource: 'gold', minimum: 50 }, { resource: 'relics', minimum: 1 }],
        description: '收藏家递来一个封好的布包，里面装着一件你尚未拥有的遗物。',
        choices: [
            { label: '买下布包', detail: '支付 65 金币，获得随机遗物并恢复 15 生命',
                outcomes: once({ type: 'gold', amount: -65 }, { type: 'randomRelic' }, { type: 'heal', amount: 15 }) },
            leave,
        ],
    },
    {
        id: 'alchemist', title: '可疑的炼金师', category: 'trade', weight: 12,
        description: '炼金师带来了药剂。止痛药明码标价，试剂则要用一点鲜血换取。',
        choices: [
            { label: '喝下止痛药', detail: '支付 45 金币，恢复 55 生命',
                outcomes: once({ type: 'gold', amount: -45 }, { type: 'heal', amount: 55 }) },
            { label: '试用强化药剂', detail: '支付 10 生命，下一波普攻伤害 +35%',
                outcomes: once({ type: 'hp', amount: -10 }, { type: 'nextWave', modifier: 'normalAttack', bonus: 0.35 }) },
            leave,
        ],
    },
    {
        id: 'gamble', title: '命运赌局', category: 'risk', weight: 10, requiresFutureShop: true,
        description: '铜盘上放着一枚双面刻字的硬币。押下赌注后才能掷币。',
        choices: [
            { label: '押下赌注', detail: '支付 35 金币\n50% 获得 145 金币，50% 恢复 20 生命',
                outcomes: [
                    { weight: 1, effects: [{ type: 'gold', amount: -35 }, { type: 'gold', amount: 145 }], message: '硬币落在了你押的那一面。' },
                    { weight: 1, effects: [{ type: 'gold', amount: -35 }, { type: 'heal', amount: 20 }], message: '硬币落在了另一面。' },
                ] },
            leave,
        ],
    },
    {
        id: 'chalice', title: '诅咒的圣杯', category: 'risk', weight: 9,
        description: '杯中漂着一件遗物，杯底的字提醒你，取物和破杯都要付出代价。',
        choices: [
            { label: '接受诅咒', detail: '本局生命上限 −12，获得随机遗物\n当前生命受新上限约束，下一波普攻伤害 +25%',
                outcomes: once({ type: 'maxHp', amount: -12 }, { type: 'randomRelic' },
                    { type: 'nextWave', modifier: 'normalAttack', bonus: 0.25 }) },
            { label: '打破圣杯', detail: '恢复 45 生命，下一波敌人伤害 +15%',
                outcomes: once({ type: 'heal', amount: 45 }, { type: 'nextWave', modifier: 'enemyDamage', bonus: 0.15 }) },
            leave,
        ],
    },
    {
        id: 'elf', title: '精灵的祝福', category: 'blessing', weight: 10,
        availabilityConditions: [{ resource: 'wave', minimum: 3 }],
        description: '精灵愿意为你包扎伤口。她请你在长久的庇护和短暂的力量间做出选择。',
        choices: [
            { label: '接受庇护', detail: '本局生命上限 +18，恢复 30 生命',
                outcomes: once({ type: 'maxHp', amount: 18 }, { type: 'heal', amount: 30 }) },
            { label: '接受剑术祝福', detail: '恢复 20 生命，下一波普攻伤害 +35%',
                outcomes: once({ type: 'heal', amount: 20 }, { type: 'nextWave', modifier: 'normalAttack', bonus: 0.35 }) },
            leave,
        ],
    },
];

function resources({ wave, economy, player, relics }: EncounterContext): Record<Resource, number> {
    return { wave, gold: economy.gold, hp: player.hp, maxHp: player.maxHp, relics: unownedRelics(relics.held).length };
}

function conditionBlock(conditions: readonly Condition[] | undefined, values: Record<Resource, number>) {
    for (const { resource, minimum } of conditions ?? []) {
        if (values[resource] >= minimum) continue;
        switch (resource) {
            case 'gold': return `需要至少 ${minimum} 金币`;
            case 'hp': return `需要至少 ${minimum} 生命`;
            case 'maxHp': return `需要至少 ${minimum} 生命上限`;
            case 'relics': return '没有足够的未持有遗物';
            case 'wave': return `第 ${minimum} 波清场后可选`;
        }
    }
}

function outcomeBlock(outcome: Outcome, values: Record<Resource, number>) {
    let { hp, maxHp, gold, relics } = values;
    // Check each possible outcome without drawing it, in the same order as its effects.
    for (const effect of outcome.effects) {
        switch (effect.type) {
            case 'gold':
                gold += effect.amount;
                if (gold < 0) return `金币不足，需要 ${-effect.amount} 金币`;
                break;
            case 'hp':
                hp += effect.amount;
                if (hp <= 0) return `当前生命必须高于 ${-effect.amount}`;
                break;
            case 'heal':
                hp = Math.min(maxHp, hp + effect.amount);
                break;
            case 'maxHp':
                maxHp += effect.amount;
                if (maxHp < MIN_MAX_HP) return `生命上限不得低于 ${MIN_MAX_HP}`;
                hp = Math.min(hp, maxHp);
                break;
            case 'randomRelic':
                relics -= 1;
                if (relics < 0) return '没有可用的未持有遗物';
                break;
            case 'replaceRelic':
                return '遗物交换暂不可用';
        }
    }
}

function weighted<T extends { weight: number }>(items: readonly T[], random: () => number): T {
    let roll = random() * items.reduce((sum, item) => sum + item.weight, 0);
    for (const item of items) {
        roll -= item.weight;
        if (roll < 0) return item;
    }
    return items[items.length - 1];
}

export function drawEncounter(context: EncounterContext, random = Math.random) {
    const values = resources(context);
    const futureShop = hasFutureShop(context.wave);
    const eligible = ENCOUNTERS.filter(event => (!event.requiresFutureShop || futureShop)
        && !conditionBlock(event.availabilityConditions, values));
    return new EncounterSession(weighted(eligible, random));
}

const signed = (amount: number) => amount >= 0 ? `+${amount}` : `−${-amount}`;
const number = (amount: number) => Number(amount.toFixed(1));

export class EncounterSession {
    readonly event: Encounter;
    private resolved?: EncounterResult;

    constructor(event: Encounter) { this.event = event; }

    choiceBlock(index: number, context: EncounterContext) {
        if (this.resolved) return '该遭遇已结算';
        const choice = this.event.choices[index];
        if (!choice) return '行动不可用';
        const values = resources(context);
        const condition = conditionBlock(choice.conditions, values);
        if (condition) return condition;
        for (const outcome of choice.outcomes) {
            const block = outcomeBlock(outcome, values);
            if (block) return block;
        }
    }

    resolve(index: number, context: EncounterContext, random = Math.random): EncounterResult | undefined {
        if (this.choiceBlock(index, context)) return undefined;
        const choice = this.event.choices[index];
        const outcome = weighted(choice.outcomes, random);
        const { economy, player, relics } = context;
        const summary: string[] = outcome.message ? [outcome.message] : [];
        const modifiers: WaveModifiers = {};
        for (const effect of outcome.effects) {
            switch (effect.type) {
                case 'gold':
                    if (effect.amount < 0) economy.spendGold(-effect.amount);
                    else economy.addGold(effect.amount);
                    summary.push(`金币 ${signed(effect.amount)}`);
                    break;
                case 'hp':
                    player.hp += effect.amount;
                    summary.push(`生命 ${signed(effect.amount)}`);
                    break;
                case 'heal':
                    summary.push(`恢复 ${number(heal(player, effect.amount))} 生命`);
                    break;
                case 'maxHp': {
                    const before = player.hp;
                    player.maxHp += effect.amount;
                    player.hp = Math.min(player.maxHp, player.hp);
                    summary.push(`生命上限 ${signed(effect.amount)}${player.hp < before ? `，当前生命降至 ${player.hp}` : ''}`);
                    break;
                }
                case 'randomRelic': {
                    const pool = unownedRelics(relics.held);
                    const id = takeRelic(pool, random, undefined, relics.blessing);
                    relics.acquire(id, player);
                    summary.push(`获得遗物 · ${RELIC_FACTION_NAMES[RELIC_FACTIONS[id]]} · ${RELICS[id].label}`);
                    break;
                }
                case 'nextWave': {
                    const { modifier, bonus } = effect;
                    modifiers[modifier] = (modifiers[modifier] ?? 1) * (1 + bonus);
                    summary.push(`下一波${modifier === 'normalAttack' ? '普攻伤害' : '敌人伤害'} ${signed(Math.round(bonus * 100))}%`);
                    break;
                }
            }
        }
        if (!summary.length) summary.push('你原样离开。');
        this.resolved = { action: choice.label, summary, modifiers };
        return this.resolved;
    }
}
