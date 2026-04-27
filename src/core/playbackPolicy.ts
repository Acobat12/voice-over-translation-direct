export type PlaybackPolicyInput = {
  siteHost?: string;
  videoHost?: string;
  isStream?: boolean;
  hasAudioContext?: boolean;
  newAudioPlayer?: boolean;
  onlyBypassMediaCSP?: boolean;
  needBypassCSP?: boolean;
};

export function isCustomPlaybackTarget(
  siteHost?: string,
  videoHost?: string,
): boolean {
  return siteHost === "custom" || videoHost === "custom";
}

export function shouldUsePlainAudioPlayback(
  input: PlaybackPolicyInput,
): boolean {
  if (isCustomPlaybackTarget(input.siteHost, input.videoHost)) {
    return true;
  }

  if (input.isStream) {
    return true;
  }

  if (!input.hasAudioContext) {
    return true;
  }

  if (!input.newAudioPlayer) {
    return true;
  }

  if (!input.onlyBypassMediaCSP) {
    return false;
  }

  return !input.needBypassCSP;
}
