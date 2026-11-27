/** Compare numeric release versions and SemVer prerelease identifiers. */
function parseVersion(value: string) {
  const match =
    /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value.trim(),
    );
  if (!match) throw new Error(`Invalid release version: ${value}`);
  const core = match[1].split(".").map(Number);
  if (core.some((n) => !Number.isSafeInteger(n)))
    throw new Error("Invalid version number");
  return { core, pre: match[2]?.split(".") };
}
export function isNewerVersion(remote: string, installed: string): boolean {
  const a = parseVersion(remote),
    b = parseVersion(installed);
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const x = a.core[i] ?? 0,
      y = b.core[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (!a.pre || !b.pre) return !a.pre && !!b.pre;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return y === undefined;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y);
    if (xn !== yn) return !xn;
    return x > y;
  }
  return false;
}
