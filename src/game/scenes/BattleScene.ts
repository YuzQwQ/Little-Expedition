import Phaser from 'phaser';
import { playCue } from '../audio';
import { loadWarriorTextures } from '../../character/warriorVisual';
import { loadCoinTexture, loadRelicTextures } from '../ui';
import { ARCHER, CROWNLESS, ENEMIES, FIELD, OBSTACLES, RELICS, VIEW, WAVES, WARRIOR, type EnemyKind, type RelicId } from '../config';
import {
    activeShield, createVital, direction, distance, heal, hitProfile, inSector, recoverPoise, resolveHit, segmentHits,
    swingContactEnd, swingHasContact, swingPhase, swingRange, vulnerabilityBonus,
    type ArcaneDamageEvent, type DamageType, type Hit, type HitSource, type Point, type Swing, type Vital,
} from '../combat';
import { chargeReach, createEnemy, freezeEnemy, spawnPoint, updateArcherEnemy, updateEnemy, updateSpecialEnemy, type Enemy } from '../entities';
import { advanceEnemyProjectile, launchEnemyProjectile, movingCircleContact, type EnemyProjectile } from '../enemyProjectiles';
import { isBossKind, isSpecialEnemy, type SpecialAttack, type SpecialEnemyKind } from '../enemyPatterns';
import { DIFFICULTIES, isTrialUnlocked, unlockTrial, type Difficulty } from '../difficulty';
import { cancelSpecialAttack, changeBossPhase } from '../specialEnemy';
import { drawEncounter, type EncounterSession, type WaveModifiers } from '../encounters';
import {
    BLESSING_WAVE, LATE_REWARD_CHOICES, LATE_REWARD_HEAL, OPENING_GOLD, RunEconomy, blessingChoices, eventCardsAfter,
    hasFutureShop, isSupplyStop, unownedRelics, waveSpec,
    type EventCard, type EventReward,
} from '../expedition';
import { MobileControls } from '../mobileControls';
import { RunRelics } from '../relics';
import { overlayRoot } from '../rotation';
import { createSettingsPanel, getSettings, usesMobileControls, type SettingsPanel } from '../settings';
import { markTipSeen, pendingTips, type TipId } from '../tips';
import { closestStatusTargets, spreadPoison, type StatusKind } from '../statuses';
import { BattleView, sector } from '../view';
import { WarriorBlock, WarriorResolve } from '../warrior';
import type { RunResult } from './Screens';

type Mode = 'opening' | 'fighting' | 'paused' | 'settling' | 'blessing' | 'events' | 'relic' | 'reward' | 'shop' | 'rest'
    | 'encounter' | 'encounter-result' | 'victory' | 'defeat';
type KeyName = 'up' | 'left' | 'down' | 'right';
type Keys = Record<KeyName, Phaser.Input.Keyboard.Key>;

interface Dodge {
    started: number;
    heading: number;
    nextTrail: number;
    origin: Point;
    hit: Set<Enemy>;
}

interface Ultimate {
    started: number;
    heading: number;
    released: boolean;
}

interface IncomingAttack {
    kind: 'melee' | 'projectile' | 'area';
    attacker?: Enemy;
    damageType?: DamageType;
}

interface FlyingBlade extends Point {
    heading: number;
    remaining: number;
    hit: Set<Enemy>;
}

interface ExtraSlash {
    origin: Point;
    heading: number;
    amount: number;
    due: number;
}

interface Echo {
    origin: Point;
    ghost: Phaser.GameObjects.Container | Phaser.GameObjects.Image;
    due: number;
}

interface Resonance {
    enemy: Enemy;
    amount: number;
    type: DamageType;
    due: number;
}

interface Defeat {
    enemy: Enemy;
    vulnerable: boolean;
    chainDepth: number;
    poisonLayers: number;
    burning: boolean;
    cold: boolean;
}

const DAMAGE_COLORS: Record<DamageType, number> = {
    physical: 0xf6ddb0, fire: 0xff9a70, nature: 0xa5df89, frost: 0xa4e7fa, arcane: 0xd6b0fc,
};
const MAX_KILL_CHAIN_DEPTH = 16;

export class BattleScene extends Phaser.Scene {
    private view: BattleView;
    private player: Phaser.Physics.Arcade.Sprite;
    private enemies: Enemy[];
    private defeated: Defeat[];
    private enemyProjectiles: EnemyProjectile<Enemy>[];
    private blades: FlyingBlade[];
    private extraSlashes: ExtraSlash[];
    private echoes: Echo[];
    private resonances: Resonance[];
    private enemyGroup: Phaser.Physics.Arcade.Group;
    private vital: Vital;
    private block: WarriorBlock;
    private resolve: WarriorResolve;
    private relics: RunRelics;
    private economy: RunEconomy;
    private keys: Keys;
    private mobile?: MobileControls;
    private settings?: SettingsPanel;
    private pauseStage?: 'menu' | 'quit';
    private tips: Set<TipId>;
    private supplyTip: boolean;
    private crownless?: { body: Enemy; head: Enemy; lit: boolean; reviveAt: number };
    private touchUltimateAiming: boolean;
    private mode: Mode;
    private clock: number;
    private wave: number;
    private challenge: boolean;
    private testEnemy?: SpecialEnemyKind;
    private difficulty: Difficulty;
    private waveModifiers: WaveModifiers;
    private encounter?: EncounterSession;
    private kills: number;
    private facing: 1 | -1;
    private walking: boolean;
    private aim: number;
    private nextAttack: number;
    private dodgeWork: number;
    private swing?: Swing<Enemy>;
    private dodge?: Dodge;
    private ultimate?: Ultimate;
    private attackPressed: boolean;
    private dodgePressed: boolean;
    private ultimatePressed: boolean;
    private pausePressed: boolean;
    private ignorePointerUntilUp: boolean;
    private debug: boolean;

    constructor() { super('battle'); }

    preload() {
        loadWarriorTextures(this);
        loadCoinTexture(this);
        loadRelicTextures(this);
    }

