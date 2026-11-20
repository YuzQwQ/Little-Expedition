import { RELICS, WARRIOR, type RelicFaction, type RelicId } from './config.ts';
import { heal, type ArcaneDamageEvent, type HitSource, type Vital } from './combat.ts';
import { takeRelic, unownedRelics } from './expedition.ts';
import { calculateStatusChance, type DotModifiers, type StatusKind, type StatusResistances } from './statuses.ts';

interface TimedHits { count: number; last: number }

interface StatusHitOptions {
    resistances?: StatusResistances;
    statusApplicationMultiplier?: number;
    random?: () => number;
}

function countTargetHit(counts: Map<Vital, TimedHits>, target: Vital, time: number, every: number, timeout: number) {
    const previous = counts.get(target);
    const next = previous && time - previous.last <= timeout ? previous.count + 1 : 1;
    if (next >= every) {
        counts.delete(target);
        return true;
    }
    counts.set(target, { count: next, last: time });
    return false;
}

export class RunRelics {
    readonly held = new Set<RelicId>();
    private blessingFaction?: RelicFaction;
    private normalHits = 0;
    private starlightHits = 0;
    private moonCharges = 0;
    private starBottleCrits = 0;
    private astrolabeHits = 0;
    private astrolabeFlashUntil = 0;
    private normalAttacks = 0;
    private fangKills = 0;
    private bootsUntil = 0;
    private snowFoxUntil = 0;
    private crownUntil = 0;
    private skipWindup = false;
    private crestUsed = false;
    private crescentAttacks = 0;
    private frostHits = 0;
    private serpentHits = 0;
    private wickHits = 0;
    private phoenixUsed = false;
    private phoenixBurnReady = false;
    private readonly comboHits = new Map<Vital, TimedHits>();
    private readonly hunterHits = new Map<Vital, TimedHits>();
    private readonly lilyReadyAt = new Map<Vital, number>();
    private prismReadyAt = 0;
    private finaleUntil = 0;

    get attackDamage() {
        return 1 + (this.held.has('whetstone') ? RELICS.whetstone.bonus : 0)
            + (this.held.has('gauntlet') ? RELICS.gauntlet.bonus : 0);
    }
    get poiseDamage() {
        return 1 + (this.held.has('badge') ? RELICS.badge.bonus : 0)
            + (this.held.has('iron') ? RELICS.iron.bonus : 0);
    }
    get statusHitBonus() {
        return (this.held.has('catalyst') ? RELICS.catalyst.statusHitBonus : 0)
            + (this.held.has('statusAmplifier') ? RELICS.statusAmplifier.statusHitBonus : 0);
    }
    get dotDamageBonus() {
        return (this.held.has('corrosion') ? RELICS.corrosion.bonus : 0)
            + (this.held.has('catalyst') ? RELICS.catalyst.dotDamageBonus : 0);
    }
    get poisonDamageBonus() { return this.held.has('bloomCrown') ? RELICS.bloomCrown.poisonDamageBonus : 0; }
    get burnDamageBonus() { return this.held.has('crimsonEmber') ? RELICS.crimsonEmber.bonus : 0; }
    get arcaneDamageBonus() { return this.held.has('glowPrism') ? RELICS.glowPrism.bonus : 0; }
    get freezeDurationBonus() { return this.held.has('northStar') ? RELICS.northStar.freezeBonus : 0; }

