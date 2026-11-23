import { RELICS, RELIC_FACTIONS, WAVES, type EnemyKind, type RelicFaction, type RelicId } from './config.ts';
import { heal, type Vital } from './combat.ts';

export type EventCard = 'battle' | 'reward' | 'encounter';
export type EventReward = { kind: 'gold'; amount: number } | { kind: 'relic'; id: RelicId; gold?: number };
export interface ShopOffer { id: RelicId; price: number; sold: boolean }
export type ShopSupply = { kind: 'heal'; amount: number } | { kind: 'relic'; id: RelicId };

const SUPPLY_WAVES = [5, 8, 10, 14, 17];
const SHOP_SIZE = 5;
export const OPENING_GOLD = 150;
export const REFRESH_COST = 50;
export const REST_FRACTION = 0.35;
export const CHALLENGE_HP_BONUS = 0.25;
export const CHALLENGE_EXTRA_SLIMES = 1;
export const REWARD_BASE_GOLD = 50;
export const LATE_REWARD_HEAL = 0.25;
export const LATE_REWARD_CHOICES = 2;
export const BLESSING_WAVE = 5;
export const BLESSING_WEIGHT = 2;
const GOLD_BANDS = [
    { through: 2, slime: 3, skeleton: 8 },
    { through: 4, slime: 4, skeleton: 10 },
    { through: 5, slime: 5, skeleton: 12 },
    { through: 7, slime: 7, skeleton: 15 },
    { through: 9, slime: 9, skeleton: 20 },
    { through: 11, slime: 11, skeleton: 25 },
    { through: 13, slime: 13, skeleton: 30 },
    { through: 15, slime: 15, skeleton: 35 },
    { through: 17, slime: 17, skeleton: 40 },
    { through: 19, slime: 19, skeleton: 45 },
    { through: 20, slime: 20, skeleton: 50 },
];

const PRICES: Record<RelicId, number> = {
    whetstone: 100, feather: 125, charm: 125, badge: 75, thorn: 75, ring: 175,
    blade: 200, boots: 150, aftershock: 150, fang: 225, berserk: 125, collapse: 200,
    twin: 200, falcon: 200, bracer: 125, gauntlet: 125, cloak: 150, pendant: 175,
    horn: 100, execution: 125, iron: 50, crest: 175, seed: 300, crown: 125,
    crescent: 200, resonance: 250, wolf: 150, combo: 150, ember: 150, frostPendant: 75,
    needle: 125, corrosion: 150, guardian: 75, amber: 175, steadyBoots: 50, watch: 50,
    prism: 225, starfire: 200, hunter: 175, finale: 150,
    catalyst: 175, decayBottle: 125, statusAmplifier: 125,
    serpentKiss: 150, bloomCrown: 200, witherSeed: 175, mandrakeHeart: 225,
    eternalWick: 150, crimsonEmber: 200, ashButterfly: 175, goldenLily: 250, furnacePendant: 175, phoenixFeather: 225,
    winterBud: 150, frostBell: 175, snowFox: 150, iceCrown: 225, snowMirror: 250, whiteGarland: 175, northStar: 225,
    starlightRing: 150, glowPrism: 175, moonWatch: 200, meteorFragment: 200, starBottle: 225, dawnAstrolabe: 275,
};

const RELIC_IDS = Object.keys(RELICS) as RelicId[];

export function eventCardsAfter(clearedWave: number): readonly EventCard[] {
    if (clearedWave >= WAVES.length || isSupplyStop(clearedWave)) return [];
    return ['battle', 'reward', 'encounter'];
}

export function isSupplyStop(clearedWave: number) {
    return SUPPLY_WAVES.includes(clearedWave);
}

export function hasFutureShop(clearedWave: number) {
    return SUPPLY_WAVES.some(wave => wave > clearedWave);
}

export function waveSpec(wave: number, challenge: boolean) {
    const base = WAVES[wave - 1];
    if (!challenge) return base;
    return { ...base, slime: base.slime + (base.guardian || base.crownlessBody ? 0 : CHALLENGE_EXTRA_SLIMES),
        hpScale: base.hpScale * (1 + CHALLENGE_HP_BONUS) };
}

export function killGold(kind: EnemyKind, wave: number) {
    const band = GOLD_BANDS.find(band => wave <= band.through) ?? GOLD_BANDS[GOLD_BANDS.length - 1];
    return kind === 'skeleton' || kind === 'caster' || kind === 'boar' || kind === 'guardian'
        || kind === 'crownlessBody' || kind === 'crownlessHead' ? band.skeleton : band.slime;
}

export function cashCardPayout(wave: number) {
    return REWARD_BASE_GOLD + Math.max(60, 10 * killGold('slime', wave));
}

export function unownedRelics(held: ReadonlySet<RelicId>) {
    return RELIC_IDS.filter(id => !held.has(id));
}