    create(data?: Partial<Pick<RunResult, 'testEnemy' | 'difficulty'>>) {
        this.mode = 'fighting';
        this.clock = 0;
        this.wave = -1;
        this.challenge = false;
        this.testEnemy = data?.testEnemy;
        this.difficulty = !this.testEnemy && data?.difficulty === 'trial' && isTrialUnlocked() ? 'trial' : 'normal';
        this.waveModifiers = {};
        this.encounter = undefined;
        this.kills = 0;
        // 只看过一次的引导，跨局记住；本局内用 Set 消耗，避免每次读 storage。
        this.tips = new Set(pendingTips());
        this.supplyTip = false;
        this.crownless = undefined;
        this.facing = 1;
        this.walking = false;
        this.aim = 0;
        this.nextAttack = 0;
        this.dodgeWork = 0;
        this.swing = undefined;
        this.dodge = undefined;
        this.ultimate = undefined;
        this.touchUltimateAiming = false;
        this.attackPressed = false;
        this.dodgePressed = false;
        this.ultimatePressed = false;
        this.pausePressed = false;
        this.ignorePointerUntilUp = true;
        this.debug = false;
        this.enemies = [];
        this.defeated = [];
        this.enemyProjectiles = [];
        this.blades = [];
        this.extraSlashes = [];
        this.echoes = [];
        this.resonances = [];
        this.vital = createVital(WARRIOR.maxHp);
        this.block = new WarriorBlock();
        this.resolve = new WarriorResolve();
        this.relics = new RunRelics();
        this.economy = new RunEconomy();

        const settings = getSettings();
        // 只有事件收入和花费会响；击杀掉落的金币太频繁，只留飘字。
        this.economy.onGold = change => playCue(change.kind === 'spend' ? 'spend' : 'coin');
        this.mobile = usesMobileControls(settings.controls)
            ? new MobileControls(overlayRoot(this.game.canvas.parentElement!), () => { this.dodgePressed = true; }, () => { this.pausePressed = true; })
            : undefined;
        // 操作端在开局时已经决定了 HUD 和输入，战斗里只开放能即时生效的项。
        this.settings = createSettingsPanel(overlayRoot(this.game.canvas.parentElement!), () => this.applySettings(), { controls: false });
        this.view = new BattleView(this, !!this.mobile);
        this.physics.world.setBounds(0, 0, FIELD.width, FIELD.height);
        this.player = this.view.createWarrior({ x: FIELD.width / 2, y: FIELD.height / 2 });
        this.enemyGroup = this.physics.add.group();
        this.physics.add.collider(this.player, this.view.obstacles);
        this.physics.add.collider(this.enemyGroup, this.view.obstacles);
        this.physics.add.collider(this.enemyGroup, this.enemyGroup);
        this.physics.add.collider(this.player, this.enemyGroup, undefined,
            (_, sprite) => (!this.dodge || !this.relics.held.has('horn'))
                && !this.enemies.some(enemy => enemy.sprite === sprite && enemy.special?.active?.stage === 'charge'));
        this.cameras.main.setBounds(0, 0, FIELD.width, FIELD.height).setZoom(settings.zoom)
            .startFollow(this.player, true, 0.16, 0.16);

        this.input.mouse?.disableContextMenu();
        const { W, A, S, D, Q, SPACE, ESC, F3 } = Phaser.Input.Keyboard.KeyCodes;
        const keyboard = this.input.keyboard!;
        this.keys = keyboard.addKeys({ up: W, left: A, down: S, right: D }) as Keys;
        keyboard.addCapture([SPACE, Q, ESC, F3]);
        const dodge = (event: KeyboardEvent) => { if (!this.mobile && !event.repeat) this.dodgePressed = true; };
        const ultimate = (event: KeyboardEvent) => {
            if (!this.mobile && !event.repeat && this.mode === 'fighting') this.ultimatePressed = true;
        };
        const pause = (event: KeyboardEvent) => { if (!event.repeat) this.pausePressed = true; };
        const debug = (event: KeyboardEvent) => { if (!event.repeat) this.debug = !this.debug; };
        keyboard.on('keydown-SPACE', dodge);
        keyboard.on('keydown-Q', ultimate);
        keyboard.on('keydown-ESC', pause);
        keyboard.on('keydown-F3', debug);
        this.input.on('pointerdown', this.onPointerDown, this);
        this.game.events.on(Phaser.Core.Events.BLUR, this.onBlur, this);
        this.scale.on(Phaser.Scale.Events.RESIZE, this.cancelTouchInput, this);
        this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.draw, this);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.enemyProjectiles.length = 0;
            for (const enemy of this.enemies) enemy.statuses.clear();
            keyboard.off('keydown-SPACE', dodge);
            keyboard.off('keydown-Q', ultimate);
            keyboard.off('keydown-ESC', pause);
            keyboard.off('keydown-F3', debug);
            this.input.off('pointerdown', this.onPointerDown, this);
            this.game.events.off(Phaser.Core.Events.BLUR, this.onBlur, this);
            this.scale.off(Phaser.Scale.Events.RESIZE, this.cancelTouchInput, this);
            this.mobile?.destroy();
            this.settings?.destroy();
            this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.draw, this);
        });

        if (this.testEnemy) {
            this.wave = 0;
            this.spawnWave();
            this.mobile?.setActive(true);
        } else {
            this.offerOpening();
        }
        this.draw();
    }

    private onPointerDown(pointer: Phaser.Input.Pointer) {
        if (!this.mobile && this.mode === 'fighting' && pointer.button === 0 && !this.ignorePointerUntilUp) {
            this.attackPressed = true;
        }
    }

    private onBlur() {
        this.attackPressed = false;
        this.dodgePressed = false;
        this.ultimatePressed = false;
        this.pausePressed = false;
        this.ignorePointerUntilUp = true;
        this.cancelTouchInput();
        this.block.update(false, false, this.aim, this.clock);
        this.input.keyboard?.resetKeys();
    }

    private cancelTouchInput() {
        this.mobile?.reset();
        this.touchUltimateAiming = false;
    }

    private checkTips() {
        // 只在没有别的提示挡着时弹，否则等下一帧（教程条会自己淡出）。
        if (this.testEnemy || this.view.tipVisible) return;
        if (this.wave === 0 && this.clock > 1 && this.showTip('guard', '坚守反击', this.mobile
            ? '按住右摇杆举盾：减伤七成，移动减半。\n敌人抬手时再按下 → 完美格挡，伤害归零并震开对手。'
            : '按住右键举盾：减伤七成，移动减半。\n敌人抬手时再按下 → 完美格挡，伤害归零并震开对手。')) return;
        if (!this.resolve.ready) return;
        this.showTip('ultimate', '战意已满', this.mobile
            ? '按住「大招」瞄准，松开释放「王庭断章」。\n对韧性被打空的敌人伤害更高。'
            : '按 Q 朝准星方向释放「王庭断章」。\n对韧性被打空的敌人伤害更高。');
    }

    private showTip(id: TipId, title: string, body: string) {
        if (!this.tips.delete(id)) return false;
        markTipSeen(id);
        this.view.tipOverlay(title, body);
        return true;
    }

    private spawnWave() {
        const wave = waveSpec(this.wave + 1, this.challenge);
        const hpScale = this.testEnemy ? 1 : wave.hpScale * DIFFICULTIES[this.difficulty].enemyHp;
        this.relics.onWaveStarted();
        const locations: Point[] = [];
        const kinds: EnemyKind[] = this.testEnemy ? [this.testEnemy]
            : (Object.keys(ENEMIES) as EnemyKind[]).flatMap(kind => Array<EnemyKind>(wave[kind]).fill(kind));
        const slots = new Map<EnemyKind, number>();
        for (const kind of kinds) {
            const at = spawnPoint(this.player, locations, ENEMIES[kind].radius);
            locations.push(at);
            const slot = slots.get(kind) ?? 0;
            slots.set(kind, slot + 1);
            const enemy = createEnemy(this.view, this, kind, at, hpScale, this.clock, slot);
            this.enemyGroup.add(enemy.sprite);
            this.enemies.push(enemy);
            if (kind === 'crownlessBody') this.spawnCrownlessHead(enemy, at, hpScale);
        }
        const featured = this.testEnemy ?? (wave.guardian ? 'guardian' : wave.crownlessBody ? 'crownlessBody' : undefined);
        this.view.waveBanner(this.wave + 1, this.challenge, featured ? ENEMIES[featured].label : undefined);
        playCue('wave');
    }

    private spawnCrownlessHead(body: Enemy, from: Point, hpScale: number) {
        // 残魂从铠甲上方浮起来，之后按「保持距离」的方式自己走位。
        const head = createEnemy(this.view, this, 'crownlessHead', {
            x: Phaser.Math.Clamp(from.x + 130, 80, FIELD.width - 80),
            y: Phaser.Math.Clamp(from.y - 70, 80, FIELD.height - 80),
        }, hpScale, this.clock, 0);
        this.enemyGroup.add(head.sprite);
        this.enemies.push(head);
        this.crownless = { body, head, lit: true, reviveAt: 0 };
    }

    private armorOf(enemy: Enemy) {
        const link = this.crownless;
        return link && link.lit && enemy === link.body ? CROWNLESS.armor : 0;
    }

    /** 击碎残魂：不判定死亡，改为让铠甲失衡一段时间。返回 true 表示这次击杀已被接管。 */
    private suppressCrownlessHead(enemy: Enemy, time: number): boolean {
        const link = this.crownless;
        if (!link || link.head !== enemy) return false;
        link.lit = false;
        link.reviveAt = time + CROWNLESS.darkDuration;
        enemy.sprite.setAlpha(0.3);
        if (enemy.special) cancelSpecialAttack(enemy.special, time);
        enemy.sprite.setVelocity(0);
        if (link.body.special) cancelSpecialAttack(link.body.special, time);
        link.body.vital.stunUntil = Math.max(link.body.vital.stunUntil, link.reviveAt);
        link.body.state = 'stunned';
        playCue('break');
        this.view.notice(`残魂熄灭 · 铠甲失衡 ${CROWNLESS.darkDuration} 秒`);
        return true;
    }

    /** 铠甲倒下时残魂一起消散，否则它会以 0 血留在场上挡住清场判定。 */
    private dismissCrownlessHead() {
        const link = this.crownless;
        if (!link) return;
        this.crownless = undefined;
        const { head } = link;
        head.vital.hp = 0;
        this.relics.forgetTarget(head.vital);
        head.bars.destroy();
        head.sprite.setVelocity(0).setVisible(false);
        this.enemies = this.enemies.filter(enemy => enemy !== head);
        // 这一帧可能还有别的遍历在跑（连锁爆炸、遗物 AoE），销毁推迟到帧末。
        this.time.delayedCall(0, () => {
            if (head.sprite.active) this.enemyGroup.remove(head.sprite, true, true);
        });
    }

    private updateCrownless() {
        const link = this.crownless;
        if (!link || link.lit || this.clock < link.reviveAt) return;
        link.lit = true;
        link.head.vital.hp = Math.max(1, Math.round(link.head.vital.maxHp * CROWNLESS.reviveFraction));
        link.head.sprite.setAlpha(1);
        if (link.head.special) link.head.special.readyAt = this.clock + CROWNLESS.reviveDelay;
        playCue('wave');
        this.view.notice('残魂重燃 · 铠甲复起');
    }

    /** 裂地剑气：沿朝向依次爆开，每一段各自判定，可以侧移或闪避穿过去。 */
    private breakLine(origin: Point, heading: number, attack: SpecialAttack & { kind: 'line' }, damage: number) {
        const dx = Math.cos(heading), dy = Math.sin(heading);
        for (let step = 1; step <= attack.steps; step += 1) {
            const at = {
                x: origin.x + dx * attack.length * step / attack.steps,
                y: origin.y + dy * attack.length * step / attack.steps,
            };
            this.time.delayedCall(attack.interval * step * 1000, () => {
                if (this.mode !== 'fighting') return;
                this.view.showBurst(at, attack.width, 0xffcf9a);
                this.cameras.main.shake(80, 0.003, true);
                const player = this.player.body!.center;
                if (this.inDodgeImmunity() || distance(at, player) > attack.width) return;
                this.hurtPlayer(at, player, damage, { kind: 'area' });
            });
        }
    }

    private bossLabel(): string | undefined {
        const boss = this.enemies.find(enemy => isBossKind(enemy.kind));
        if (!boss) return this.testEnemy ? ENEMIES[this.testEnemy].label : undefined;
        const link = this.crownless;
        if (boss.kind === 'crownlessBody') {
            if (!link || link.lit) return '无冠者 · 魂甲';
            return `无冠者 · 失衡 ${Math.max(0, link.reviveAt - this.clock).toFixed(1)} 秒`;
        }
        return `${ENEMIES[boss.kind].label} · 阶段 ${boss.special?.phase}`;
    }

    update(time: number, delta: number) {
        const dodgePressed = this.dodgePressed;
        const ultimatePressed = this.ultimatePressed;
        this.dodgePressed = false;
        this.ultimatePressed = false;
        if (this.pausePressed) {
            this.pausePressed = false;
            if (this.settings?.isOpen()) {
                this.settings.close();
            } else if (this.mode === 'paused') {
                if (this.pauseStage === 'quit') this.showPause();
                else this.resume();
            } else if (this.mode === 'fighting') {
                this.freeze('paused');
                this.showPause();
            }
            return;
        }
        if (this.mode !== 'fighting') return;

        const step = Math.min(delta, 50);
        if (step <= 0) return;
        const previous = this.clock;
        this.clock += step / 1000;
        this.dodgeWork = Math.max(0, this.dodgeWork - step / 1000 * this.relics.dodgeRecoveryRate(this.vital));
        this.updateStatuses();

        const pointer = this.input.activePointer;
        if (pointer.noButtonDown()) this.ignorePointerUntilUp = false;
        const at = this.player.body!.center;
        const touch = this.mobile?.input.frame(this.aim);
        this.touchUltimateAiming = touch?.aimingUltimate ?? false;
        this.aim = touch?.heading ?? direction(at, this.cameras.main.getWorldPoint(pointer.x, pointer.y), this.aim);

        const movement = touch?.movement ?? new Phaser.Math.Vector2(
            Number(this.keys.right.isDown) - Number(this.keys.left.isDown),
            Number(this.keys.down.isDown) - Number(this.keys.up.isDown),
        ).normalize();

        const castHeading = touch?.castHeading ?? (ultimatePressed ? this.aim : undefined);
        this.updateUltimate(at);
        this.updateDodge(movement, dodgePressed && !this.ultimate && !this.touchUltimateAiming && touch?.castHeading === undefined);
        const attackRequested = touch?.attack ?? (this.attackPressed || (!this.ignorePointerUntilUp && pointer.leftButtonDown()));
        this.attackPressed = false;

        // Resolve a late frame crossing the end of the active window before discarding the swing.
        if (this.swing && swingHasContact(this.swing, previous, this.clock)) {
            this.swingAt(at, this.swing);
        }
        if (this.swing && this.clock >= swingContactEnd(this.swing)) this.settleSwing(this.swing);
        if (this.swing && swingPhase(this.swing, this.clock) === 'done') this.swing = undefined;
        this.updateBlades(step / 1000);
        this.updateTimedRelics();

        if (castHeading !== undefined && !this.dodge && !this.ultimate) this.beginUltimate(castHeading);
        const canAct = !this.dodge && !this.swing && !this.ultimate && !this.touchUltimateAiming;
        const guardHeld = touch?.guard ?? (!this.ignorePointerUntilUp && pointer.rightButtonDown());
        this.block.update(guardHeld, canAct, this.aim, previous);
        if (this.block.active || (this.touchUltimateAiming && !this.ultimate)) {
            this.faceHeading(this.aim);
        } else if (canAct && attackRequested && this.clock >= this.nextAttack) {
            this.beginSwing();
        } else if (canAct && movement.x) {
            this.facing = movement.x < 0 ? -1 : 1;
        }

        this.checkTips();
        this.applyPlayerVelocity(movement);
        const tuning = DIFFICULTIES[this.difficulty];
        const damageScale = this.testEnemy ? 1 : WAVES[this.wave].damageScale * (this.waveModifiers.enemyDamage ?? 1) * tuning.enemyDamage;
        const projectileSpeed = this.testEnemy ? 1 : tuning.projectileSpeed;
        const shots: EnemyProjectile<Enemy>[] = [];
        for (const enemy of this.enemies) {
            if (enemy.vital.hp <= 0 || this.vital.hp <= 0) continue;
            const frozen = enemy.statuses.isFrozen(this.clock);
            if (enemy.sprite.body!.immovable !== frozen) enemy.sprite.setImmovable(frozen);
            if (frozen) {
                recoverPoise(enemy.vital, this.clock);
                continue;
            }
            const push = enemy.parryPush;
            if (push && this.clock < push.until) {
                recoverPoise(enemy.vital, this.clock);
                enemy.sprite.setVelocity(push.velocity.x, push.velocity.y);
                continue;
            }
            enemy.parryPush = undefined;
            const origin = enemy.sprite.body!.center;
            if (enemy.special) {
                const event = updateSpecialEnemy(enemy, origin, at, this.clock, step / 1000);
                if (event?.kind !== 'execute') continue;
                const { attack, origin: anchor, heading } = event.active;
                const damage = Math.round(attack.damage * damageScale * 10) / 10;
                if (attack.kind === 'volley') {
                    for (const offset of attack.headings) {
                        shots.push(launchEnemyProjectile(anchor, heading + offset * Math.PI / 180, damage, attack.projectile, projectileSpeed, enemy));
                    }
                } else if (attack.kind === 'line') {
                    this.breakLine(anchor, heading, attack, damage);
                } else if (!this.inDodgeImmunity() && (attack.kind === 'slam' ? distance(anchor, at) <= attack.radius
                    : attack.kind === 'cone' && inSector(anchor, at, heading, attack.radius, attack.degrees))) {
                    this.hurtPlayer(anchor, at, damage, { kind: attack.kind === 'slam' ? 'area' : 'melee', attacker: enemy });
                }
            } else if (enemy.archer) {
                if (updateArcherEnemy(enemy, origin, at, this.clock)) {
                    const damage = Math.round(ENEMIES.archer.damage * damageScale * 10) / 10;
                    shots.push(launchEnemyProjectile(origin, enemy.archer.heading, damage, ARCHER.projectile, projectileSpeed, enemy));
                }
            } else if ((enemy.kind === 'slime' || enemy.kind === 'skeleton')
                && updateEnemy(enemy, origin, at, this.clock) && !this.inDodgeImmunity()) {
                const damage = Math.round(ENEMIES[enemy.kind].damage * damageScale * 10) / 10;
                this.hurtPlayer(origin, at, damage, { kind: 'melee', attacker: enemy });
            }
        }
        this.removeDefeated();
        if (this.vital.hp <= 0) {
            this.endRun(false);
            return;
        }

        const dodgeStart = this.dodge && this.relics.held.has('horn') ? { x: at.x, y: at.y } : null;
        const playerBefore = { x: at.x, y: at.y };
        const charges = this.enemies.flatMap(enemy => {
            const attack = enemy.special?.active;
            const position = enemy.sprite.body!.center;
            return attack?.stage === 'charge' && !attack.hit ? [{ enemy, attack, position: { x: position.x, y: position.y } }] : [];
        });
        this.physics.world.update(time, step);
        const playerAfter = this.player.body!.center;
        for (const { enemy, attack, position } of charges) {
            if (this.vital.hp <= 0 || enemy.vital.hp <= 0) continue;
            const end = enemy.sprite.body!.center;
            const hitAt = movingCircleContact(position, end, playerBefore, playerAfter, ENEMIES[enemy.kind].radius + WARRIOR.radius);
            if (hitAt === Infinity) continue;
            attack.hit = true;
            const contactTime = previous + step / 1000 * hitAt;
            if (!this.inDodgeImmunity(contactTime)) {
                const target = { x: playerBefore.x + (playerAfter.x - playerBefore.x) * hitAt,
                    y: playerBefore.y + (playerAfter.y - playerBefore.y) * hitAt };
                const source = { x: target.x - Math.cos(attack.heading), y: target.y - Math.sin(attack.heading) };
                this.hurtPlayer(source, target, Math.round(attack.attack.damage * damageScale * 10) / 10,
                    { kind: 'melee', attacker: enemy }, contactTime);
            }
        }
        this.enemyProjectiles = this.enemyProjectiles.filter(projectile =>
            advanceEnemyProjectile(projectile, step / 1000, OBSTACLES, FIELD, playerBefore, playerAfter, WARRIOR.radius,
                (_, target, fraction) => {
                    const contactTime = previous + step / 1000 * fraction;
                    if (this.vital.hp <= 0 || this.inDodgeImmunity(contactTime)) return false;
                    const source = { x: target.x - Math.cos(projectile.heading), y: target.y - Math.sin(projectile.heading) };
                    return this.hurtPlayer(source, target, projectile.damage,
                        { kind: 'projectile', attacker: projectile.attacker, damageType: projectile.damageType }, contactTime);
                }));
        this.enemyProjectiles.push(...shots);
        if (this.vital.hp <= 0) {
            this.removeDefeated();
            this.endRun(false);
            return;
        }
        if (dodgeStart && this.dodge) {
            this.chargeThrough(dodgeStart, this.player.body!.center, this.dodge);
        }
        this.updateCrownless();
        this.removeDefeated();
        if (this.enemies.length === 0) this.settleWave();
    }

    private updateDodge(movement: Point, dodgePressed: boolean) {
        if (this.dodge && this.clock >= this.dodge.started + WARRIOR.dodge.duration) {
            const { origin } = this.dodge;
            this.dodge = undefined;
            this.relics.onDodgeFinished(this.clock, this.vital);
            if (this.relics.held.has('cloak')) {
                const ghost = this.view.spawnEcho(this.player, origin);
                this.echoes.push({ origin, ghost, due: this.clock + RELICS.cloak.delay });
            }
        }
        if (dodgePressed && !this.dodge && this.dodgeWork <= 1e-9) {
            const heading = movement.x || movement.y
                ? direction({ x: 0, y: 0 }, movement)
                : this.facing === 1 ? 0 : Math.PI;
            if (this.swing) this.settleSwing(this.swing);
            this.swing = undefined;
            const { x, y } = this.player.body!.center;
            this.dodge = { heading, started: this.clock, nextTrail: this.clock, origin: { x, y }, hit: new Set() };
            this.dodgeWork = this.relics.dodgeCooldown;
            this.faceHeading(heading);
        }
        if (this.dodge && this.clock >= this.dodge.nextTrail) {
            this.view.trail(this.player);
            this.dodge.nextTrail = this.clock + WARRIOR.dodge.trailInterval;
        }
    }

    private chargeThrough(start: Point, end: Point, dodge: Dodge) {
        if (start.x === end.x && start.y === end.y) return;
        for (const enemy of this.enemies) {
            if (enemy.vital.hp <= 0 || dodge.hit.has(enemy)) continue;
            const target = enemy.sprite.body!.center;
            if (!segmentHits(start, end, target, WARRIOR.radius + ENEMIES[enemy.kind].radius)) continue;
            dodge.hit.add(enemy);
            this.hurtEnemy(enemy, { origin: start, target, amount: RELICS.horn.damage, source: 'charge' });
        }
    }

    private updateTimedRelics() {
        this.resonances = this.resonances.filter(echo => {
            if (echo.enemy.vital.hp <= 0) return false;
            if (this.clock < echo.due) return true;
            const target = echo.enemy.sprite.body!.center;
            this.view.showBurst(target, 17, DAMAGE_COLORS[echo.type]);
            this.hurtEnemy(echo.enemy, { origin: target, target, amount: echo.amount, source: 'echoBlade', damageType: echo.type });
            return false;
        });
        this.extraSlashes = this.extraSlashes.filter(slash => {
            if (this.clock < slash.due) return true;
            const { range, angle } = WARRIOR.attack;
            this.view.showExtraSlash(slash.origin, slash.heading, range, angle);
            for (const enemy of this.enemies) {
                if (enemy.vital.hp <= 0) continue;
                const target = enemy.sprite.body!.center;
                if (inSector(slash.origin, target, slash.heading, range, angle)) {
                    this.hurtEnemy(enemy, { origin: slash.origin, target, amount: slash.amount, source: 'extraSlash' });
                }
            }
            return false;
        });
        this.echoes = this.echoes.filter(echo => {
            if (this.clock < echo.due) return true;
            echo.ghost.destroy();
            this.burstAround(echo.origin, RELICS.cloak, 'echo');
            return false;
        });
    }

    private updateStatuses() {
        for (const enemy of this.enemies) {
            const target = enemy.sprite.body!.center;
            let displayed: Partial<Record<DamageType, number>> | undefined;
            enemy.statuses.advance(this.clock, (type, amount, time) => {
                const result = this.hurtWithDot(enemy, target, amount, type, time);
                if (!result?.healthDamage) return;
                // Keep per-stack damage events while showing one popup per element per frame.
                displayed ??= {};
                displayed[type] = (displayed[type] ?? 0) + result.healthDamage;
            });
            if (!displayed) continue;
            for (const type of Object.keys(displayed) as DamageType[]) {
                const rise = type === 'nature' && displayed.fire ? 18 : 0;
                this.view.showHit({ x: target.x, y: target.y - rise }, displayed[type]!, DAMAGE_COLORS[type]);
            }
        }
    }

    private faceHeading(heading: number) {
        const x = Math.cos(heading);
        if (Math.abs(x) > 0.01) this.facing = x < 0 ? -1 : 1;
    }

    private beginSwing() {
        const crescent = this.relics.onAttackStarted();
        const counter = this.block.takeCounter();
        const perfectCounter = counter === 'perfect';
        const block = WARRIOR.block;
        this.swing = {
            heading: this.aim,
            started: this.clock,
            speed: this.relics.attackSpeed(this.vital),
            damageScale: (counter ? 1 + block.bonus : 1) * this.relics.takeDodgeBonus(this.clock),
            skipWindup: this.relics.takeWindupSkip(),
            attackBonus: crescent?.bonus,
            phoenixBurn: this.relics.takePhoenixBurn(),
            rangeMultiplier: (1 + (crescent?.rangeBonus ?? 0)) * (perfectCounter ? block.counterRange : 1),
            angle: perfectCounter ? block.counterAngle : undefined,
            poiseMultiplier: perfectCounter ? block.counterPoise : undefined,
            pending: this.relics.held.has('wolf') ? [] : undefined,
            hit: new Set(),
        };
        this.nextAttack = this.clock + WARRIOR.attack.interval / this.swing.speed;
        this.faceHeading(this.aim);
        playCue('swing');
        if (this.swing.skipWindup) this.swingAt(this.player.body!.center, this.swing);
    }

    private beginUltimate(heading: number) {
        if (!this.resolve.ready) return;
        if (this.swing) this.settleSwing(this.swing);
        this.swing = undefined;
        this.resolve.spend();
        this.ultimate = { started: this.clock, heading, released: false };
        this.vital.knockUntil = 0;
        this.faceHeading(heading);
        playCue('ultimate');
    }

    private updateUltimate(at: Point) {
        const cast = this.ultimate;
        if (!cast) return;
        const elapsed = this.clock - cast.started;
        const { ultimate, attack } = WARRIOR;
        if (!cast.released && elapsed >= ultimate.windup) {
            cast.released = true;
            const range = attack.range * ultimate.range;
            this.view.showUltimateSlash(at, cast.heading, range, ultimate.angle);
            this.cameras.main.shake(160, 0.003, true);
            for (const enemy of this.enemies) {
                if (enemy.vital.hp <= 0) continue;
                const target = enemy.sprite.body!.center;
                if (!inSector(at, target, cast.heading, range, ultimate.angle)) continue;
                const multiplier = this.clock < enemy.vital.vulnerableUntil ? 1 + ultimate.brokenBonus : 1;
                this.hurtEnemy(enemy, { origin: at, target, amount: attack.damage * ultimate.damage * multiplier,
                    poise: attack.poise * ultimate.poise, source: 'ultimate' });
            }
        }
        if (elapsed >= ultimate.duration) this.ultimate = undefined;
    }

    private applyPlayerVelocity(movement: Point) {
        this.player.setFlipX(this.facing < 0);
        this.walking = movement.x !== 0 || movement.y !== 0;
        const baseSpeed = WARRIOR.speed * this.relics.movementSpeed;
        if (this.ultimate) {
            const speed = baseSpeed * WARRIOR.ultimate.movement;
            this.player.setVelocity(movement.x * speed, movement.y * speed);
            return;
        }
        if (this.dodge) {
            const speed = baseSpeed * WARRIOR.dodge.speed;
            this.player.setVelocity(Math.cos(this.dodge.heading) * speed, Math.sin(this.dodge.heading) * speed);
            return;
        }
        let multiplier = this.block.active ? WARRIOR.block.speed : 1;
        if (this.swing) {
            const phase = swingPhase(this.swing, this.clock);
            const attack = WARRIOR.attack;
            if (phase === 'windup') multiplier = attack.windupSpeed;
            if (phase === 'active') multiplier = attack.activeSpeed;
            if (phase === 'recovery') multiplier = attack.recoverySpeed;
            multiplier = this.relics.attackMovementMultiplier(multiplier);
        }
        const knock = this.clock < this.vital.knockUntil ? this.vital.knock : { x: 0, y: 0 };
        this.player.setVelocity(
            movement.x * baseSpeed * multiplier + knock.x,
            movement.y * baseSpeed * multiplier + knock.y,
        );
    }

    private inDodgeImmunity(time = this.clock) {
        return this.dodge && time < this.dodge.started + WARRIOR.dodge.immunity;
    }

    private swingAt(at: Point, swing: Swing<Enemy>) {
        const { attack } = WARRIOR;
        const angle = swing.angle ?? attack.angle;
        const damage = attack.damage;
        const baseDamage = damage * swing.damageScale * this.relics.attackDamageAt(this.clock) * (this.waveModifiers.normalAttack ?? 1);
        if (!swing.released) {
            swing.released = true;
            if (this.relics.onAttackReleased()) {
                this.blades.push({ x: at.x, y: at.y, heading: swing.heading, remaining: RELICS.blade.distance, hit: new Set() });
            }
            if (this.relics.rollExtraSlash()) {
                this.extraSlashes.push({
                    origin: { x: at.x, y: at.y }, heading: swing.heading,
                    amount: baseDamage * RELICS.twin.damageScale, due: this.clock + RELICS.twin.delay,
                });
            }
        }
        for (const enemy of this.enemies) {
            if (enemy.vital.hp <= 0 || swing.hit.has(enemy)) continue;
            const target = enemy.sprite.body!.center;
            if (!inSector(at, target, swing.heading, swingRange(swing), angle)) continue;
            swing.hit.add(enemy);
            if (swing.pending) swing.pending.push({ enemy, origin: { x: at.x, y: at.y }, amount: baseDamage });
            else this.hitWithSwing(enemy, at, baseDamage, swing.attackBonus ?? 0, swing);
        }
    }

    private settleSwing(swing: Swing<Enemy>) {
        if (!swing.pending?.length) return;
        const contacts = swing.pending.filter(contact => contact.enemy.vital.hp > 0);
        swing.pending.length = 0;
        const attackBonus = (swing.attackBonus ?? 0) + (contacts.length === 1 ? RELICS.wolf.bonus : 0);
        for (const { enemy, origin, amount } of contacts) this.hitWithSwing(enemy, origin, amount, attackBonus, swing);
    }

    private hitWithSwing(enemy: Enemy, origin: Point, amount: number, attackBonus: number, swing: Swing<Enemy>) {
        const target = enemy.sprite.body!.center;
        const burnStacks = enemy.statuses.stacks('burning', this.clock);
        const wasSlowed = enemy.statuses.isSlowed(this.clock);
        const wasFrozen = enemy.statuses.isFrozen(this.clock);
        const hit = this.hurtEnemy(enemy, {
            origin, target, source: 'normal', amount: amount * this.relics.executionMultiplier(enemy.vital, this.clock),
            sourceBonus: attackBonus + this.relics.hitDamageBonus(enemy.vital, this.clock),
            poise: WARRIOR.attack.poise * this.relics.poiseDamage * (swing.poiseMultiplier ?? 1),
            critMultiplier: this.relics.criticalMultiplier(),
        });
        if (!hit || !hit.tags.canTriggerOnHit || !hit.healthDamage) return;

        const resolveHits = swing.resolveHits ?? 0;
        if (resolveHits < WARRIOR.resolve.hitTargetsPerSwing && this.resolve.onNormalHit(enemy.vital, this.clock)) {
            swing.resolveHits = resolveHits + 1;
        }
        const lightning = this.relics.onAttackHit('normal');
        const starlight = this.relics.onStarlightHit();
        const starBottle = this.relics.onStarBottleHit(hit.critical, !swing.landed);
        swing.landed = true;
        const procs = this.relics.onDirectHit(enemy.vital, this.clock, { resistances: enemy.statuses.resistances });
        const serpent = this.relics.onSerpentHit();
        const wick = this.relics.onWickHit();
        const snowFox = this.relics.takeSnowFoxHit(this.clock);
        if (enemy.vital.hp > 0 && (wasSlowed || wasFrozen)) this.resolveColdHit(enemy, target, wasFrozen);
        if (this.relics.tryLilyBurst(enemy.vital, burnStacks, this.clock)) {
            const spec = RELICS.goldenLily;
            enemy.statuses.consumeBurning(spec.layers, this.clock);
            this.burstAround(target, spec, 'goldenLily');
        }
        if (enemy.vital.hp > 0 && this.relics.held.has('mandrakeHeart')) {
            const damage = enemy.statuses.consumePoison(RELICS.mandrakeHeart.layers, this.clock);
            if (damage > 0) {
                const burst = this.hurtWithDot(enemy, target, damage, 'nature');
                if (burst?.healthDamage) {
                    this.view.showHit({ x: target.x, y: target.y - 20 }, burst.healthDamage, DAMAGE_COLORS.nature, '毒爆 ');
                }
            }
        }
        if (procs.burning) this.applyBurning(enemy, this.clock);
        if (wick) this.applyBurning(enemy, this.clock);
        if (swing.phoenixBurn) this.applyBurning(enemy, this.clock);
        if (enemy.vital.hp > 0) {
            if (procs.poison || serpent) {
                const modifiers = this.relics.dotModifiers;
                if (procs.poison) enemy.statuses.apply('poison', this.clock, modifiers);
                if (serpent) enemy.statuses.apply('poison', this.clock, modifiers);
            }
            if (procs.slow) this.applyFrostSlow(enemy);
            if (procs.winterBud) this.applyFrostSlow(enemy);
            if (snowFox) this.applyFrostSlow(enemy, wasSlowed ? RELICS.snowFox.bonusChill : 0);
            if (procs.echo) {
                this.resonances.push({
                    enemy, amount: hit.healthDamage * RELICS.resonance.damageScale, type: hit.type,
                    due: this.clock + RELICS.resonance.delay,
                });
            }
        }
        if (lightning) this.hurtEnemy(enemy, { origin, target, amount: lightning, source: 'lightning' });
        if (hit.critical && hit.tags.canTriggerOnCrit) this.prismFrom(enemy, target);
        if (starlight) this.starlightFrom(enemy, target);
        if (starBottle && enemy.vital.hp > 0) {
            this.view.showArcaneSpark(target);
            this.hurtEnemy(enemy, { origin, target, amount: RELICS.starBottle.damage, source: 'starBottle' });
        }
    }

    private resolveColdHit(enemy: Enemy, at: Point, wasFrozen: boolean) {
        if (wasFrozen && this.relics.held.has('snowMirror')) {
            const spec = RELICS.snowMirror;
            enemy.statuses.shatter(this.clock);
            enemy.sprite.setImmovable(false);
            this.hurtEnemy(enemy, { origin: at, target: at, source: 'shatter', amount: spec.damage }, this.clock, true);
            this.damageAround(at, spec.splash, 'shatter', enemy);
            this.view.showShatter(at, spec.splash.range);
        }
        if (enemy.vital.hp > 0 && this.relics.held.has('frostBell')) {
            const damage = WARRIOR.attack.damage * RELICS.frostBell.damageScale;
            this.hurtEnemy(enemy, { origin: at, target: at, source: 'frostBell', amount: damage }, this.clock, true);
        }
    }

    private applyFrostSlow(enemy: Enemy, bonusChill = 0) {
        const { applied, frozen } = enemy.statuses.applySlow(this.clock, {
            bonusChill,
            canFreeze: this.relics.held.has('iceCrown'),
            freezeDurationBonus: this.relics.freezeDurationBonus,
        });
        if (frozen) freezeEnemy(enemy, this.clock);
        return applied;
    }

    private applyBurning(enemy: Enemy, time: number) {
        if (enemy.vital.hp <= 0 || !enemy.statuses.apply('burning', time, this.relics.dotModifiers)) return;
        if (this.relics.held.has('furnacePendant')) {
            const target = enemy.sprite.body!.center;
            this.hurtEnemy(enemy, { origin: target, target, amount: RELICS.furnacePendant.damage, source: 'furnacePendant' }, time);
        }
    }

    private prismFrom(enemy: Enemy, at: Point) {
        if (!this.relics.prismReady(this.clock)) return;
        const best = this.closestLivingEnemy(at, RELICS.prism.range, enemy);
        if (!best) return;
        this.relics.spendPrism(this.clock);
        const target = best.sprite.body!.center;
        this.view.showLightning(at, target);
        this.hurtEnemy(best, { origin: at, target, source: 'prism', amount: RELICS.prism.damage });
    }

    private starlightFrom(enemy: Enemy, at: Point) {
        const spec = RELICS.starlightRing;
        const best = this.closestLivingEnemy(at, spec.range, enemy) ?? enemy;
        if (best.vital.hp <= 0) return;
        const target = best.sprite.body!.center;
        if (best !== enemy) this.view.showLightning(at, target);
        else this.view.showArcaneSpark(target);
        this.hurtEnemy(best, { origin: at, target, source: 'starlightRing', amount: spec.damage });
    }

    private closestLivingEnemy(at: Point, radius: number, excluded: Enemy) {
        let best: Enemy | undefined;
        for (const other of this.enemies) {
            if (other === excluded || other.vital.hp <= 0) continue;
            const separation = distance(at, other.sprite.body!.center);
            if (separation <= radius) {
                best = other;
                radius = separation;
            }
        }
        return best;
    }


    private updateBlades(delta: number) {
        const spec = RELICS.blade;
        this.blades = this.blades.filter(blade => {
            const travel = Math.min(blade.remaining, spec.speed * delta);
            const end = { x: blade.x + Math.cos(blade.heading) * travel, y: blade.y + Math.sin(blade.heading) * travel };
            for (const enemy of this.enemies) {
                if (enemy.vital.hp <= 0 || blade.hit.has(enemy)) continue;
                const target = enemy.sprite.body!.center;
                if (!segmentHits(blade, end, target, spec.radius + ENEMIES[enemy.kind].radius)) continue;
                blade.hit.add(enemy);
                this.hurtEnemy(enemy, { origin: blade, target, amount: spec.damage, source: 'blade' });
            }
            blade.x = end.x;
            blade.y = end.y;
            blade.remaining -= travel;
            return blade.remaining > 0 && blade.x >= 0 && blade.x <= FIELD.width && blade.y >= 0 && blade.y <= FIELD.height;
        });
    }

    private hurtWithDot(enemy: Enemy, target: Point, amount: number, type: DamageType, time = this.clock) {
        return this.hurtEnemy(enemy, {
            origin: target, target, amount, source: 'dot', damageType: type,
            bonuses: { damageOverTime: this.relics.dotDamageBonus,
                types: { nature: this.relics.poisonDamageBonus, fire: this.relics.burnDamageBonus } },
        }, time);
    }

    private hurtEnemy(enemy: Enemy, hit: Hit, time = this.clock, cold = enemy.statuses.isCold(time)) {
        const burst = this.relics.poiseBurst;
        const profile = hitProfile(hit.source);
        const type = hit.damageType ?? profile.type;
        const typeBonus = type === 'frost' ? this.relics.frostDamageBonus(cold)
            : type === 'arcane' ? this.relics.arcaneDamageBonus : 0;
        if (typeBonus) {
            const typeBonuses = hit.bonuses?.types;
            hit = { ...hit, bonuses: { ...hit.bonuses, types: { ...typeBonuses, [type]: (typeBonuses?.[type] ?? 0) + typeBonus } } };
        }
        if (type === 'arcane' && profile.arcaneMode === 'original' && this.relics.astrolabeReady) {
            hit = { ...hit, amount: hit.amount * (1 + RELICS.dawnAstrolabe.bonus) };
        }
        const armor = this.armorOf(enemy);
        if (armor > 0) hit = { ...hit, amount: hit.amount * (1 - armor) };
        const result = resolveHit(enemy.vital, hit, time, burst?.bonus);
        if (!result) return null;
        if (!result.tags.dot && result.damage > 0) {
            playCue('hit');
            this.view.showHit(hit.target, result.damage, DAMAGE_COLORS[result.type], result.critical ? '暴击 ' : '');
        }
        if (result.killed && this.suppressCrownlessHead(enemy, time)) {
            // 残魂被击碎，铠甲失衡；不进入常规的死亡结算
        } else if (result.killed) {
            if (this.crownless?.body === enemy) this.dismissCrownlessHead();
            this.defeated.push({
                enemy,
                vulnerable: vulnerabilityBonus(enemy.vital, time) > 0, chainDepth: hit.chainDepth ?? 0,
                poisonLayers: this.relics.held.has('witherSeed')
                    ? enemy.statuses.stacks('poison', time, result.tags.dot && result.type === 'nature') : 0,
                burning: enemy.statuses.stacks('burning', time, result.tags.dot && result.type === 'fire') > 0,
                cold,
            });
        }
        if (result.breakProfile) {
            playCue('break');
            if (hit.source !== 'ultimate') this.resolve.onPoiseBreak(time);
            enemy.state = 'stunned';
            enemy.sprite.setVelocity(0, 0);
            if (enemy.special) cancelSpecialAttack(enemy.special, enemy.vital.stunUntil);
            this.view.showHit({ x: hit.target.x, y: hit.target.y - 25 }, result.breakDamage,
                DAMAGE_COLORS[result.breakProfile.type], '破韧 ');
            if (this.relics.held.has('starfire')) {
                for (const other of this.enemies) {
                    if (distance(hit.target, other.sprite.body!.center) <= RELICS.starfire.range) {
                        this.applyBurning(other, time);
                    }
                }
            }
            if (burst) this.burstAround(hit.target, burst, 'collapse', enemy);
        }
        if (enemy.special && changeBossPhase(enemy.special, enemy.vital.hp, enemy.vital.maxHp, time)) {
            enemy.sprite.setVelocity(0);
            playCue('break');
            this.view.notice(`${ENEMIES[enemy.kind].label} · 第二阶段`);
        }
        if (result.arcane?.canTriggerEffects) {
            this.resolveArcaneFollowups(result.arcane, result.healthDamage + result.absorbed, enemy, hit.target, time);
        }
        return result;
    }

    private resolveArcaneFollowups(event: ArcaneDamageEvent, damage: number, enemy: Enemy, at: Point, time: number) {
        const effects = this.relics.onArcaneDamage(event, damage, time);
        if (!effects) return;
        if (effects.pulse) {
            const origin = this.player.body!.center;
            this.view.showBurst(origin, RELICS.moonWatch.range, DAMAGE_COLORS.arcane);
            this.damageAround(origin, RELICS.moonWatch, 'moonWatch');
        }
        if (this.relics.held.has('meteorFragment')) {
            const spec = RELICS.meteorFragment;
            const other = this.closestLivingEnemy(at, spec.range, enemy);
            if (other) {
                const target = other.sprite.body!.center;
                this.view.showLightning(at, target, 160);
                this.hurtEnemy(other, { origin: at, target, amount: damage * spec.damageScale, source: 'meteorFragment' }, time);
            }
        }
        if (effects.splash) {
            const { range, splashScale } = RELICS.dawnAstrolabe;
            this.view.showBurst(at, range, DAMAGE_COLORS.arcane);
            this.damageAround(at, { range, damage: damage * splashScale }, 'dawnAstrolabe', enemy);
        }
    }

    private hurtPlayer(origin: Point, target: Point, amount: number, incoming: IncomingAttack, time = this.clock) {
        const hpBeforeHit = this.vital.hp;
        const armored = this.ultimate !== undefined;
        const hit: Hit = { origin, target, amount, source: 'enemy', damageType: incoming.damageType,
            block: !armored && incoming.kind !== 'area' ? this.block : undefined,
            damageReduction: armored ? WARRIOR.ultimate.damageReduction : 0, ignoreKnockback: armored };
        const result = resolveHit(this.vital, hit, time);
        if (!result) return false;
        if (result.guard) {
            this.resolve.onGuard(result.guard, time);
            this.dodgeWork = this.relics.onSuccessfulBlock(this.dodgeWork, this.relics.dodgeRecoveryRate(this.vital));
        }
        if (result.guard === 'perfect') {
            playCue('parry');
            this.view.showPerfectGuard(target);
            this.parryAttacker(incoming, target, time);
            return true;
        }
        if (result.guard) playCue('block');
        if (result.absorbed > 0) this.view.showHit({ x: target.x, y: target.y - 24 }, result.absorbed, 0xf4d287, '护盾 ');
        if (result.healthDamage > 0) {
            playCue('hurt');
            this.view.showHit(target, result.healthDamage, result.blocked ? 0xa6d7d2 : 0xf2a198, result.blocked ? '格挡 ' : '');
        }
        const hpAfterHit = this.vital.hp;
        this.relics.onDamageTaken(this.vital, hpBeforeHit, this.clock);
        this.showHealing(hpAfterHit);
        this.cameras.main.shake(105, 0.0016, true);
        const thorns = result.healthDamage > 0 ? this.relics.onPlayerDamaged(hit.source) : null;
        if (thorns) this.damageAround(target, thorns, 'thorns');
        return true;
    }

    private parryAttacker({ attacker, kind }: IncomingAttack, from: Point, time: number) {
        if (!attacker || attacker.vital.hp <= 0) return;
        const target = attacker.sprite.body!.center;
        const block = WARRIOR.block;
        this.hurtEnemy(attacker, { origin: from, target, amount: 0, poise: block.perfectPoise, source: 'parry' }, time);
        if (kind !== 'melee' || attacker.vital.hp <= 0 || attacker.statuses.isFrozen(time)) return;
        const heading = direction(from, target, this.block.heading);
        const speed = block.repelSpeed * (attacker.kind === 'guardian' ? block.bossRepelMultiplier : 1);
        const velocity = { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed };
        const until = time + block.repelDuration;
        attacker.parryPush = { velocity, until };
        if (attacker.special) cancelSpecialAttack(attacker.special, until);
        if (attacker.state === 'attack') attacker.state = 'recovery';
        attacker.sprite.setVelocity(velocity.x, velocity.y);
    }

    private damageAround(at: Point, effect: { range: number; damage: number }, source: HitSource, excluded?: Enemy, chainDepth = 0) {
        for (const enemy of this.enemies) {
            if (enemy === excluded || enemy.vital.hp <= 0) continue;
            const near = enemy.sprite.body!.center;
            if (distance(at, near) <= effect.range) {
                this.hurtEnemy(enemy, { origin: at, target: near, amount: effect.damage, source, chainDepth });
            }
        }
    }

    private burstAround(at: Point, effect: { range: number; damage: number }, source: 'aftershock' | 'collapse' | 'echo' | 'goldenLily',
        excluded?: Enemy, chainDepth = 0) {
        const colors = { aftershock: 0xffad75, collapse: 0xffce9c, echo: 0x9bd9ee, goldenLily: DAMAGE_COLORS.fire };
        this.view.showBurst(at, effect.range, colors[source]);
        this.damageAround(at, effect, source, excluded, chainDepth);
    }

    private nearbyLivingEnemies(at: Point, effect: { range: number; targets: number }) {
        const targets = this.enemies.filter(enemy => enemy.vital.hp > 0)
            .map(enemy => ({ enemy, at: enemy.sprite.body!.center }));
        return closestStatusTargets(at, targets, effect);
    }

    private removeDefeated() {
        if (!this.defeated.length) return;
        // Secondary kills append to the same queue. A dead enemy can never enqueue twice.
        for (const { enemy, vulnerable, chainDepth, poisonLayers, burning, cold } of this.defeated) {
            this.kills += 1;
            const gold = this.economy.collectKill(enemy.kind, this.wave + 1);
            this.view.showGold(enemy.sprite, gold);
            if (poisonLayers) {
                const spec = RELICS.witherSeed;
                const at = enemy.sprite.body!.center;
                const targets = this.enemies.filter(other => other.vital.hp > 0)
                    .map(other => ({ at: other.sprite.body!.center, statuses: other.statuses }));
                if (spreadPoison(at, targets, this.clock, { ...spec, layers: Math.min(poisonLayers, spec.layers) },
                    this.relics.dotModifiers)) {
                    this.view.showBurst(at, spec.range, DAMAGE_COLORS.nature);
                }
            }
            if (vulnerable) this.relics.onVulnerableKill(this.clock);
            const before = this.vital.hp;
            if (burning) this.relics.onBurningKill(this.vital);
            const blast = this.relics.onEnemyKilled(this.vital);
            this.showHealing(before);
            if (burning && this.relics.held.has('ashButterfly')) {
                const spec = RELICS.ashButterfly;
                const at = enemy.sprite.body!.center;
                const nearby = this.nearbyLivingEnemies(at, spec);
                for (const { enemy: other } of nearby) this.applyBurning(other, this.clock);
                if (nearby.length) this.view.showBurst(at, spec.range, DAMAGE_COLORS.fire);
            }
            if (cold && this.relics.held.has('whiteGarland')) {
                const spec = RELICS.whiteGarland;
                const at = enemy.sprite.body!.center;
                let spread = false;
                for (const { enemy: other } of this.nearbyLivingEnemies(at, spec)) {
                    if (this.applyFrostSlow(other)) spread = true;
                }
                if (spread) this.view.showBurst(at, spec.range, DAMAGE_COLORS.frost);
            }
            if (blast && chainDepth < MAX_KILL_CHAIN_DEPTH) {
                this.burstAround(enemy.sprite.body!.center, blast, 'aftershock', undefined, chainDepth + 1);
            }
            enemy.statuses.clear();
            enemy.vital.markedUntil = 0;
            this.relics.forgetTarget(enemy.vital);
            enemy.bars.destroy();
            enemy.sprite.destroy();
        }
        this.defeated.length = 0;
        this.enemies = this.enemies.filter(enemy => enemy.vital.hp > 0 || enemy === this.crownless?.head);
        this.resonances = this.resonances.filter(echo => echo.enemy.vital.hp > 0);
    }


    private showHealing(before: number) {
        if (this.vital.hp > before) this.view.showHit(this.player, this.vital.hp - before, 0xb7e69f, '+');
    }

    private freeze(mode: Mode) {
        this.stopBattle(mode);
        this.view.freeze(true);
    }

    private stopBattle(mode: Mode) {
        this.mode = mode;
        this.attackPressed = false;
        this.dodgePressed = false;
        this.ultimatePressed = false;
        this.touchUltimateAiming = false;
        this.mobile?.setActive(false);
        this.block.update(false, false, this.aim, this.clock);
        this.physics.pause();
        this.cameras.main.setLerp(0, 0);
        this.cameras.main.shakeEffect.reset();
    }

    private resume() {
        this.mode = 'fighting';
        this.pauseStage = undefined;
        this.ignorePointerUntilUp = true;
        this.view.hideOverlay();
        this.view.freeze(false);
        this.physics.resume();
        this.mobile?.setActive(true);
        this.cameras.main.setLerp(0.16, 0.16);
    }

    private showPause() {
        this.pauseStage = 'menu';
        this.view.pauseOverlay({
            resume: () => this.resume(),
            settings: () => this.settings?.open(),
            quit: () => {
                this.pauseStage = 'quit';
                this.view.quitConfirmOverlay(
                    () => this.scene.start('menu'),
                    () => this.showPause(),
                );
            },
        });
    }

    private applySettings() {
        this.cameras.main.setZoom(getSettings().zoom);
    }

    private settleWave() {
        this.stopBattle('settling');
        this.ultimate = undefined;
        this.enemyProjectiles.length = 0;
        const before = this.vital.hp;
        this.relics.onWaveCleared(this.vital);
        this.showHealing(before);
        this.waveModifiers = {};
        this.blades.length = 0;
        this.extraSlashes.length = 0;
        this.resonances.length = 0;
        for (const echo of this.echoes) echo.ghost.destroy();
        this.echoes.length = 0;
        this.time.delayedCall(400, () => {
            if (this.mode !== 'settling') return;
            if (this.testEnemy || this.wave + 1 === WAVES.length) {
                this.endRun(true, this.challenge ? this.grantFinalReward() : undefined);
            } else if (this.wave + 1 === BLESSING_WAVE && !this.relics.blessing) {
                this.offerBlessing();
            } else {
                this.offerWaveRewards();
            }
        });
    }

    private offerBlessing() {
        const options = blessingChoices(this.relics.held);
        if (!options.length) {
            this.offerWaveRewards();
            return;
        }
        this.freeze('blessing');
        this.view.blessingOverlay(options, faction => {
            if (this.mode !== 'blessing' || this.wave + 1 !== BLESSING_WAVE || !options.includes(faction)) return;
            if (this.relics.chooseBlessing(faction)) this.offerWaveRewards();
        });
    }

    private offerWaveRewards() {
        if (!this.challenge) {
            this.offerEvents();
            return;
        }
        const offers = this.relics.choices();
        if (offers.length) this.offerRelic(offers, '强化波已击破，选择额外遗物后继续', () => this.offerEvents());
        else this.showReward(this.economy.goldReward(this.wave + 1), () => this.offerEvents());
    }

    private grantFinalReward(): EventReward {
        const [id] = this.relics.choices();
        if (!id) return this.economy.goldReward(this.wave + 1);
        this.relics.acquire(id, this.vital);
        return { kind: 'relic', id };
    }

    private offerOpening() {
        const offers = this.relics.choices();
        this.freeze('opening');
        const choose = (choice: RelicId | 'gold') => {
            if (this.mode !== 'opening' || this.wave !== -1) return;
            if (choice === 'gold') this.economy.addGold(OPENING_GOLD);
            else if (offers.includes(choice)) this.relics.acquire(choice, this.vital);
            else return;
            this.startNextWave('opening');
        };
        this.view.rewardOverlay(offers, '选一件遗物或领取金币，开始第 1 波', choose,
            { amount: OPENING_GOLD, choose: () => choose('gold') });
    }

    private offerRelic(offers: RelicId[], prompt: string, proceed: () => void) {
        const wave = this.wave;
        this.freeze('relic');
        this.view.rewardOverlay(offers, prompt, id => {
            if (this.mode !== 'relic' || this.wave !== wave || !offers.includes(id)) return;
            this.relics.acquire(id, this.vital);
            proceed();
        });
    }

    private offerEvents() {
        const cleared = this.wave + 1;
        if (isSupplyStop(cleared)) {
            this.freeze('shop');
            this.supplyTip = this.tips.delete('supply');
            if (this.supplyTip) markTipSeen('supply');
            this.economy.openShop(this.relics.held, Math.random, this.relics.blessing);
            this.showShop();
            return;
        }
        this.freeze('events');
        const cards = eventCardsAfter(cleared);
        this.view.eventOverlay(cleared, cards, card => {
            if (this.mode === 'events' && this.wave + 1 === cleared && cards.includes(card)) this.chooseEvent(card);
        });
    }

    private chooseEvent(card: EventCard) {
        switch (card) {
            case 'battle':
                this.startNextWave('events', true);
                break;
            case 'reward':
                this.claimRouteReward();
                break;
            case 'encounter':
                this.showEncounter();
                break;
        }
    }

    private claimRouteReward() {
        if (hasFutureShop(this.wave + 1)) {
            const { held, blessing } = this.relics;
            this.showReward(this.economy.claimReward(this.wave + 1, held, Math.random, blessing), () => this.startNextWave('reward'));
            return;
        }
        const offers = this.relics.choices(Math.random, LATE_REWARD_CHOICES);
        if (!offers.length) {
            this.showRecovery('获得决战补给', LATE_REWARD_HEAL * 2);
            return;
        }
        const restored = heal(this.vital, this.vital.maxHp * LATE_REWARD_HEAL);
        this.offerRelic(offers, `决战补给 · 已恢复 ${Number(restored.toFixed(1))} 生命，选一件遗物`,
            () => this.startNextWave('relic'));
    }

    private showRecovery(title: string, fraction: number) {
        this.mode = 'rest';
        const wave = this.wave;
        const recovered = heal(this.vital, this.vital.maxHp * fraction);
        this.view.restOverlay(title, recovered, this.vital, () => {
            if (this.wave === wave) this.startNextWave('rest');
        });
    }

    private showReward(reward: EventReward, proceed: () => void) {
        const wave = this.wave;
        this.freeze('reward');
        if (reward.kind === 'relic') this.relics.acquire(reward.id, this.vital);
        this.view.lootOverlay(reward, () => {
            if (this.mode === 'reward' && this.wave === wave) proceed();
        });
    }

    private showEncounter() {
        const context = { wave: this.wave + 1, economy: this.economy, player: this.vital, relics: this.relics };
        const encounter = drawEncounter(context);
        this.encounter = encounter;
        this.mode = 'encounter';
        this.view.encounterOverlay(encounter, context, index => {
            if (this.mode !== 'encounter' || this.encounter !== encounter) return;
            const result = encounter.resolve(index, context);
            if (!result) return;
            this.mode = 'encounter-result';
            this.view.encounterResultOverlay(encounter.event.title, result, context, () => {
                if (this.encounter === encounter) this.startNextWave('encounter-result', false, result.modifiers);
            });
        });
    }

    private showShop() {
        const { economy } = this;
        const { held, blessing } = this.relics;
        const supply = {
            player: this.vital,
            claimed: economy.claimedSupply,
            hasUnownedRelic: unownedRelics(held).length > 0,
            choose: (kind: 'heal' | 'relic') => {
                if (this.mode !== 'shop') return;
                const claimed = economy.claimShopSupply(kind, this.vital, held, Math.random, blessing);
                if (!claimed) return;
                if (claimed.kind === 'relic') this.relics.acquire(claimed.id, this.vital);
                this.showShop();
            },
        };
        this.view.shopOverlay(this.wave + 2, economy.gold, economy.offers, economy.canRefresh(held), supply, index => {
            if (this.mode !== 'shop') return;
            const id = economy.buy(index, held);
            if (!id) return;
            this.relics.acquire(id, this.vital);
            this.showShop();
        }, () => {
            if (this.mode === 'shop' && economy.refresh(held, Math.random, blessing)) this.showShop();
        }, () => {
            this.startNextWave('shop');
        }, this.supplyTip ? '首次到店 · 金币只在本局有效，离开商店即进入下一波' : undefined);
    }

    private startNextWave(from: Mode, challenge = false, modifiers: WaveModifiers = {}) {
        if (this.mode !== from || this.wave + 1 >= WAVES.length) return;
        this.challenge = challenge;
        this.waveModifiers = modifiers;
        this.encounter = undefined;
        this.wave += 1;
        this.resume();
        this.spawnWave();
    }

    private endRun(victory: boolean, finalReward?: EventReward) {
        playCue(victory ? 'victory' : 'defeat');
        this.freeze(victory ? 'victory' : 'defeat');
        this.enemyProjectiles.length = 0;
        const unlockedTrial = victory && !this.testEnemy && this.difficulty === 'normal' && unlockTrial();
        const result: RunResult = {
            victory, time: this.clock, kills: this.kills, gold: this.economy.gold, relics: [...this.relics.held],
            finalReward, testEnemy: this.testEnemy, difficulty: this.difficulty, unlockedTrial,
        };
        this.economy.clear();
        for (const enemy of this.enemies) enemy.statuses.clear();
        this.encounter = undefined;
        this.waveModifiers = {};
        this.scene.start('result', result);
    }

    private statusDebug(at: Point) {
        const { dotDamageBonus, dotDurationBonus, dotMaxStacksBonus } = this.relics.dotModifiers;
        const percent = (fraction: number) => `${Number((100 * fraction).toFixed(1))}%`;
        const stats = `异常命中 +${percent(this.relics.statusHitBonus)}  持续伤害 +${percent(dotDamageBonus)}\n`
            + `持续时间 +${percent(dotDurationBonus)}  额外层数 +${dotMaxStacksBonus}`;
        let enemy: Enemy | undefined;
        let nearest = 72;
        for (const candidate of this.enemies) {
            const separation = distance(at, candidate.sprite);
            if (separation >= nearest) continue;
            nearest = separation;
            enemy = candidate;
        }
        if (!enemy) return stats + '\n指向敌人可查看实际概率、异常抗性和剩余时间';
        const { statuses, kind } = enemy;
        const statusLine = (status: StatusKind, title: string, chance: string) => {
            const layers = statuses.remaining(status, this.clock);
            const remaining = layers.length ? layers.map(seconds => seconds.toFixed(1)).join(' / ') + ' 秒' : '—';
            return `${title}  施加 ${chance}  抗性 ${percent(statuses.resistances[status] ?? 0)}  ${layers.length} 层  ${remaining}`;
        };
        const options = { resistances: statuses.resistances };
        const burning = this.relics.held.has('ember')
            ? percent(this.relics.statusChance('burning', RELICS.ember.chance, options)) : '—';
        const poison = this.relics.held.has('needle')
            ? percent(this.relics.statusChance('poison', RELICS.needle.chance, options)) : '—';
        const slowSources = [
            this.relics.held.has('frostPendant') ? '每 5 次必中' : '',
            this.relics.held.has('winterBud') ? percent(this.relics.statusChance('slow', RELICS.winterBud.chance, options)) : '',
        ].filter(Boolean).join(' + ');
        return [
            stats, ENEMIES[kind].label,
            statusLine('burning', '燃烧', burning),
            statusLine('poison', '中毒', poison),
            statusLine('slow', '减速', slowSources || '—'),
            `寒意 ${statuses.chillStacks(this.clock)}  冻结 ${statuses.freezeRemaining(this.clock).toFixed(2)} 秒`
                + `  保护 ${statuses.protectionRemaining(this.clock).toFixed(2)} 秒`,
        ].join('\n');
    }

    private draw() {
        const { player, view } = this;
        const time = this.clock;
        const ultimate = this.ultimate;
        const perfectReady = this.block.perfectReady(time);
        const { cues } = view;
        const pointer = this.input.activePointer;
        const aimPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        cues.clear();
        for (const projectile of this.enemyProjectiles) view.drawEnemyProjectile(projectile);
        for (const blade of this.blades) view.drawBlade(blade, blade.heading, time);
        for (const echo of this.echoes) {
            view.drawEcho(echo.origin, RELICS.cloak.range, 1 - (echo.due - time) / RELICS.cloak.delay);
        }

        if (!this.mobile && this.mode === 'fighting' && pointer.x >= 0 && pointer.x < VIEW.width
            && pointer.y >= 0 && pointer.y < VIEW.height) {
            cues.lineStyle(1, 0xf0dcb4, 0.65).strokeCircle(aimPoint.x, aimPoint.y, 6);
            cues.fillStyle(0xf0dcb4, 0.8).fillCircle(aimPoint.x, aimPoint.y, 1.5);
        }
        if (this.swing) {
            const phase = swingPhase(this.swing, time);
            const opacity = phase === 'active' ? 0.52 : phase === 'windup' ? 0.15 : 0.08;
            const color = this.swing.poiseMultiplier ? 0x9ffce5
                : this.swing.damageScale > 1 || this.swing.attackBonus ? 0xffb977 : 0xf4deab;
            sector(cues, player, this.swing.heading, swingRange(this.swing), this.swing.angle ?? WARRIOR.attack.angle, color, opacity);
        }
        if (this.block.active) {
            sector(cues, player, this.block.heading, 47, WARRIOR.block.angle, perfectReady ? 0xa9fff0 : 0xb3ddcb,
                perfectReady ? 0.58 : 0.28);
        }
        if (ultimate && !ultimate.released) {
            const spec = WARRIOR.ultimate;
            const progress = (time - ultimate.started) / spec.windup;
            sector(cues, player, ultimate.heading, WARRIOR.attack.range * spec.range, spec.angle, 0xffca82, 0.10 + progress * 0.21);
        }
        if (this.touchUltimateAiming && !ultimate) {
            const spec = WARRIOR.ultimate;
            sector(cues, player, this.aim, WARRIOR.attack.range * spec.range, spec.angle, 0xffca82, 0.23);
        }

        const hitFlash = time < this.vital.flashUntil;
        view.drawWarrior(player, {
            motion: ultimate ? 'ultimate' : this.dodge ? 'dodge' : this.swing ? 'attack'
                : this.block.active ? 'guard' : this.walking ? 'walk' : 'idle',
            time,
            mirrored: this.facing < 0,
            attackTime: ultimate ? time - ultimate.started : this.swing
                ? (time - this.swing.started) * this.swing.speed + (this.swing.skipWindup ? WARRIOR.attack.windup : 0)
                : undefined,
            tint: hitFlash ? 0xec897e : ultimate ? 0xffd48d : perfectReady || this.inDodgeImmunity() ? 0xadd8cc : undefined,
            hitFlash,
        });
        if (hitFlash) {
            cues.lineStyle(2, 0xec897e, 0.75).strokeCircle(player.x, player.y, WARRIOR.radius + 10);
        }
        const showChill = this.relics.held.has('iceCrown');
        for (const enemy of this.enemies) {
            const spec = ENEMIES[enemy.kind];
            if (enemy.archer?.phase === 'aiming') {
                const progress = 1 - (enemy.archer.aimUntil - time) / ENEMIES.archer.windup;
                view.drawEnemyAim(enemy.sprite.body!.center, enemy.archer.heading, ENEMIES.archer.range, progress);
            } else if (isSpecialEnemy(enemy.kind) && enemy.special?.active) {
                const active = enemy.special.active;
                const reach = active.attack.kind === 'charge'
                    ? chargeReach(active.origin, active.heading, active.attack.distance, spec.radius) : 0;
                view.drawSpecialWarning(active, spec.warning, spec.radius, reach, time);
            } else if ((enemy.kind === 'slime' || enemy.kind === 'skeleton')
                && (enemy.state === 'windup' || enemy.state === 'attack')) {
                const melee = ENEMIES[enemy.kind];
                const progress = Math.min(1, (time - enemy.started) / melee.windup);
                sector(cues, enemy.sprite, enemy.heading, melee.range, melee.angle, melee.warning, 0.17 + progress * 0.30);
            }
            if (enemy.statuses.isFrozen(time)) {
                enemy.sprite.clearTint().setTint(0xa8dfff);
                cues.lineStyle(1.5, 0xc5f0ff, 0.72).strokeCircle(enemy.sprite.x, enemy.sprite.y, spec.radius + 6);
            } else if (time < enemy.vital.flashUntil) {
                enemy.sprite.setTint(0xfff5dc).setTintMode(Phaser.TintModes.FILL);
                cues.lineStyle(2, 0xfff5dc, 0.75).strokeCircle(enemy.sprite.x, enemy.sprite.y, spec.radius + 8);
            } else if (enemy.vital.stunUntil) enemy.sprite.clearTint().setTint(0xf2cd9e);
            else enemy.sprite.clearTint();
            view.enemyHealth(enemy, time, showChill);
        }

        const boots = this.relics.bootsRemaining(time);
        const snowFox = this.relics.snowFoxRemaining(time);
        const buffs = [
            this.block.counter === 'perfect' ? '✦  反击斩就绪' : this.block.counter ? '✦  格挡反击' : '',
            boots > 0 ? `⟫  疾风反击 ${boots.toFixed(1)} 秒` : '',
            snowFox > 0 ? `❄  雪狐尾饰 ${snowFox.toFixed(1)} 秒` : '',
            this.relics.berserkActive(this.vital) ? '♢  狂战士' : '',
            this.relics.windupReady ? '≋  跳过前摇' : '',
            this.relics.crownRemaining(time) > 0 ? '♛  荆棘之冠' : '',
            this.relics.finaleRemaining(time) > 0 ? '➤  终焉号角' : '',
            this.waveModifiers.normalAttack ? '✦  本波普攻强化' : '',
            this.waveModifiers.enemyDamage ? '◇  本波敌人强化' : '',
        ].filter(Boolean);
        const rate = this.relics.dodgeRecoveryRate(this.vital);
        const featured = this.bossLabel();
        view.updateHud(this.vital, this.wave + 1, this.enemies.length, this.economy.gold, this.relics.held,
            this.dodgeWork / rate, this.relics.dodgeCooldown / rate, buffs.join('   ·   '), activeShield(this.vital, time),
            featured, this.relics.blessing);
        view.updateResolve(this.resolve.amount, ultimate !== undefined);
        this.mobile?.setStatus(this.dodgeWork, perfectReady, this.resolve.ready && !this.dodge && !ultimate);
        const relics = this.relics;
        const astrolabeFlash = relics.astrolabeFlashing(time);
        const arcane = [
            relics.held.has('moonWatch') ? `星辉 ${relics.moonWatchCharge}/${RELICS.moonWatch.every}` : '',
            relics.held.has('starBottle') ? `${relics.starBottleReady ? '✦ ' : ''}星芒 ${relics.starBottleCharge}/${RELICS.starBottle.every}` : '',
            relics.held.has('dawnAstrolabe') ? `星盘 ${relics.astrolabeCharge}/${RELICS.dawnAstrolabe.every}${astrolabeFlash ? ' ✦' : ''}` : '',
        ].filter(Boolean).join('   ·   ');
        view.updateArcaneCharge(arcane, astrolabeFlash);
        view.updateDebug(this.debug, time, this.mode, this.debug ? this.statusDebug(aimPoint) : '');
        if (this.debug) {
            const graphics = view.debugGraphics;
            graphics.lineStyle(1, 0xd5f6ab, 0.9).strokeCircle(player.x, player.y, WARRIOR.radius);
            graphics.lineStyle(1, 0x9de6dc, 0.8).strokeCircle(player.x, player.y, WARRIOR.attack.range);
            for (const enemy of this.enemies) {
                graphics.lineStyle(1, 0xffa9a0, 0.95).strokeCircle(enemy.sprite.x, enemy.sprite.y, ENEMIES[enemy.kind].radius);
            }
        }
    }
}
