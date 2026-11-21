import type { Point } from './combat.ts';
import { screenRotationRadians } from './rotation.ts';

type Pad = 'move' | 'attack' | 'guard' | 'ultimate';
interface Contact { pointer: number; vector: Point; heading?: number }
const ORIGIN: Point = { x: 0, y: 0 };
const DEAD_ZONE = 0.16;

export function stickVector(dx: number, dy: number, radius: number): Point {
    const distance = Math.hypot(dx, dy);
    const fraction = distance / radius;
    if (radius <= 0 || fraction <= DEAD_ZONE) return ORIGIN;
    const strength = Math.min(1, (fraction - DEAD_ZONE) / (1 - DEAD_ZONE));
    return { x: dx / distance * strength, y: dy / distance * strength };
}

export class MobileInput {
    private readonly contacts = new Map<Pad, Contact>();
    private attackTap?: { heading?: number };
    private ultimateRelease?: { heading?: number };

    begin(pad: Pad, pointer: number) {
        if (this.contacts.has(pad) || [...this.contacts.values()].some(contact => contact.pointer === pointer)) return false;
        this.contacts.set(pad, { pointer, vector: ORIGIN });
        if (pad === 'attack') this.attackTap = {};
        return true;
    }

    /** `rotation` is the CSS rotation (radians, clockwise) of the game frame; stick input is folded back into game space. */
    move(pad: Pad, pointer: number, dx: number, dy: number, radius: number, rotation = 0) {
        const contact = this.contacts.get(pad);
        if (contact?.pointer !== pointer) return;
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        contact.vector = stickVector(dx * cos - dy * sin, dx * sin + dy * cos, radius);
        if (contact.vector.x !== 0 || contact.vector.y !== 0) {
            contact.heading = Math.atan2(contact.vector.y, contact.vector.x);
            if (pad === 'attack' && this.attackTap) this.attackTap.heading = contact.heading;
        }
        return contact.vector;
    }

    end(pad: Pad, pointer: number, cancel = false) {
        const contact = this.contacts.get(pad);
        if (contact?.pointer !== pointer) return false;
        this.contacts.delete(pad);
        if (pad === 'ultimate' && !cancel) this.ultimateRelease = { heading: contact.heading };
        if (pad === 'attack' && cancel) this.attackTap = undefined;
        return true;
    }

    frame(heading: number) {
        const movement = this.contacts.get('move')?.vector ?? ORIGIN;
        const ultimate = this.contacts.get('ultimate');
        const guard = this.contacts.get('guard');
        const attack = this.contacts.get('attack') ?? this.attackTap;
        const aim = ultimate ?? guard ?? attack;
        const release = this.ultimateRelease;
        this.attackTap = undefined;
        this.ultimateRelease = undefined;
        const moving = movement.x !== 0 || movement.y !== 0;
        const aimHeading = aim ? aim.heading ?? heading : moving ? Math.atan2(movement.y, movement.x) : heading;
        return {
            movement,
            heading: aimHeading,
            attack: !ultimate && !guard && !!attack,
            guard: !!guard,
            aimingUltimate: !!ultimate,
            castHeading: release ? release.heading ?? heading : undefined,
        };
    }

    reset() {
        this.contacts.clear();
        this.attackTap = undefined;
        this.ultimateRelease = undefined;
    }
}

export class MobileControls {
    readonly input = new MobileInput();
    private readonly element: HTMLDivElement;
    private readonly dodge: HTMLButtonElement;
    private readonly ultimate: HTMLButtonElement;
    private readonly guard: HTMLButtonElement;
    private readonly pads = new Map<Pad, HTMLButtonElement>();
    private ultimateReady = false;

    constructor(parent: HTMLElement, onDodge: () => void, onPause: () => void) {
        this.element = document.createElement('div');
        this.element.className = 'mobile-controls';
        this.element.hidden = true;
        this.addPad(this.element, 'move', '移动');
        this.addPad(this.element, 'attack', '攻击');
        const stack = document.createElement('div');
        stack.className = 'mobile-actions';
        this.ultimate = this.addPad(stack, 'ultimate', '大招');
        this.guard = this.addPad(stack, 'guard', '格挡');
        this.dodge = this.addButton(stack, '闪避', 'mobile-button mobile-dodge', onDodge);
        this.element.append(stack);
        this.addButton(this.element, '暂停', 'mobile-button mobile-pause', onPause);
        parent.append(this.element);
    }

    private addButton(parent: HTMLElement, title: string, className: string, action?: () => void) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = title;
        if (action) button.onpointerdown = event => {
            if (event.button !== 0) return;
            event.preventDefault();
            action();
        };
        parent.append(button);
        return button;
    }

    private addPad(parent: HTMLElement, pad: Pad, title: string) {
        const stick = pad === 'move' || pad === 'attack';
        const button = this.addButton(parent, title, `${stick ? 'mobile-stick' : 'mobile-button'} mobile-${pad}`);
        this.pads.set(pad, button);
        let anchor = ORIGIN;
        let radius = 1;
        const update = (event: PointerEvent) => {
            const dx = event.clientX - anchor.x;
            const dy = event.clientY - anchor.y;
            const vector = this.input.move(pad, event.pointerId, dx, dy, radius, screenRotationRadians());
            if (vector) {
                button.style.setProperty('--stick-x', `${vector.x * radius / 2}px`);
                button.style.setProperty('--stick-y', `${vector.y * radius / 2}px`);
            }
        };
        const end = (event: PointerEvent, cancel: boolean) => {
            if (!cancel) update(event);
            if (this.input.end(pad, event.pointerId, cancel)) this.resetPad(button);
        };
        button.onpointerdown = event => {
            if (event.button !== 0 || (pad === 'ultimate' && !this.ultimateReady) || !this.input.begin(pad, event.pointerId)) return;
            event.preventDefault();
            const rect = button.getBoundingClientRect();
            anchor = stick ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                : { x: event.clientX, y: event.clientY };
            radius = rect.width * 0.38;
            button.setPointerCapture(event.pointerId);
            button.classList.add('held');
            update(event);
        };
        button.onpointermove = update;
        button.onpointerup = event => end(event, false);
        button.onpointercancel = event => end(event, true);
        button.onlostpointercapture = event => end(event, true);
        return button;
    }

    private resetPad(button: HTMLButtonElement) {
        button.classList.remove('held');
        button.style.removeProperty('--stick-x');
        button.style.removeProperty('--stick-y');
    }

    reset() {
        this.input.reset();
        for (const button of this.pads.values()) this.resetPad(button);
    }

    setActive(active: boolean) {
        if (!active) this.reset();
        this.element.hidden = !active;
    }

    setStatus(dodge: number, guardReady: boolean, ultimateReady: boolean) {
        this.ultimateReady = ultimateReady;
        this.ultimate.setAttribute('aria-disabled', String(!ultimateReady));
        this.dodge.setAttribute('aria-disabled', String(dodge > 0));
        this.guard.classList.toggle('ready', guardReady);
    }

    destroy() {
        this.reset();
        this.element.remove();
    }
}
