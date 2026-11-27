export function parsePositiveInteger(
  value: string | null | undefined,
): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseContentLengthFromContentRange(
  contentRange: string | null,
): number | null {
  if (!contentRange) return null;
  return parsePositiveInteger(/\/(\d+)\s*$/i.exec(contentRange)?.[1]);
}
