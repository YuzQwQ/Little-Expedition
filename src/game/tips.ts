const TIPS_KEY = 'little-expedition-tips-v1';

export type TipId = 'guard' | 'ultimate' | 'supply';

export const TIPS: readonly TipId[] = ['guard', 'ultimate', 'supply'];

/** 只保留认识的标记，旧版本留下的垃圾值直接丢掉。 */
export function normalizeTips(value: unknown): TipId[] {
    if (!Array.isArray(value)) return [];
    return TIPS.filter(id => value.includes(id));
}

function read(): TipId[] {
    try {
        return normalizeTips(JSON.parse(globalThis.localStorage.getItem(TIPS_KEY) ?? 'null'));
    } catch {
        // 隐私模式下读不到 storage，当成全部没看过，引导会重复一遍但不至于报错。
        return [];
    }
}

export function pendingTips(): TipId[] {
    const seen = read();
    return TIPS.filter(id => !seen.includes(id));
}

export function markTipSeen(id: TipId) {
    const seen = read();
    if (seen.includes(id)) return;
    seen.push(id);
    try {
        globalThis.localStorage.setItem(TIPS_KEY, JSON.stringify(seen));
    } catch {
        // 写不进去就下次再显示一次，不影响本局。
    }
}