    frostDamageBonus(cold: boolean) {
        return cold && this.held.has('northStar') ? RELICS.northStar.damageBonus : 0;
    }
    get dotModifiers(): DotModifiers {
        return {
            dotDamageBonus: this.dotDamageBonus,
            dotDurationBonus: this.held.has('decayBottle') ? RELICS.decayBottle.dotDurationBonus : 0,
            dotMaxStacksBonus: 0,
            dotMaxStacksByStatus: {
                poison: this.held.has('bloomCrown') ? RELICS.bloomCrown.extraPoisonStacks : 0,
                burning: this.held.has('crimsonEmber') ? RELICS.crimsonEmber.extraStacks : 0,
            },
        };
    }
    get poiseBurst() { return this.held.has('collapse') ? RELICS.collapse : null; }
    get movementSpeed() { return this.held.has('pendant') ? 1 + RELICS.pendant.movementBonus : 1; }
    get dodgeCooldown() {
        return WARRIOR.dodge.cooldown * (this.held.has('pendant') ? 1 - RELICS.pendant.cooldownReduction : 1);
    }

    dodgeRecoveryRate(player: Vital) {
        return this.held.has('watch') && player.hp < player.maxHp * RELICS.watch.threshold
            ? 1 / (1 - RELICS.watch.reduction) : 1;
    }

    onSuccessfulBlock(remaining: number, rate: number) {
        return this.held.has('guardian') ? Math.max(0, remaining - RELICS.guardian.reduction * rate) : remaining;
    }

    attackMovementMultiplier(original: number) {
        return this.held.has('steadyBoots') ? 1 - (1 - original) * (1 - RELICS.steadyBoots.penaltyReduction) : original;
    }

    berserkActive(player: Vital) {
        return this.held.has('berserk') && player.hp > 0 && player.hp < player.maxHp * RELICS.berserk.threshold;
    }

    attackSpeed(player: Vital) {
        return 1 + (this.held.has('feather') ? RELICS.feather.bonus : 0)
            + (this.berserkActive(player) ? RELICS.berserk.bonus : 0)
            - (this.held.has('gauntlet') ? RELICS.gauntlet.speedPenalty : 0)
            - (this.held.has('iron') ? RELICS.iron.speedPenalty : 0);
    }

    attackDamageAt(time: number) {
        return this.attackDamage * (this.crownRemaining(time) ? 1 + RELICS.crown.bonus : 1);
    }

    executionMultiplier(target: Vital, time: number) {
        return this.held.has('execution') && time < target.vulnerableUntil ? 1 + RELICS.execution.bonus : 1;
    }

    criticalMultiplier(random = Math.random) {
        return this.held.has('falcon') && random() < RELICS.falcon.chance ? RELICS.falcon.damageScale : 1;
    }

    rollExtraSlash(random = Math.random) {
        return this.held.has('twin') && random() < RELICS.twin.chance;
    }

    get windupReady() { return this.skipWindup; }

    takeWindupSkip() {
        const ready = this.skipWindup;
        this.skipWindup = false;
        return ready;
    }

    crownRemaining(time: number) {
        return Math.max(0, this.crownUntil - time);
    }

    onDodgeFinished(time: number, player: Vital) {
        if (this.held.has('boots')) this.bootsUntil = time + RELICS.boots.duration;
        if (this.held.has('snowFox')) this.snowFoxUntil = time + RELICS.snowFox.duration;
        if (this.held.has('amber')) {
            player.shield = RELICS.amber.amount;
            player.shieldUntil = time + RELICS.amber.duration;
        }
    }

    snowFoxRemaining(time: number) { return Math.max(0, this.snowFoxUntil - time); }

    takeSnowFoxHit(time: number) {
        if (!this.snowFoxRemaining(time)) return false;
        this.snowFoxUntil = 0;
        return true;
    }

    bootsRemaining(time: number) {
        return Math.max(0, this.bootsUntil - time);
    }

    takeDodgeBonus(time: number) {
        if (!this.bootsRemaining(time)) return 1;
        this.bootsUntil = 0;
        return 1 + RELICS.boots.bonus;
    }

    get blessing() { return this.blessingFaction; }

    chooseBlessing(faction: RelicFaction) {
        if (this.blessingFaction) return false;
        this.blessingFaction = faction;
        return true;
    }

