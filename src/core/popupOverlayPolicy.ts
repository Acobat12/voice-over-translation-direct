export function shouldUsePopupOverlayWindow(): boolean {
  const host = globalThis.location.hostname.toLowerCase();
  return host === "drive.google.com" || host === "youtube.googleapis.com";
}
