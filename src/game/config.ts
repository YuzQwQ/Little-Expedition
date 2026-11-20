import type { Resistances } from './combat.ts';
import type { StatusResistances } from './statuses.ts';
import type { SpecialEnemyKind } from './enemyPatterns.ts';

export const VIEW = { width: 1280, height: 720 };
export const FIELD = { width: 1600, height: 1000 };

export const WARRIOR = {
    maxHp: 100,
    speed: 220,
    radius: 17,
    attack: {
        damage: 20,
        statusApplicationMultiplier: 1,
        poise: 15,
        range: 90,
        angle: 100,
        windup: 0.10,
        active: 0.05,
        recovery: 0.35,
        get interval() { return this.windup + this.active + this.recovery; },
        windupSpeed: 0.70,
        activeSpeed: 0.55,
        recoverySpeed: 0.85,
    },
    block: {
        angle: 120, speed: 0.50, reduction: 0.70, bonus: 0.50,
        perfectWindow: 0.25, perfectRearm: 0.45, perfectPoise: 45,
        repelSpeed: 270, repelDuration: 0.16, bossRepelMultiplier: 0.45,
        counterRange: 1.45, counterAngle: 130, counterPoise: 2,
    },
    resolve: {
        max: 100, hit: 2, block: 5, perfect: 12, poiseBreak: 15,
        hitTargetsPerSwing: 3, targetInterval: 0.4, gainWindow: 1, gainCap: 35,
    },
    ultimate: {
        damage: 3.5, range: 2.5, poise: 4, angle: 135, brokenBonus: 0.25,
        windup: 0.42, active: 0.12, recovery: 0.22, damageReduction: 0.75, movement: 0.35,
        get duration() { return this.windup + this.active + this.recovery; },
    },
    dodge: { duration: 0.22, immunity: 0.15, speed: 3, cooldown: 1.2, trailInterval: 0.035 },
    hitImmunity: 0.30,
};

export const FROST = {
    slow: { duration: 3, penalty: 0.25 },
    chill: { duration: 5, maxStacks: 4 },
    targets: {
        small: { freeze: 1.5, protection: 2, slowScale: 1 },
        medium: { freeze: 0.8, protection: 3, slowScale: 1 },
        boss: { freeze: 0.35, protection: 6, slowScale: 0.5 },
    },
} as const;

type BasicEnemyKind = 'slime' | 'skeleton' | 'archer';
export type EnemyKind = BasicEnemyKind | SpecialEnemyKind;

export const ARCHER = {
    minDistance: 150,
    retreatResetDistance: 175,
    retreatDuration: 0.65,
    fixedAimDuration: 0.20,
    stagger: 0.12,
    projectile: { speed: 400, radius: 8, damageType: 'physical' as const, piercesPlayer: false, shape: 'arrow' as const },
};

interface EnemySpec {
    label: string;
    hp: number;
    speed: number;
    radius: number;
    poise: number;
    warning: number;
    resistances?: Resistances;
    statusResistance?: StatusResistances;
}

interface BasicEnemySpec extends EnemySpec {
    approach: number;
    range: number;
    angle: number;
    damage: number;
    interval: number;
    windup: number;
}

export const ENEMIES: Record<BasicEnemyKind, BasicEnemySpec> & Record<SpecialEnemyKind, EnemySpec> = {
    slime: {
        label: '史莱姆', hp: 45, speed: 110, radius: 15, approach: 45, range: 45,
        angle: 360, damage: 10, interval: 1.5, windup: 0.35, poise: 0, warning: 0xe5b877,
    },
    skeleton: {
        label: '持盾骷髅', hp: 150, speed: 80, radius: 19, approach: 70, range: 80,
        angle: 100, damage: 20, interval: 2, windup: 0.65, poise: 100, warning: 0xe48378,
    },
    archer: {
        label: '哥布林弓箭手', hp: 55, speed: 95, radius: 16, approach: 350, range: 520,
        angle: 0, damage: 12, interval: 2.2, windup: 0.65, poise: 0, warning: 0xff777b,
    },
    caster: {
        label: '骷髅术士', hp: 110, speed: 76, radius: 19, poise: 82, warning: 0xf47a89,
    },
    boar: {
        label: '野猪', hp: 145, speed: 84, radius: 23, poise: 106, warning: 0xf07b66,
    },
    zealot: {
        label: '哥布林狂徒', hp: 60, speed: 136, radius: 16, poise: 0, warning: 0xef8783,
    },
    guardian: {
        label: '遗迹石像守卫', hp: 620, speed: 86, radius: 36, poise: 180, warning: 0xff8078,
    },
};