export function blessingChoices(held: ReadonlySet<RelicId>, random = Math.random) {
    const pool = [...new Set(unownedRelics(held).map(id => RELIC_FACTIONS[id]))];
    const choices: RelicFaction[] = [];
    while (choices.length < 3 && pool.length) {
        choices.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return choices;
}

const DOT_SYNERGY_WEIGHT = 3;

function relicWeight(id: RelicId, held: ReadonlySet<RelicId>) {
    const burn = held.has('ember') || held.has('starfire');
    const dot = burn || held.has('needle');
    return (id === 'corrosion' && dot) || (id === 'starfire' && held.has('ember'))
        || (id === 'ember' && held.has('starfire')) ? DOT_SYNERGY_WEIGHT : 1;
}

export function takeRelic(pool: RelicId[], random: () => number, held?: ReadonlySet<RelicId>, blessing?: RelicFaction) {
    if (!held && !blessing) return pool.splice(Math.floor(random() * pool.length), 1)[0];
    const weights = pool.map(id => (held ? relicWeight(id, held) : 1) * (RELIC_FACTIONS[id] === blessing ? BLESSING_WEIGHT : 1));
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    const index = weights.findIndex(weight => (roll -= weight) < 0);
    return pool.splice(index, 1)[0];
}

export type GoldChange = { kind: 'earn' | 'spend'; amount: number };

export class RunEconomy {
    private balance = 0;
    private slots: (ShopOffer | null)[] = [];
    private supply?: ShopSupply;
    /** Fires for event income and spending. Kill loot stays silent on purpose; it is far too frequent to chime. */
    onGold?: (change: GoldChange) => void;

    get gold() { return this.balance; }
    get offers(): readonly (Readonly<ShopOffer> | null)[] { return this.slots; }
    get claimedSupply() { return this.supply; }

    collectKill(kind: EnemyKind, wave: number) {
        const amount = killGold(kind, wave);
        this.addGold(amount, 'kill');
        return amount;
    }

    addGold(amount: number, reason: 'event' | 'kill' = 'event') {
        if (!Number.isSafeInteger(amount) || amount < 0) return;
        this.balance += amount;
        if (reason === 'event' && amount > 0) this.onGold?.({ kind: 'earn', amount });
    }

    spendGold(amount: number) {
        if (!Number.isSafeInteger(amount) || amount < 0 || this.balance < amount) return false;
        this.balance -= amount;
        if (amount > 0) this.onGold?.({ kind: 'spend', amount });
        return true;
    }

    clear() {
        this.balance = 0;
        this.slots = [];
        this.supply = undefined;
    }

    claimReward(wave: number, held: ReadonlySet<RelicId>, random = Math.random, blessing?: RelicFaction): EventReward {
        const pool = unownedRelics(held);
        if (pool.length && random() < 0.5) {
            this.addGold(REWARD_BASE_GOLD);
            return { kind: 'relic', id: takeRelic(pool, random, undefined, blessing), gold: REWARD_BASE_GOLD };
        }
        const amount = cashCardPayout(wave);
        this.addGold(amount);
        return { kind: 'gold', amount };
    }

    goldReward(wave: number): EventReward {
        const amount = 10 * killGold('slime', wave);
        this.addGold(amount);
        return { kind: 'gold', amount };
    }

    openShop(held: ReadonlySet<RelicId>, random = Math.random, blessing?: RelicFaction) {
        this.supply = undefined;
        this.slots = Array<ShopOffer | null>(SHOP_SIZE).fill(null);
        const pool = unownedRelics(held);
        const budgetPool = pool.filter(id => PRICES[id] <= 100);
        if (budgetPool.length) {
            const id = takeRelic(budgetPool, random, undefined, blessing);
            this.slots[0] = { id, price: PRICES[id], sold: false };
            pool.splice(pool.indexOf(id), 1);
            this.stock(pool, random, held, blessing, 1);
        } else {
            this.stock(pool, random, held, blessing);
        }
    }

    claimShopSupply(kind: ShopSupply['kind'], player: Vital, held: ReadonlySet<RelicId>, random = Math.random, blessing?: RelicFaction) {
        if (!this.slots.length || this.supply) return undefined;
        if (kind === 'heal') {
            const amount = heal(player, player.maxHp * REST_FRACTION);
            if (amount <= 0) return undefined;
            this.supply = { kind, amount };
        } else {
            const pool = unownedRelics(held);
            if (!pool.length) return undefined;
            const id = takeRelic(pool, random, undefined, blessing);
            const slot = this.slots.findIndex(offer => offer?.id === id && !offer.sold);
            if (slot >= 0) {
                const replacements = this.newStock(held);
                const replacement = replacements.length ? takeRelic(replacements, random, held, blessing) : undefined;
                this.slots[slot] = replacement ? { id: replacement, price: PRICES[replacement], sold: false } : null;
            }
            this.supply = { kind, id };
        }
        return this.supply;
    }

    buy(index: number, held: ReadonlySet<RelicId>) {
        const offer = this.slots[index];
        if (!offer || offer.sold || held.has(offer.id) || !this.spendGold(offer.price)) return undefined;
        offer.sold = true;
        return offer.id;
    }

    canRefresh(held: ReadonlySet<RelicId>) {
        if (this.gold < REFRESH_COST || this.slots.every(offer => offer?.sold)) return false;
        return this.newStock(held).length > 0;
    }

    refresh(held: ReadonlySet<RelicId>, random = Math.random, blessing?: RelicFaction) {
        if (!this.canRefresh(held)) return false;
        const pool = this.newStock(held);
        const fallback = this.slots.flatMap(offer => offer && !offer.sold && !held.has(offer.id) ? [offer.id] : []);
        this.spendGold(REFRESH_COST);
        this.stock(pool, random, held, blessing, 0, fallback);
        return true;
    }

    private newStock(held: ReadonlySet<RelicId>) {
        const stocked = new Set(this.slots.map(offer => offer?.id));
        return RELIC_IDS.filter(id => !held.has(id) && !stocked.has(id));
    }

    private stock(pool: RelicId[], random: () => number, held: ReadonlySet<RelicId>, blessing: RelicFaction | undefined,
        start = 0, fallback: RelicId[] = []) {
        for (let index = start; index < this.slots.length; index += 1) {
            if (this.slots[index]?.sold) continue;
            const available = pool.length ? pool : fallback;
            const id = available.length ? takeRelic(available, random, held, blessing) : undefined;
            this.slots[index] = id ? { id, price: PRICES[id], sold: false } : null;
        }
    }
}