    choices(random = Math.random, limit = 3) {
        const pool = unownedRelics(this.held);
        const choices: RelicId[] = [];
        while (choices.length < limit && pool.length) {
            choices.push(takeRelic(pool, random, this.held, this.blessing));
        }
        return choices;
    }

    acquire(id: RelicId, player: Vital) {
        if (this.held.has(id)) return;
        this.held.add(id);
        if (id === 'charm') {
            player.maxHp += RELICS.charm.amount;
            player.hp += RELICS.charm.amount;
        }
    }

    onAttackHit(source: HitSource, random = Math.random) {
        if (source !== 'normal') return 0;
        if (!this.skipWindup && this.held.has('bracer') && random() < RELICS.bracer.chance) this.skipWindup = true;
        if (!this.held.has('ring')) return 0;
        this.normalHits += 1;
        return this.normalHits % RELICS.ring.every === 0 ? RELICS.ring.damage : 0;
    }

    onStarlightHit() {
        if (!this.held.has('starlightRing')) return false;
        this.starlightHits = (this.starlightHits + 1) % RELICS.starlightRing.every;
        return this.starlightHits === 0;
    }

    onStarBottleHit(critical: boolean, firstSwingHit: boolean) {
        if (!this.held.has('starBottle')) return false;
        if (this.starBottleReady) {
            if (!firstSwingHit) return false;
            this.starBottleCrits = 0;
            return true;
        }
        if (critical) this.starBottleCrits += 1;
        return false;
    }

    get starBottleReady() { return this.starBottleCrits === RELICS.starBottle.every; }
    get starBottleCharge() { return this.starBottleCrits; }
    get moonWatchCharge() { return this.moonCharges; }
    get astrolabeCharge() { return this.astrolabeHits; }
    get astrolabeReady() { return this.held.has('dawnAstrolabe') && this.astrolabeHits === RELICS.dawnAstrolabe.every - 1; }

    astrolabeFlashing(time: number) { return time < this.astrolabeFlashUntil; }

    onArcaneDamage(event: ArcaneDamageEvent, damage: number, time: number) {
        if (!event.canTriggerEffects || event.handled || damage <= 0) return;
        event.handled = true;
        const splash = this.astrolabeReady;
        if (this.held.has('dawnAstrolabe')) {
            this.astrolabeHits = (this.astrolabeHits + 1) % RELICS.dawnAstrolabe.every;
            if (splash) this.astrolabeFlashUntil = time + RELICS.dawnAstrolabe.flash;
        }
        let pulse = false;
        if (this.held.has('moonWatch')) {
            this.moonCharges = (this.moonCharges + 1) % RELICS.moonWatch.every;
            pulse = this.moonCharges === 0;
        }
        return { pulse, splash };
    }

    onAttackReleased() {
        if (!this.held.has('blade')) return false;
        this.normalAttacks += 1;
        return this.normalAttacks % RELICS.blade.every === 0;
    }

    onAttackStarted() {
        if (!this.held.has('crescent')) return null;
        this.crescentAttacks += 1;
        if (this.crescentAttacks < RELICS.crescent.every) return null;
        this.crescentAttacks = 0;
        return RELICS.crescent;
    }

    hitDamageBonus(target: Vital, time: number) {
        const combo = this.held.has('combo')
            && countTargetHit(this.comboHits, target, time, RELICS.combo.every, RELICS.combo.timeout);
        return (combo ? RELICS.combo.bonus : 0) + (time < this.finaleUntil ? RELICS.finale.bonus : 0);
    }

    statusChance(kind: StatusKind, baseChance: number, options: StatusHitOptions = {}) {
        return calculateStatusChance(baseChance, this.statusHitBonus,
            options.statusApplicationMultiplier ?? WARRIOR.attack.statusApplicationMultiplier, options.resistances?.[kind] ?? 0);
    }