export const BREAK = { bonusHpFraction: 0.05, stun: 2, vulnerability: 0.25, duration: 4 };
export const IMPACT = { speed: 98, duration: 0.11, flash: 0.095 };
export const OBSTACLES = [
    { x: 395, y: 270, width: 132, height: 72 },
    { x: 1185, y: 270, width: 120, height: 64 },
    { x: 342, y: 715, width: 82, height: 114 },
    { x: 1236, y: 721, width: 88, height: 112 },
    { x: 804, y: 810, width: 152, height: 58 },
];

export const WAVES = [
    { slime: 3, skeleton: 0 },
    { slime: 4, skeleton: 0 },
    { slime: 4, skeleton: 1 },
    { slime: 5, skeleton: 1 },
    { slime: 5, skeleton: 2 },
    { slime: 6, skeleton: 2 },
    { slime: 6, skeleton: 3 },
    { slime: 7, skeleton: 3 },
    { slime: 7, skeleton: 4 },
    { slime: 8, skeleton: 4 },
    { slime: 8, skeleton: 4 },
    { slime: 9, skeleton: 4 },
    { slime: 9, skeleton: 5 },
    { slime: 10, skeleton: 5 },
    { slime: 10, skeleton: 6 },
    { slime: 11, skeleton: 6 },
    { slime: 11, skeleton: 7 },
    { slime: 12, skeleton: 7 },
    { slime: 12, skeleton: 8 },
    { slime: 13, skeleton: 8 },
].map((enemies, index) => {
    const early = Math.min(index, 9);
    const late = index - early;
    const archer = index < 2 ? 0 : index < 7 ? 1 : index < 14 ? 2 : 3;
    const zealot = index < 3 ? 0 : index < 10 ? 1 : 2;
    const boar = index < 5 ? 0 : index < 13 ? 1 : 2;
    const caster = index < 7 ? 0 : index < 15 ? 1 : 2;
    const guardian = index === 19 ? 1 : 0;
    const roster = guardian ? { slime: 0, skeleton: 0, archer: 0, zealot: 0, boar: 0, caster: 0 }
        : { slime: enemies.slime - archer - zealot, skeleton: enemies.skeleton - boar - caster, archer, zealot, boar, caster };
    return { ...roster, guardian,
        hpScale: 1 + early * 0.06 + late * 0.035, damageScale: 1 + early * 0.05 + late * 0.025 };
});

