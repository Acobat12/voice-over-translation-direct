import { render } from "lit-html";
import { localizationProvider } from "../../localization/localizationProvider";
import UI from "../../ui";
import { CHECK_ICON, VOICE_WAVE_ICON } from "../icons";

export type VoiceMode = "standard" | "lively";

export function getVoiceModeLabel(mode: VoiceMode): string {
  return mode === "lively"
    ? localizationProvider.get("VOTLivelyVoices")
    : localizationProvider.get("VOTStandardVoices");
}

export function getVoiceModeDescription(mode: VoiceMode): string {
  return mode === "lively"
    ? localizationProvider.get("VOTLivelyVoicesDescription")
    : localizationProvider.get("VOTStandardVoicesDescription");
}

export function createVoiceModeMenuItem(mode: VoiceMode): HTMLElement {
  const item = UI.createEl("vot-block", ["vot-voice-mode-menu-item"]);
  UI.makeButtonLike(item, { ariaLabel: getVoiceModeLabel(mode) });
  item.dataset.mode = mode;

  const icon = UI.createEl("vot-block", ["vot-voice-mode-menu-item-icon"]);
  render(VOICE_WAVE_ICON, icon);

  const content = UI.createEl("vot-block", [
    "vot-voice-mode-menu-item-content",
  ]);
  const title = UI.createEl("vot-block", ["vot-voice-mode-menu-item-title"]);
  title.textContent = getVoiceModeLabel(mode);
  const description = UI.createEl("vot-block", [
    "vot-voice-mode-menu-item-description",
  ]);
  description.textContent = getVoiceModeDescription(mode);
  content.append(title, description);

  const check = UI.createEl("vot-block", ["vot-voice-mode-menu-item-check"]);
  render(CHECK_ICON, check);
  item.append(icon, content, check);
  return item;
}