    onDirectHit(target: Vital, time: number, options: StatusHitOptions = {}) {
        if (this.held.has('hunter') && countTargetHit(this.hunterHits, target, time, RELICS.hunter.every, RELICS.hunter.timeout)
            && target.hp > 0) target.markedUntil = time + RELICS.hunter.duration;
        let slow = false;
        if (this.held.has('frostPendant') && ++this.frostHits === RELICS.frostPendant.every) {
            this.frostHits = 0;
            slow = true;
        }
        const random = options.random ?? Math.random;
        return {
            slow,
            burning: this.held.has('ember') && random() < this.statusChance('burning', RELICS.ember.chance, options),
            poison: this.held.has('needle') && random() < this.statusChance('poison', RELICS.needle.chance, options),
            echo: this.held.has('resonance') && random() < RELICS.resonance.chance,
            winterBud: this.held.has('winterBud') && random() < this.statusChance('slow', RELICS.winterBud.chance, options),
        };
    }

    onSerpentHit() {
        if (!this.held.has('serpentKiss')) return false;
        this.serpentHits = (this.serpentHits + 1) % RELICS.serpentKiss.every;
        return this.serpentHits === 0;
    }

    onWickHit() {
        if (!this.held.has('eternalWick')) return false;
        this.wickHits = (this.wickHits + 1) % RELICS.eternalWick.every;
        return this.wickHits === 0;
    }

    tryLilyBurst(target: Vital, burnStacks: number, time: number) {
        const { layers, cooldown } = RELICS.goldenLily;
        if (!this.held.has('goldenLily') || burnStacks < layers || time < (this.lilyReadyAt.get(target) ?? 0)) return false;
        this.lilyReadyAt.set(target, time + cooldown);
        return true;
    }

    onBurningKill(player: Vital) {
        if (!this.held.has('phoenixFeather') || this.phoenixUsed || player.hp <= 0) return;
        this.phoenixUsed = true;
        this.phoenixBurnReady = true;
        heal(player, RELICS.phoenixFeather.heal);
    }

    takePhoenixBurn() {
        const ready = this.phoenixBurnReady;
        this.phoenixBurnReady = false;
        return ready;
    }

    forgetTarget(target: Vital) {
        this.comboHits.delete(target);
        this.hunterHits.delete(target);
        this.lilyReadyAt.delete(target);
    }

    prismReady(time: number) { return this.held.has('prism') && time >= this.prismReadyAt; }
    spendPrism(time: number) { this.prismReadyAt = time + RELICS.prism.cooldown; }

    onVulnerableKill(time: number) {
        if (this.held.has('finale')) this.finaleUntil = time + RELICS.finale.duration;
    }

    finaleRemaining(time: number) { return Math.max(0, this.finaleUntil - time); }

    onEnemyKilled(player: Vital, random = Math.random) {
        if (this.held.has('fang')) {
            this.fangKills += 1;
            if (this.fangKills % RELICS.fang.every === 0) heal(player, RELICS.fang.heal);
        }
        return this.held.has('aftershock') && random() < RELICS.aftershock.chance ? RELICS.aftershock : null;
    }

    onPlayerDamaged(source: HitSource) {
        return source === 'enemy' && this.held.has('thorn') ? RELICS.thorn : null;
    }

    onDamageTaken(player: Vital, previousHp: number, time: number) {
        if (player.hp <= 0 || player.hp >= previousHp) return;
        if (this.held.has('crown')) this.crownUntil = time + RELICS.crown.duration;
        const threshold = player.maxHp * RELICS.crest.threshold;
        if (this.held.has('crest') && !this.crestUsed && previousHp >= threshold && player.hp < threshold) {
            this.crestUsed = true;
            heal(player, RELICS.crest.heal);
        }
    }

    onWaveStarted() {
        this.crestUsed = false;
        this.phoenixUsed = false;
    }

    onWaveCleared(player: Vital) {
        if (this.held.has('seed')) heal(player, player.maxHp * RELICS.seed.healFraction);
    }
}
