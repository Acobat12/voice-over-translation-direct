const claims = new Set<string>();
export function noticeCooldownActive(lastShown: number, now: number): boolean {
  return (
    Number.isFinite(lastShown) &&
    lastShown > 0 &&
    now >= lastShown &&
    now - lastShown < 86400000
  );
}
export function claimUpdateNotice(key: string): boolean {
  if (claims.has(key)) return false;
  claims.add(key);
  return true;
}
export function releaseUpdateNotice(key: string): void {
  claims.delete(key);
}

/** Serialize the cooldown read/render/write across same-origin tabs when available. */
export async function withUpdateNoticeLock<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  if (!claimUpdateNotice(key)) return undefined;
  try {
    const locks = globalThis.navigator?.locks;
    if (!locks) return await action();
    let entered = false;
    try {
      return await locks.request(key, { ifAvailable: true }, async (lock) => {
        if (!lock) return undefined;
        entered = true;
        return await action();
      });
    } catch (error) {
      if (entered) throw error;
      return await action();
    }
  } finally {
    releaseUpdateNotice(key);
  }
}