export const RELICS = {
    whetstone: { icon: '◇', label: '锋利磨刀石', description: '普通攻击伤害 +20%', bonus: 0.20 },
    feather: { icon: '»', label: '迅捷羽毛', description: '普通攻击速度 +20%', bonus: 0.20 },
    charm: { icon: '+', label: '厚实护符', description: '生命上限 +30\n立即恢复 30 生命', amount: 30 },
    badge: { icon: '✦', label: '破碎徽章', description: '韧性伤害 +40%', bonus: 0.40 },
    thorn: { icon: '✧', label: '荆棘护甲', description: '受伤时对附近敌人\n造成 10 点伤害', damage: 10, range: 100 },
    ring: { icon: 'ϟ', label: '雷鸣戒指', description: '每第 4 次普通攻击命中\n追加 15 点雷电伤害', every: 4, damage: 15 },
    blade: { icon: '⟐', label: '回旋之刃', description: '每第 3 次普攻发射穿透飞刃\n造成 12 点伤害', every: 3, damage: 12, speed: 720, distance: 480, radius: 9 },
    boots: { icon: '⟫', label: '疾风之靴', description: '闪避结束后，3 秒内\n下一次普攻伤害 +40%', bonus: 0.40, duration: 3 },
    aftershock: { icon: '✸', label: '余震核心', description: '击杀时有 35% 概率爆炸\n对附近敌人造成 20 点伤害', chance: 0.35, damage: 20, range: 88 },
    fang: { icon: '❯', label: '吸血獠牙', description: '每击杀 5 名敌人\n恢复 8 点生命值', every: 5, heal: 8 },
    berserk: { icon: '♢', label: '狂战士契约', description: '生命值低于 40% 时\n普攻速度 +35%', threshold: 0.40, bonus: 0.35 },
    collapse: { icon: '✷', label: '崩解之心', description: '破韧时对目标追加 20 点伤害\n对附近敌人造成 10 点伤害', bonus: 20, damage: 10, range: 105 },
    twin: { icon: '✕', label: '双刃徽记', description: '每次普攻有 20% 概率\n追加一次 50% 伤害的斩击', chance: 0.20, damageScale: 0.50, delay: 0.10 },
    falcon: { icon: '◉', label: '猎鹰之眼', description: '普攻暴击率 +15%\n暴击造成 150% 伤害', chance: 0.15, damageScale: 1.50 },
    bracer: { icon: '≋', label: '破风护腕', description: '普攻命中有 15% 概率\n让下次普攻跳过前摇\n仍遵守攻击间隔', chance: 0.15 },
    gauntlet: { icon: '◆', label: '重击手套', description: '普攻伤害 +30%\n攻速 −15%', bonus: 0.30, speedPenalty: 0.15 },
    cloak: { icon: '◌', label: '幻影披风', description: '闪避结束，在起点留下残影\n1 秒后爆炸造成 20 点伤害', delay: 1, damage: 20, range: 88 },
    pendant: { icon: '⟡', label: '轻盈吊坠', description: '移动速度 +15%\n闪避冷却 −15%', movementBonus: 0.15, cooldownReduction: 0.15 },
    horn: { icon: '➤', label: '冲锋号角', description: '闪避穿过敌人时造成 15 点伤害\n同一次闪避每个敌人只触发一次', damage: 15 },
    execution: { icon: '✧', label: '处刑徽章', description: '对处于破韧易伤的敌人\n普攻伤害额外 +20%', bonus: 0.20 },
    iron: { icon: '◎', label: '沉重铁环', description: '普攻韧性伤害 +25%\n普攻速度 −10%', bonus: 0.25, speedPenalty: 0.10 },
    crest: { icon: '✚', label: '不屈纹章', description: '每波首次跌破 30% 生命时\n恢复 20 点生命值', threshold: 0.30, heal: 20 },
    seed: { icon: '❧', label: '生命之种', description: '每波结束恢复\n最大生命值的 10%', healFraction: 0.10 },
    crown: { icon: '♛', label: '荆棘之冠', description: '受伤后的 3 秒内\n普攻伤害 +25%', bonus: 0.25, duration: 3 },
    crescent: { icon: '☾', label: '月牙剑刃', description: '每第 5 次普攻范围 +50%\n当次伤害 +30%', every: 5, rangeBonus: 0.50, bonus: 0.30 },
    resonance: { icon: '≋', label: '残响之刃', description: '普攻命中有 20% 概率\n0.2 秒后追加原伤害的 40%', chance: 0.20, delay: 0.2, damageScale: 0.40 },
    wolf: { icon: '◇', label: '孤狼之牙', description: '一次普攻只命中一个敌人时\n该次伤害 +35%', bonus: 0.35 },
    combo: { icon: '✦', label: '连击纹章', description: '对同一目标连续命中 3 次后\n第 4 次普攻伤害 +30%', every: 4, timeout: 3, bonus: 0.30 },
    ember: { icon: '♨', label: '余烬宝珠', description: '普攻命中有 20% 基础概率\n施加 1 层燃烧', chance: 0.20 },
    frostPendant: { icon: '❄', label: '寒霜吊坠', description: '每第 5 次普攻命中\n令目标减速 25%，持续 3 秒', every: 5 },
    needle: { icon: '✧', label: '淬毒短针', description: '普攻命中有 15% 基础概率\n施加 1 层中毒', chance: 0.15 },
    corrosion: { icon: '❖', label: '腐蚀药剂', description: '持续伤害 +30%', bonus: 0.30 },
    guardian: { icon: '⬡', label: '守护者徽章', description: '成功格挡后\n闪避剩余冷却减少 0.4 秒', reduction: 0.4 },
    amber: { icon: '◆', label: '琥珀护盾', description: '闪避结束后获得 15 点护盾\n持续 2 秒，不可叠加', amount: 15, duration: 2 },
    steadyBoots: { icon: '⟫', label: '沉稳战靴', description: '普攻期间的移动减速\n降低 50%', penaltyReduction: 0.50 },
    watch: { icon: '◷', label: '绝境怀表', description: '生命低于 35% 时\n闪避冷却缩短 30%', threshold: 0.35, reduction: 0.30 },
    prism: { icon: 'ϟ', label: '雷暴棱镜', description: '普攻暴击闪电弹向另一敌人\n8 点奥术伤害 · 0.3 秒冷却', damage: 8, range: 180, cooldown: 0.3 },
    starfire: { icon: '✷', label: '碎星火种', description: '破韧时令目标及其附近敌人\n获得 1 层燃烧 · 火焰', range: 120 },
    hunter: { icon: '⊙', label: '猎人印记', description: '对同一目标连续命中 4 次\n使其受到伤害 +12%，持续 4 秒', every: 4, timeout: 3, duration: 4, bonus: 0.12 },
    finale: { icon: '➤', label: '终焉号角', description: '击杀易伤或被印记的敌人\n普攻伤害 +20%，持续 4 秒', bonus: 0.20, duration: 4 },
    catalyst: { icon: '✦', label: '秘术催化剂', description: '异常命中加成 +30%（相对）\n持续伤害 +20%', statusHitBonus: 0.30, dotDamageBonus: 0.20 },
    decayBottle: { icon: '◈', label: '腐化之瓶', description: '持续伤害状态时长 +30%', dotDurationBonus: 0.30 },
    statusAmplifier: { icon: '⬡', label: '异常增幅器', description: '异常命中加成 +40%（相对）', statusHitBonus: 0.40 },
    serpentKiss: { icon: '♧', label: '翠蛇之吻', description: '每第 4 次普攻命中\n必定施加 1 层中毒', every: 4 },
    bloomCrown: { icon: '♛', label: '千蕊之冠', description: '中毒上限提高至 6 层\n每层中毒伤害 +15%', extraPoisonStacks: 3, poisonDamageBonus: 0.15 },
    witherSeed: { icon: '❧', label: '枯萎之种', description: '中毒敌人死亡时传播最多 2 层\n至附近最多 3 名敌人', layers: 2, targets: 3, range: 125 },
    mandrakeHeart: { icon: '❖', label: '曼陀罗之心', description: '普攻命中至少 3 层中毒的目标\n消耗 3 层并引爆其剩余毒伤', layers: 3 },
    eternalWick: { icon: '♨', label: '不熄的烛芯', description: '每第 4 次普攻命中\n额外施加 1 层燃烧', every: 4 },
    crimsonEmber: { icon: '✶', label: '绯红余烬', description: '燃烧伤害 +30%\n燃烧最大层数 +2', bonus: 0.30, extraStacks: 2 },
    ashButterfly: { icon: '✿', label: '灰烬蝴蝶', description: '燃烧敌人死亡时传播 1 层燃烧\n至 160px 内最多 3 名敌人', range: 160, targets: 3 },
    goldenLily: { icon: '✸', label: '赤金铃兰', description: '普攻消耗 3 层燃烧并爆炸\n100px 内造成 30 点火焰伤害\n每个目标冷却 2 秒', layers: 3, range: 100, damage: 30, cooldown: 2 },
    furnacePendant: { icon: '◆', label: '炉心吊坠', description: '每次成功施加燃烧时\n额外造成 5 点火焰伤害', damage: 5 },
    phoenixFeather: { icon: '✦', label: '凤凰尾羽', description: '每轮首杀燃烧敌人时恢复 10 HP\n下一次普攻附加 1 层燃烧', heal: 10 },
    winterBud: { icon: '❄', label: '冬眠花蕾', description: '普攻有 20% 基础概率\n施加 3 秒 25% 减速', chance: 0.20 },
    frostBell: { icon: '♫', label: '霜月银铃', description: '普攻命中减速或冻结目标\n追加 15% 基础普攻伤害 · 寒冰', damageScale: 0.15 },
    snowFox: { icon: '❧', label: '雪狐尾饰', description: '闪避后 4 秒内首击减速\n已减速则额外 +2 寒意', duration: 4, bonusChill: 2 },
    iceCrown: { icon: '♛', label: '冰晶王冠', description: '寒意达到 4 点时清空寒意\n冻结目标并中断攻击' },
    snowMirror: { icon: '◇', label: '碎雪之镜', description: '普攻命中冻结目标时碎冰\n40 点寒冰伤害 · 主目标\n20 点 · 100px 内其他敌人', damage: 40, splash: { damage: 20, range: 100 } },
    whiteGarland: { icon: '✿', label: '白夜花环', description: '击杀减速或冻结目标时\n减速 120px 内最多 3 名敌人', range: 120, targets: 3 },
    northStar: { icon: '✧', label: '极北之星', description: '对减速或冻结目标\n寒冰伤害 +30%\n冻结持续时间 +25%', damageBonus: 0.30, freezeBonus: 0.25 },
    starlightRing: { icon: '✧', label: '星辉指环', description: '每第 5 次普攻命中发射飞弹\n18 点奥术伤害 · 搜索 240px\n无其他目标时命中原目标', every: 5, damage: 18, range: 240 },
    glowPrism: { icon: '◇', label: '辉光棱镜', description: '所有奥术伤害 +30%', bonus: 0.30 },
    moonWatch: { icon: '◷', label: '月相怀表', description: '每 5 次原始奥术伤害\n释放 180px 奥术脉冲\n造成 20 点伤害', every: 5, range: 180, damage: 20 },
    meteorFragment: { icon: '✷', label: '流星碎片', description: '原始奥术伤害弹射一次\n140px 内另一敌人\n40% 原伤害 · 奥术', range: 140, damageScale: 0.40 },
    starBottle: { icon: '✦', label: '群星之瓶', description: '普攻暴击 3 次后\n下一次普攻命中\n追加 30 点奥术伤害', every: 3, damage: 30 },
    dawnAstrolabe: { icon: '⊙', label: '破晓星盘', description: '每第 3 次原始奥术伤害 +50%\n100px 内其他敌人\n受到强化伤害的 30%', every: 3, bonus: 0.50, range: 100, splashScale: 0.30, flash: 0.35 },
};

