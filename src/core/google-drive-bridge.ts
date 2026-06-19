export const GOOGLE_DRIVE_BRIDGE_SYNC_EVENT = "vot:google-drive-bridge-sync";

export function dispatchGoogleDriveBridgeSync(): void {
  try {
    globalThis.dispatchEvent(new CustomEvent(GOOGLE_DRIVE_BRIDGE_SYNC_EVENT));
  } catch {
    // Ignore bridge sync failures. DOM observers remain the fallback path.
  }
}