export type RelicId = keyof typeof RELICS;

export const RELIC_FACTION_NAMES = {
    martial: '武技',
    fire: '火焰',
    nature: '自然',
    frost: '寒冰',
    arcane: '奥术',
    break: '击破',
    technique: '技巧',
    survival: '生存',
} as const;

export type RelicFaction = keyof typeof RELIC_FACTION_NAMES;

export const RELIC_FACTIONS: Record<RelicId, RelicFaction> = {
    whetstone: 'martial', feather: 'martial', blade: 'martial', aftershock: 'martial',
    berserk: 'martial', twin: 'martial', falcon: 'martial', bracer: 'martial', gauntlet: 'martial',
    crescent: 'martial', resonance: 'martial', wolf: 'martial', combo: 'martial',
    ember: 'fire', starfire: 'fire', eternalWick: 'fire', crimsonEmber: 'fire', ashButterfly: 'fire',
    goldenLily: 'fire', furnacePendant: 'fire', phoenixFeather: 'fire',
    needle: 'nature', corrosion: 'nature', catalyst: 'nature', decayBottle: 'nature', statusAmplifier: 'nature',
    serpentKiss: 'nature', bloomCrown: 'nature', witherSeed: 'nature', mandrakeHeart: 'nature',
    frostPendant: 'frost', winterBud: 'frost', frostBell: 'frost', snowFox: 'frost', iceCrown: 'frost',
    snowMirror: 'frost', whiteGarland: 'frost', northStar: 'frost',
    ring: 'arcane', prism: 'arcane', starlightRing: 'arcane', glowPrism: 'arcane', moonWatch: 'arcane',
    meteorFragment: 'arcane', starBottle: 'arcane', dawnAstrolabe: 'arcane',
    badge: 'break', collapse: 'break', execution: 'break', iron: 'break', hunter: 'break', finale: 'break',
    boots: 'technique', cloak: 'technique', pendant: 'technique', horn: 'technique',
    guardian: 'technique', steadyBoots: 'technique', watch: 'technique',
    charm: 'survival', thorn: 'survival', fang: 'survival', crest: 'survival',
    seed: 'survival', crown: 'survival', amber: 'survival',
};
