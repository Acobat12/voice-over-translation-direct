import { render } from "lit-html";
import {
  actualCompatVersion,
  defaultAutoHideDelay,
  defaultAutoVolume,
  defaultDetectService,
  defaultTranslationService,
  m3u8ProxyHost,
  proxyWorkerHost,
  repositoryUrl,
} from "../config/config";
import { createPkceAuthUrl } from "../core/auth";
import { localizationProvider } from "../localization/localizationProvider";
import type { SelectItem } from "../types/components/select";
import type { Position, Status } from "../types/components/votButton";
import type { StorageData } from "../types/storage";
import UI from "../ui";
import type Dialog from "../ui/components/dialog";
import DownloadButton from "../ui/components/downloadButton";
import Label from "../ui/components/label";
import LanguagePairSelect from "../ui/components/languagePairSelect";
import Select from "../ui/components/select";
import Slider from "../ui/components/slider";
import SliderLabel from "../ui/components/sliderLabel";
import VOTMenu from "../ui/components/votMenu";
import VOTRail from "../ui/components/votRail";
import {
  CHECK_ICON,
  SETTINGS_ICON,
  SUBTITLES_ICON,
  VOICE_WAVE_ICON,
} from "../ui/icons";
import { SettingsView } from "../ui/views/settings";
import { updateConfig, votStorage } from "../utils/storage";
import { calculatedResLang } from "../utils/utils";

const GOOGLE_DRIVE_TOP_FRAME_ROOT_ATTR = "data-vot-google-drive-top-frame-root";
const GOOGLE_DRIVE_TOP_FRAME_POPUP_ROOT_ATTR =
  "data-vot-google-drive-top-frame-popup-root";
const GOOGLE_DRIVE_TOP_FRAME_DIALOG_ROOT_ATTR =
  "data-vot-google-drive-top-frame-dialog-root";
const GOOGLE_DRIVE_TOP_FRAME_IFRAME_SELECTOR =
  'iframe[src*="youtube.googleapis.com/embed/"]';
const GOOGLE_DRIVE_BRIDGE_FLAG = "__votGoogleDriveBridge";

type BridgeStatus = "none" | "error" | "success" | "loading" | "disabled";

type BridgeSelectItem = {
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
};

type BridgeQuickMenuState = {
  fromItems: BridgeSelectItem[];
  toItems: BridgeSelectItem[];
  subtitlesItems: BridgeSelectItem[];
  videoVolume: number;
  translationVolume: number;
  translationVolumeMax: number;
  showVideoSlider: boolean;
};

type BridgeStatePayload = {
  status: BridgeStatus | string;
  loading: boolean;
  voiceMode: string;
  voicePlaybackState: string;
  labelText: string;
  pipVisible?: boolean;
  canDownloadTranslation: boolean;
  canDownloadSubtitles: boolean;
  quickMenu: BridgeQuickMenuState | null;
};

type BridgeMessage =
  | {
      [GOOGLE_DRIVE_BRIDGE_FLAG]: true;
      kind: "hello";
    }
  | {
      [GOOGLE_DRIVE_BRIDGE_FLAG]: true;
      kind: "state";
      state: BridgeStatePayload;
    }
  | {
      [GOOGLE_DRIVE_BRIDGE_FLAG]: true;
      kind: "command";
      command:
        | "translate"
        | "request-state"
        | "download-translation"
        | "download-subtitles"
        | "set-from-language"
        | "set-to-language"
        | "set-subtitles"
        | "set-video-volume"
        | "set-translation-volume"
        | "set-sync-volume"
        | "set-show-video-slider"
        | "set-audio-booster"
        | "set-use-lively-voice";
      value?: string | number | boolean;
    };

let installed = false;
let layoutSyncScheduled = false;
let overlayRoot: HTMLElement | null = null;
let popupPortalRoot: HTMLElement | null = null;
let dialogPortalRoot: HTMLElement | null = null;
let button: VOTRail | null = null;
let quickMenu: VOTMenu | null = null;
let voiceModeMenu: VOTMenu | null = null;
let downloadTranslationButton: DownloadButton | null = null;
let downloadSubtitlesButton: HTMLElement | null = null;
let openSettingsButton: HTMLElement | null = null;
let languagePairSelect: LanguagePairSelect<string, string> | null = null;
let subtitlesSelectLabel: Label | null = null;
let subtitlesSelect: Select<string> | null = null;
let videoVolumeSliderLabel: SliderLabel | null = null;
let videoVolumeSlider: Slider | null = null;
let translationVolumeSliderLabel: SliderLabel | null = null;
let translationVolumeSlider: Slider | null = null;
let settingsView: SettingsView | null = null;
let settingsData: Partial<StorageData> | null = null;
let settingsInitPromise: Promise<Partial<StorageData>> | null = null;
let currentState: BridgeStatePayload | null = null;
let observedIframe: HTMLIFrameElement | null = null;
let iframeResizeObserver: ResizeObserver | null = null;
let domObserver: MutationObserver | null = null;
let bridgePollTimer: number | null = null;
let dialogLayerCounter = 10;
const DRIVE_TOP_FRAME_BUTTON_LAYER_Z = "10";
const DRIVE_TOP_FRAME_POPUP_LAYER_Z = "20";
const DRIVE_TOP_FRAME_DIALOG_LAYER_Z = "30";

function debugDriveTopFrame(
  message: string,
  details?: Record<string, unknown>,
): void {
  const debugMessage = details
    ? `${message} ${JSON.stringify(details)}`
    : message;
  console.info(`[VOT][DriveTopFrame] ${debugMessage}`);
  document.documentElement.setAttribute(
    "data-vot-drive-top-frame-debug-last",
    debugMessage,
  );
}

function isGoogleDriveTopFrameContext(): boolean {
  const host = String(globalThis.location.hostname || "").toLowerCase();
  return (
    globalThis.top === globalThis &&
    (host === "drive.google.com" || host === "docs.google.com")
  );
}

function isVisibleIframe(
  iframe: HTMLIFrameElement | null | undefined,
): iframe is HTMLIFrameElement {
  if (!(iframe instanceof HTMLIFrameElement) || !iframe.isConnected) {
    return false;
  }

  const rect = iframe.getBoundingClientRect();
  return rect.width > 120 && rect.height > 80;
}

function getDrivePlayerIframe(): HTMLIFrameElement | null {
  const selectors = [
    `#drive-viewer-video-player-object-0 ${GOOGLE_DRIVE_TOP_FRAME_IFRAME_SELECTOR}`,
    `.rSvt3b ${GOOGLE_DRIVE_TOP_FRAME_IFRAME_SELECTOR}`,
    `.xpiQs ${GOOGLE_DRIVE_TOP_FRAME_IFRAME_SELECTOR}`,
    GOOGLE_DRIVE_TOP_FRAME_IFRAME_SELECTOR,
  ];

  for (const selector of selectors) {
    const matched = Array.from(
      document.querySelectorAll<HTMLIFrameElement>(selector),
    ).find((iframe) => isVisibleIframe(iframe));
    if (matched) {
      return matched;
    }
  }

  return null;
}

function getPlayerRect(): DOMRect | null {
  return getDrivePlayerIframe()?.getBoundingClientRect() ?? null;
}

function getBridgeTargetOrigin(iframe: HTMLIFrameElement): string {
  try {
    return new URL(iframe.src, globalThis.location.href).origin;
  } catch {
    return "*";
  }
}

function postBridgeMessage(message: BridgeMessage): void {
  const iframe = getDrivePlayerIframe();
  if (!iframe?.contentWindow) {
    return;
  }

  iframe.contentWindow.postMessage(message, getBridgeTargetOrigin(iframe));
}

function postBridgeCommand(
  command: Extract<BridgeMessage, { kind: "command" }>["command"],
  extra: Partial<
    Pick<Extract<BridgeMessage, { kind: "command" }>, "value">
  > = {},
): void {
  postBridgeMessage({
    [GOOGLE_DRIVE_BRIDGE_FLAG]: true,
    kind: "command",
    command,
    ...extra,
  });
}

function getDefaultButtonText(): string {
  return localizationProvider.get("VOTRailTranslateAndDub");
}

function getDisableButtonText(): string {
  return localizationProvider.get("VOTRailDisableTranslation");
}

function formatLocalizedTemplate(
  template: string,
  value: string | number,
): string {
  return template.replace("{0}", String(value));
}

function extractLoadingEtaValue(
  rawText: string,
): number | "more-than-hour" | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  if (
    text === localizationProvider.get("translationTakeAboutMinute") ||
    text === "The translation will take about a minute"
  ) {
    return 1;
  }

  if (
    text === localizationProvider.get("translationTakeFewMinutes") ||
    text === "The translation will take a few minutes"
  ) {
    return 5;
  }

  if (
    text === localizationProvider.get("translationTakeMoreThanHour") ||
    text === "The translation will take more than an hour"
  ) {
    return "more-than-hour";
  }

  const translationTakePrefix = localizationProvider.get("translationTake");
  const englishTranslationTakePrefix = "The translation will take";
  if (
    !text.includes(translationTakePrefix) &&
    !text.includes(englishTranslationTakePrefix)
  ) {
    return null;
  }

  const digits = text.match(/(\d+)/);
  if (!digits) {
    return null;
  }

  const value = Number.parseInt(digits[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatCompactEtaValue(eta: number | "more-than-hour" | null): string {
  if (!eta) {
    return "";
  }

  if (eta === "more-than-hour") {
    return localizationProvider.get("VOTRailCompactMoreThanHour");
  }

  if (eta <= 1) {
    return localizationProvider.get("VOTRailCompactMinute");
  }

  return formatLocalizedTemplate(
    localizationProvider.get("VOTRailCompactMinutes"),
    eta,
  );
}

function getEstimatedEtaLabel(rawText: string): string {
  return formatCompactEtaValue(extractLoadingEtaValue(rawText));
}

function getVoiceModeEtaLabel(mode: "standard" | "lively"): string {
  if (normalizeStatus(currentState) !== "loading") {
    return "";
  }

  const baseEta = extractLoadingEtaValue(currentState?.labelText ?? "");
  if (!baseEta) {
    return "";
  }

  // ETA hints should follow the mode the user actually selected in the top-frame
  // UI. Runtime bridge state can briefly lag behind during restarts/retries and
  // invert the extrapolated estimates between standard/lively.
  const activeMode = getConfiguredVoiceMode();

  if (baseEta === "more-than-hour") {
    return formatCompactEtaValue(baseEta);
  }

  const adjustedEta =
    activeMode === mode
      ? baseEta
      : mode === "lively"
        ? Math.max(2, Math.round(baseEta * 8))
        : Math.max(1, Math.round(baseEta / 8));

  return formatCompactEtaValue(adjustedEta);
}

function getLoadingButtonText(state: BridgeStatePayload | null): string {
  const rawText = state?.labelText?.trim() ?? "";
  const eta = getEstimatedEtaLabel(rawText);
  if (!eta) {
    const localizedKnownText = localizeKnownBridgeText(rawText);
    if (localizedKnownText) {
      return localizedKnownText;
    }

    if (isBridgeLoadingLabel(rawText)) {
      return rawText;
    }

    if (
      rawText &&
      rawText !== getDefaultButtonText() &&
      rawText !== getDisableButtonText() &&
      rawText !== getVoiceModeLabel("standard") &&
      rawText !== getVoiceModeLabel("lively")
    ) {
      return rawText;
    }

    return localizationProvider.get("videoBeingTranslated");
  }

  return formatLocalizedTemplate(
    localizationProvider.get("VOTRailTranslatingEta"),
    eta,
  );
}

function localizeBridgeButtonText(
  rawText: string,
  state: BridgeStatePayload | null,
): string {
  const text = rawText.trim();
  if (!text) {
    return normalizeStatus(state) === "success"
      ? getDisableButtonText()
      : getDefaultButtonText();
  }

  if (text === "Translate video") {
    return getDefaultButtonText();
  }

  if (text === "Turn off" || text === "Disable translation") {
    return getDisableButtonText();
  }

  const localizedKnownText = localizeKnownBridgeText(text);
  if (localizedKnownText) {
    return localizedKnownText;
  }

  return text;
}

function normalizeStatus(state: BridgeStatePayload | null): BridgeStatus {
  if (!state) {
    return "none";
  }

  if (state.loading || isBridgeLoadingLabel(state.labelText ?? "")) {
    return "loading";
  }

  switch (state.status) {
    case "none":
    case "error":
    case "success":
    case "loading":
    case "disabled":
      return state.status;
    default:
      return "none";
  }
}

function isBridgeLoadingLabel(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) {
    return false;
  }

  if (
    text.includes(localizationProvider.get("translationTake")) ||
    text.includes("The translation will take")
  ) {
    return true;
  }

  const delayed = localizationProvider.get("TranslationDelayed");
  if (delayed && text.includes(delayed)) {
    return true;
  }

  return [
    localizationProvider.get("videoBeingTranslated"),
    "The video is being translated",
    "Подготавливаем перевод",
    "Preparing translation",
    "Видео передано в обработку",
    "Video sent for processing",
    "Ожидаем перевод видео",
    "Waiting for video translation",
    "Загружаем переведенное аудио",
    "Uploading translated audio",
  ].includes(text);
}

function localizeKnownBridgeText(rawText: string): string | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  switch (text) {
    case "The video is being translated":
      return localizationProvider.get("videoBeingTranslated");
    case "Failed to request video translation":
    case "Yandex couldn't translate video":
      return localizationProvider.get("requestTranslationFailed");
    case "Audio link not received":
      return localizationProvider.get("audioNotReceived");
    case "Failed to download audio":
      return localizationProvider.get("VOTFailedDownloadAudio");
    case "Preparing translation":
      return localizationProvider.get("videoBeingTranslated");
    case "Video sent for processing":
    case "Waiting for video translation":
    case "Uploading translated audio":
      return localizationProvider.get("videoBeingTranslated");
    default:
      return null;
  }
}

function getButtonText(state: BridgeStatePayload | null): string {
  const status = normalizeStatus(state);
  if (status === "loading") {
    return getLoadingButtonText(state);
  }

  if (status === "success") {
    return getVoiceModeLabel(getSelectedVoiceMode(state));
  }

  if (status === "error") {
    return localizeBridgeButtonText(state?.labelText ?? "", state);
  }

  return getDefaultButtonText();
}

function getDriveRailPosition(): Position {
  return settingsData?.buttonPos ?? "default";
}

function getConfiguredVoiceMode(): "standard" | "lively" {
  return settingsData?.useLivelyVoice ? "lively" : "standard";
}

function getSelectedVoiceMode(
  state: BridgeStatePayload | null,
): "standard" | "lively" {
  const configuredMode = getConfiguredVoiceMode();
  const status = normalizeStatus(state);
  if (
    status === "success" &&
    (state?.voiceMode === "lively" || state?.voiceMode === "standard")
  ) {
    return state.voiceMode;
  }

  return configuredMode;
}

function getDisplayedVoiceMode(
  state: BridgeStatePayload | null,
): "standard" | "lively" {
  const status = normalizeStatus(state);
  const playbackState = state?.voicePlaybackState || "idle";
  const isActive =
    status === "success" ||
    status === "loading" ||
    playbackState === "loading" ||
    playbackState === "playing" ||
    playbackState === "paused";

  if (
    isActive &&
    (state?.voiceMode === "lively" || state?.voiceMode === "standard")
  ) {
    return state.voiceMode;
  }

  return "standard";
}

function getVoiceModeLabel(mode: "standard" | "lively"): string {
  return mode === "lively"
    ? localizationProvider.get("VOTLivelyVoices")
    : localizationProvider.get("VOTStandardVoices");
}

function getVoiceModeDescription(mode: "standard" | "lively"): string {
  return mode === "lively"
    ? localizationProvider.get("VOTLivelyVoicesDescription")
    : localizationProvider.get("VOTStandardVoicesDescription");
}

function getVoiceModeMenuTitle(): string {
  return localizationProvider.get("VOTVoiceModeMenuTitle");
}

function createVoiceModeMenuItem(mode: "standard" | "lively"): HTMLElement {
  const item = UI.createEl("vot-block", ["vot-voice-mode-menu-item"]);
  UI.makeButtonLike(item, {
    ariaLabel: getVoiceModeLabel(mode),
  });
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

function cleanupLegacyTopFrameUi(): void {
  const selectors = [
    `[${GOOGLE_DRIVE_TOP_FRAME_ROOT_ATTR}="1"]`,
    ".vot-google-drive-top-frame-menu",
    ".vot-voice-mode-menu",
    ".vot-voice-mode-menu",
    ".vot-dialog-container",
  ];

  for (const selector of selectors) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      node.remove();
    }
  }

  settingsView = null;
  settingsData = null;
  settingsInitPromise = null;
  voiceModeMenu = null;
}

function createPortalRoot(attrName: string, zIndex: string): HTMLElement {
  const root = document.createElement("vot-block");
  root.setAttribute(attrName, "1");
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.pointerEvents = "none";
  root.style.zIndex = zIndex;
  root.style.margin = "0";
  root.style.padding = "0";
  root.style.border = "0";
  root.style.overflow = "visible";
  root.style.visibility = "visible";
  root.style.transform = "none";
  root.style.filter = "none";
  root.style.perspective = "none";
  return root;
}

function ensureOverlayRoot(): HTMLElement {
  if (overlayRoot?.isConnected) {
    return overlayRoot;
  }

  overlayRoot = document.createElement("vot-block");
  overlayRoot.setAttribute(GOOGLE_DRIVE_TOP_FRAME_ROOT_ATTR, "1");
  overlayRoot.style.position = "fixed";
  overlayRoot.style.inset = "0";
  overlayRoot.style.margin = "0";
  overlayRoot.style.padding = "0";
  overlayRoot.style.border = "0";
  overlayRoot.style.background = "transparent";
  overlayRoot.style.overflow = "visible";
  overlayRoot.style.pointerEvents = "none";
  overlayRoot.style.zIndex = "2147483647";
  overlayRoot.style.isolation = "isolate";
  overlayRoot.style.visibility = "visible";
  overlayRoot.style.transform = "none";
  overlayRoot.style.filter = "none";
  overlayRoot.style.perspective = "none";

  popupPortalRoot = createPortalRoot(
    GOOGLE_DRIVE_TOP_FRAME_POPUP_ROOT_ATTR,
    DRIVE_TOP_FRAME_POPUP_LAYER_Z,
  );
  dialogPortalRoot = createPortalRoot(
    GOOGLE_DRIVE_TOP_FRAME_DIALOG_ROOT_ATTR,
    DRIVE_TOP_FRAME_DIALOG_LAYER_Z,
  );

  overlayRoot.append(popupPortalRoot, dialogPortalRoot);
  (document.body ?? document.documentElement).appendChild(overlayRoot);
  return overlayRoot;
}

function ensurePopupPortalRoot(): HTMLElement {
  ensureOverlayRoot();
  if (!popupPortalRoot) {
    popupPortalRoot = createPortalRoot(
      GOOGLE_DRIVE_TOP_FRAME_POPUP_ROOT_ATTR,
      DRIVE_TOP_FRAME_POPUP_LAYER_Z,
    );
    overlayRoot?.appendChild(popupPortalRoot);
  }
  return popupPortalRoot;
}

function ensureDialogPortalRoot(): HTMLElement {
  ensureOverlayRoot();
  if (!dialogPortalRoot) {
    dialogPortalRoot = createPortalRoot(
      GOOGLE_DRIVE_TOP_FRAME_DIALOG_ROOT_ATTR,
      DRIVE_TOP_FRAME_DIALOG_LAYER_Z,
    );
    overlayRoot?.appendChild(dialogPortalRoot);
  }
  return dialogPortalRoot;
}

function claimNextDialogLayer(minimum = 10): string {
  dialogLayerCounter = Math.max(dialogLayerCounter + 1, minimum);
  return String(dialogLayerCounter);
}

function createPlaceholderQuickMenuState(): BridgeQuickMenuState {
  return {
    fromItems: [
      {
        label: localizationProvider.get("videoLanguage"),
        value: "auto",
        selected: true,
        disabled: false,
      },
    ],
    toItems: [
      {
        label: localizationProvider.get("translationLanguage"),
        value: "ru",
        selected: true,
        disabled: false,
      },
    ],
    subtitlesItems: [
      {
        label: localizationProvider.get("VOTSubtitlesDisabled"),
        value: "disabled",
        selected: true,
        disabled: false,
      },
    ],
    videoVolume: 100,
    translationVolume: 100,
    translationVolumeMax: 100,
    showVideoSlider: true,
  };
}

function getQuickMenuState(): BridgeQuickMenuState {
  return currentState?.quickMenu ?? createPlaceholderQuickMenuState();
}

async function ensureSettingsData(): Promise<Partial<StorageData>> {
  if (settingsData) {
    return settingsData;
  }

  if (settingsInitPromise) {
    return settingsInitPromise;
  }

  settingsInitPromise = (async () => {
    let data = await votStorage.getValues({
      autoTranslate: false,
      autoSubtitles: false,
      dontTranslateLanguages: [calculatedResLang],
      enabledDontTranslateLanguages: true,
      enabledAutoVolume: true,
      enabledSmartDucking: true,
      autoVolume: defaultAutoVolume,
      buttonPos: "default",
      showVideoSlider: true,
      syncVolume: false,
      downloadWithName: true,
      sendNotifyOnComplete: false,
      subtitlesMaxLength: 300,
      subtitlesSmartLayout: true,
      highlightWords: true,
      subtitlesFontSize: 20,
      subtitlesFontFamily: "default-sans",
      subtitlesOpacity: 20,
      subtitlesDownloadFormat: "srt",
      responseLanguage: calculatedResLang,
      defaultVolume: 100,
      onlyBypassMediaCSP: true,
      newAudioPlayer: true,
      showPiPButton: false,
      translateAPIErrors: true,
      translationService: defaultTranslationService,
      detectService: defaultDetectService,
      translationHotkey: null,
      subtitlesHotkey: null,
      m3u8ProxyHost,
      proxyWorkerHost,
      translateProxyEnabled: 0,
      translateProxyEnabledDefault: true,
      audioBooster: false,
      useLivelyVoice: false,
      autoHideButtonDelay: defaultAutoHideDelay,
      useAudioDownload: true,
      compatVersion: "",
      account: {},
      localeHash: "",
      localeUpdatedAt: 0,
    });

    if (data.compatVersion !== actualCompatVersion) {
      data = await updateConfig(data);
      await votStorage.set("compatVersion", actualCompatVersion);
    }

    settingsData = data;
    settingsInitPromise = null;
    return data;
  })().catch((error) => {
    settingsInitPromise = null;
    throw error;
  });

  return settingsInitPromise;
}

function mapBridgeItemsToSelectItems(
  items: BridgeSelectItem[],
): SelectItem<string>[] {
  return items.map((item) => ({
    label: item.label,
    value: item.value,
    selected: item.selected,
    disabled: item.disabled,
  }));
}

function getSelectedValue(items: BridgeSelectItem[], fallback: string): string {
  return items.find((item) => item.selected)?.value ?? fallback;
}

function prepareDialogForTopFrame(dialog: Dialog): void {
  const dialogRoot = ensureDialogPortalRoot();
  if (dialog.container.parentElement !== dialogRoot) {
    dialogRoot.appendChild(dialog.container);
  }

  dialog.container.style.position = "fixed";
  dialog.container.style.inset = "0";
  dialog.container.style.pointerEvents = "auto";
  dialog.container.style.zIndex = claimNextDialogLayer();
  dialog.container.style.overflow = "visible";
  dialog.container.style.transform = "none";
  dialog.container.style.filter = "none";
  dialog.container.style.perspective = "none";
  dialogRoot.style.pointerEvents = "auto";

  dialog.backdrop.style.pointerEvents = "auto";
  dialog.backdrop.style.background = "transparent";

  dialog.box.style.pointerEvents = "auto";
  dialog.box.style.maxHeight = "calc(100vh - 48px)";
  dialog.box.style.overflow = "visible";

  dialog.contentWrapper.style.maxHeight = "calc(100vh - 80px)";
  dialog.contentWrapper.style.overflowY = "auto";
  dialog.contentWrapper.style.overflowX = "visible";

  dialog.addEventListener("close", () => {
    if (
      !dialogRoot.querySelector(
        '.vot-dialog-container[aria-hidden="false"]:not([hidden])',
      )
    ) {
      dialogRoot.style.pointerEvents = "none";
    }
  });
}

function bindSettingsViewEvents(view: SettingsView): void {
  view
    .addEventListener("select:menuLanguage", async () => {
      globalThis.location.reload();
    })
    .addEventListener("click:resetSettings", async () => {
      const valuesForClear = await votStorage.list();
      await Promise.all(valuesForClear.map((key) => votStorage.delete(key)));
      await votStorage.set("compatVersion", actualCompatVersion);
      globalThis.location.reload();
    })
    .addEventListener("click:bugReport", () => {
      globalThis.open(`${repositoryUrl}/issues/new`, "_blank")?.focus();
    })
    .addEventListener("update:account", () => {
      syncBridge();
    })
    .addEventListener("change:useLivelyVoice", (checked) => {
      postBridgeCommand("set-use-lively-voice", { value: checked });
      syncBridge();
    })
    .addEventListener("change:autoTranslate", () => {
      syncBridge();
    })
    .addEventListener("change:autoSubtitles", () => {
      syncBridge();
    })
    .addEventListener("select:buttonPosition", (position) => {
      if (settingsData) {
        settingsData.buttonPos = position;
      }
      scheduleLayoutSync();
    })
    .addEventListener("change:syncVolume", (checked) => {
      postBridgeCommand("set-sync-volume", { value: checked });
      syncBridge();
    })
    .addEventListener("change:showVideoVolume", (checked) => {
      postBridgeCommand("set-show-video-slider", { value: checked });
      syncBridge();
    })
    .addEventListener("change:audioBooster", (checked) => {
      postBridgeCommand("set-audio-booster", { value: checked });
      syncBridge();
    });
}

async function ensureSettingsView(): Promise<SettingsView> {
  if (settingsView?.isInitialized()) {
    return settingsView;
  }

  const data = await ensureSettingsData();
  const dialogRoot = ensureDialogPortalRoot();

  settingsView = new SettingsView({
    globalPortal: dialogRoot,
    data,
  });
  settingsView.initUI();
  settingsView.initUIEvents();
  bindSettingsViewEvents(settingsView);

  const settingsSelects = [
    settingsView.dontTranslateLanguagesSelect,
    settingsView.subtitlesDownloadFormatSelect,
    settingsView.subtitlesFontFamilySelect,
    settingsView.proxyTranslationStatusSelect,
    settingsView.translationTextServiceSelect,
    settingsView.detectServiceSelect,
    settingsView.buttonPositionSelect,
    settingsView.menuLanguageSelect,
  ].filter((select): select is Select<any, any> => Boolean(select));

  for (const select of settingsSelects) {
    select.addEventListener("beforeOpen", (dialog) => {
      prepareDialogForTopFrame(dialog);
    });
  }

  if (settingsView.dialog) {
    prepareDialogForTopFrame(settingsView.dialog);
    settingsView.dialog.container.style.zIndex = claimNextDialogLayer(10);
  }

  return settingsView;
}

function ensureButton(): VOTRail {
  const root = ensureOverlayRoot();
  if (button) {
    if (button.container.parentElement !== root) {
      root.appendChild(button.container);
    }
    return button;
  }

  button = new VOTRail({
    position: getDriveRailPosition(),
    status: "none",
    labelHtml: getDefaultButtonText(),
  });

  button.container.style.position = "fixed";
  button.container.style.pointerEvents = "auto";
  button.container.style.zIndex = DRIVE_TOP_FRAME_BUTTON_LAYER_Z;
  button.container.style.userSelect = "none";
  button.hidden = false;
  button.opacity = 1;
  button.showPiPButton(true);
  button.showSubtitlesButton(true);
  button.setButtonLabels({
    subtitles: localizationProvider.get("VOTSubtitles"),
    pip: "Picture in picture",
    menu: localizationProvider.get("VOTSettings"),
  });
  button.menuButton.hidden = false;
  button.menuButton.setAttribute("aria-haspopup", "dialog");
  button.menuButton.setAttribute("aria-expanded", "false");
  button.translateButton.removeAttribute("aria-haspopup");
  button.translateButton.removeAttribute("aria-expanded");

  root.appendChild(button.container);
  debugDriveTopFrame("Drive top-frame controller mounted");

  const handleTranslate = (event?: Event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const status = normalizeStatus(currentState);
    if (status === "success") {
      postBridgeMessage({
        [GOOGLE_DRIVE_BRIDGE_FLAG]: true,
        kind: "hello",
      });
      postBridgeCommand("translate");
      debugDriveTopFrame("Drive translate button activated");
      return;
    }

    if (status === "loading") {
      return;
    }

    setQuickMenuOpen(false);
    setVoiceModeMenuOpen(voiceModeMenu?.hidden ?? true);
  };

  button.translateButton.addEventListener("click", handleTranslate);
  button.translateButton.addEventListener("keydown", (event) => {
    if (
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === " ")
    ) {
      handleTranslate(event);
    }
  });

  const handleVoiceModeToggle = (event?: Event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setQuickMenuOpen(false);
    setVoiceModeMenuOpen(voiceModeMenu?.hidden ?? true);
  };

  button.translateChevron.addEventListener("click", handleVoiceModeToggle);
  button.translateChevron.addEventListener("keydown", (event) => {
    if (
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === " ")
    ) {
      handleVoiceModeToggle(event);
    }
  });

  button.menuButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setQuickMenuOpen(quickMenu?.hidden ?? true);
  });

  const handleOpenSubtitles = (event?: Event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    ensureQuickMenu();
    postBridgeCommand("request-state");
    queueMicrotask(() => subtitlesSelect?.outer.click());
  };

  button.subtitlesButton.addEventListener("click", handleOpenSubtitles);
  button.subtitlesButton.addEventListener("keydown", (event) => {
    if (
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === " ")
    ) {
      handleOpenSubtitles(event);
    }
  });

  const handleOpenPiP = (event?: Event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    postBridgeCommand("pip");
  };

  button.pipButton.addEventListener("click", handleOpenPiP);
  button.pipButton.addEventListener("keydown", (event) => {
    if (
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === " ")
    ) {
      handleOpenPiP(event);
    }
  });

  button.menuButton.addEventListener("keydown", (event) => {
    if (
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      setQuickMenuOpen(quickMenu?.hidden ?? true);
    }
  });

  return button;
}

function ensureQuickMenu(): VOTMenu {
  if (quickMenu) {
    if (quickMenu.container.parentElement !== ensurePopupPortalRoot()) {
      ensurePopupPortalRoot().appendChild(quickMenu.container);
    }
    return quickMenu;
  }

  const popupRoot = ensurePopupPortalRoot();
  const dialogRoot = ensureDialogPortalRoot();

  quickMenu = new VOTMenu({
    titleHtml: localizationProvider.get("VOTSettings"),
    position: "default",
  });
  quickMenu.container.classList.add("vot-google-drive-top-frame-menu");
  quickMenu.container.style.position = "fixed";
  quickMenu.container.style.left = "0";
  quickMenu.container.style.top = "0";
  quickMenu.container.style.zIndex = DRIVE_TOP_FRAME_POPUP_LAYER_Z;
  quickMenu.container.style.pointerEvents = "auto";
  quickMenu.container.style.width = "min(420px, calc(100vw - 24px))";
  quickMenu.container.style.maxHeight = "calc(100vh - 24px)";
  quickMenu.container.style.overflow = "visible";
  quickMenu.contentWrapper.style.maxHeight = "calc(100vh - 80px)";
  quickMenu.contentWrapper.style.overflowY = "auto";
  quickMenu.contentWrapper.style.overflowX = "visible";
  quickMenu.hidden = true;

  for (const eventName of ["click", "pointerdown", "mousedown"] as const) {
    quickMenu.container.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  }

  quickMenu.container.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setQuickMenuOpen(false);
    queueMicrotask(() => button?.menuButton.focus?.());
  });

  downloadTranslationButton = new DownloadButton();
  downloadTranslationButton.hidden = true;
  downloadTranslationButton.addEventListener("click", () => {
    postBridgeCommand("download-translation");
  });

  downloadSubtitlesButton = UI.createIconButton(SUBTITLES_ICON, {
    ariaLabel: "Download subtitles",
  });
  downloadSubtitlesButton.hidden = true;
  downloadSubtitlesButton.addEventListener("click", () => {
    postBridgeCommand("download-subtitles");
  });

  openSettingsButton = UI.createIconButton(SETTINGS_ICON, {
    ariaLabel: localizationProvider.get("VOTSettings"),
  });
  openSettingsButton.addEventListener("click", async () => {
    setQuickMenuOpen(false);
    const view = await ensureSettingsView();
    view.open();
  });

  quickMenu.headerContainer.append(
    downloadTranslationButton.button,
    downloadSubtitlesButton,
    openSettingsButton,
  );

  const state = getQuickMenuState();

  languagePairSelect = new LanguagePairSelect({
    from: {
      selectTitle: localizationProvider.get("videoLanguage"),
      dialogTitle: localizationProvider.get("videoLanguage"),
      items: mapBridgeItemsToSelectItems(state.fromItems),
    },
    to: {
      selectTitle: localizationProvider.get("translationLanguage"),
      dialogTitle: localizationProvider.get("translationLanguage"),
      items: mapBridgeItemsToSelectItems(state.toItems),
    },
    dialogParent: dialogRoot,
  });

  languagePairSelect.fromSelect.addEventListener("beforeOpen", (dialog) => {
    prepareDialogForTopFrame(dialog);
  });
  languagePairSelect.toSelect.addEventListener("beforeOpen", (dialog) => {
    prepareDialogForTopFrame(dialog);
  });
  languagePairSelect.fromSelect.addEventListener("selectItem", (value) => {
    debugDriveTopFrame("Drive picker option pointerdown", {
      type: "fromLanguage",
      value,
    });
    postBridgeCommand("set-from-language", { value });
  });
  languagePairSelect.toSelect.addEventListener("selectItem", (value) => {
    debugDriveTopFrame("Drive picker option pointerdown", {
      type: "toLanguage",
      value,
    });
    postBridgeCommand("set-to-language", { value });
  });

  subtitlesSelectLabel = new Label({
    labelText: localizationProvider.get("VOTSubtitles"),
  });
  subtitlesSelect = new Select({
    selectTitle: localizationProvider.get("VOTSubtitlesDisabled"),
    dialogTitle: localizationProvider.get("VOTSubtitles"),
    labelElement: subtitlesSelectLabel.container,
    dialogParent: dialogRoot,
    items: mapBridgeItemsToSelectItems(state.subtitlesItems),
  });
  subtitlesSelect.addEventListener("beforeOpen", (dialog) => {
    prepareDialogForTopFrame(dialog);
  });
  subtitlesSelect.addEventListener("selectItem", (value) => {
    debugDriveTopFrame("Drive picker option pointerdown", {
      type: "subtitles",
      value,
    });
    postBridgeCommand("set-subtitles", { value });
  });

  videoVolumeSliderLabel = new SliderLabel({
    labelText: localizationProvider.get("VOTVolume"),
    value: state.videoVolume,
  });
  videoVolumeSlider = new Slider({
    labelHtml: videoVolumeSliderLabel.container,
    value: state.videoVolume,
  });
  videoVolumeSlider.hidden = !state.showVideoSlider;
  videoVolumeSlider.addEventListener("input", (value, fromSetter) => {
    videoVolumeSliderLabel!.value = value;
    if (!fromSetter) {
      postBridgeCommand("set-video-volume", { value });
    }
  });

  translationVolumeSliderLabel = new SliderLabel({
    labelText: localizationProvider.get("VOTVolumeTranslation"),
    value: state.translationVolume,
  });
  translationVolumeSlider = new Slider({
    labelHtml: translationVolumeSliderLabel.container,
    value: state.translationVolume,
    max: state.translationVolumeMax,
  });
  translationVolumeSlider.addEventListener("input", (value, fromSetter) => {
    translationVolumeSliderLabel!.value = value;
    if (!fromSetter) {
      postBridgeCommand("set-translation-volume", { value });
    }
  });

  quickMenu.bodyContainer.style.display = "flex";
  quickMenu.bodyContainer.style.flexDirection = "column";
  quickMenu.bodyContainer.style.gap = "16px";
  quickMenu.bodyContainer.append(
    languagePairSelect.container,
    subtitlesSelect.container,
    videoVolumeSlider.container,
    translationVolumeSlider.container,
  );

  popupRoot.appendChild(quickMenu.container);
  ensureButton().menuButton.setAttribute(
    "aria-controls",
    quickMenu.container.id,
  );
  return quickMenu;
}

function ensureVoiceModeMenu(): VOTMenu {
  if (voiceModeMenu) {
    if (voiceModeMenu.container.parentElement !== ensurePopupPortalRoot()) {
      ensurePopupPortalRoot().appendChild(voiceModeMenu.container);
    }
    return voiceModeMenu;
  }

  const popupRoot = ensurePopupPortalRoot();
  voiceModeMenu = new VOTMenu({
    titleHtml: getVoiceModeMenuTitle(),
    position: "default",
  });
  voiceModeMenu.container.classList.add("vot-voice-mode-menu");
  voiceModeMenu.container.style.position = "fixed";
  voiceModeMenu.container.style.left = "0";
  voiceModeMenu.container.style.top = "0";
  voiceModeMenu.container.style.zIndex = DRIVE_TOP_FRAME_POPUP_LAYER_Z;
  voiceModeMenu.container.style.pointerEvents = "auto";
  voiceModeMenu.container.style.width = "min(360px, calc(100vw - 24px))";
  voiceModeMenu.container.style.maxHeight = "calc(100vh - 24px)";
  voiceModeMenu.container.style.overflow = "visible";
  voiceModeMenu.contentWrapper.style.maxHeight = "calc(100vh - 80px)";
  voiceModeMenu.contentWrapper.style.overflowY = "auto";
  voiceModeMenu.contentWrapper.style.overflowX = "visible";
  voiceModeMenu.hidden = true;

  for (const eventName of ["click", "pointerdown", "mousedown"] as const) {
    voiceModeMenu.container.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  }

  voiceModeMenu.container.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setVoiceModeMenuOpen(false);
    queueMicrotask(() => button?.translateButton.focus?.());
  });

  const standardItem = createVoiceModeMenuItem("standard");
  const livelyItem = createVoiceModeMenuItem("lively");

  const handleSelectMode = async (mode: "standard" | "lively") => {
    const livelyEnabled = mode === "lively";
    const nextSettingsData = await ensureSettingsData();
    const previousConfiguredMode = getConfiguredVoiceMode();
    const previousActiveMode =
      currentState?.voiceMode === "lively" ||
      currentState?.voiceMode === "standard"
        ? currentState.voiceMode
        : previousConfiguredMode;

    if (livelyEnabled && !nextSettingsData.account?.token) {
      const view = await ensureSettingsView();
      const authUrl = await createPkceAuthUrl();
      globalThis
        .open(
          authUrl,
          "yandex-oauth",
          "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes",
        )
        ?.focus();
      view.open();
      setVoiceModeMenuOpen(false);
      return;
    }

    const previousStatus = normalizeStatus(currentState);
    nextSettingsData.useLivelyVoice = livelyEnabled;
    await votStorage.set("useLivelyVoice", livelyEnabled);

    const checkbox = settingsView?.useLivelyVoiceCheckbox;
    if (checkbox) {
      if (checkbox.checked !== livelyEnabled) {
        checkbox.checked = livelyEnabled;
      }
    }

    if (previousConfiguredMode !== mode || previousActiveMode !== mode) {
      postBridgeCommand("set-use-lively-voice", {
        value: livelyEnabled,
      });
    }

    currentState = {
      ...(currentState ?? {
        status: "none",
        loading: false,
        voicePlaybackState: "idle",
        labelText: "",
        canDownloadTranslation: false,
        canDownloadSubtitles: false,
        quickMenu: null,
      }),
      voiceMode: mode,
    };
    applyBridgeState(currentState);
    setVoiceModeMenuOpen(false);

    if (previousStatus !== "success" && previousStatus !== "loading") {
      postBridgeCommand("translate");
    }
  };

  const bindVoiceModeItem = (
    item: HTMLElement,
    mode: "standard" | "lively",
  ) => {
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleSelectMode(mode);
    });
    item.addEventListener("click", (event) => {
      if (!(event instanceof MouseEvent) || event.detail !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleSelectMode(mode);
    });
  };

  bindVoiceModeItem(standardItem, "standard");
  bindVoiceModeItem(livelyItem, "lively");

  voiceModeMenu.bodyContainer.style.display = "flex";
  voiceModeMenu.bodyContainer.style.flexDirection = "column";
  voiceModeMenu.bodyContainer.style.gap = "0";
  voiceModeMenu.bodyContainer.append(standardItem, livelyItem);

  popupRoot.appendChild(voiceModeMenu.container);
  ensureButton().translateChevron.setAttribute(
    "aria-controls",
    voiceModeMenu.container.id,
  );
  return voiceModeMenu;
}

function positionQuickMenu(): void {
  if (!quickMenu || !button) {
    return;
  }

  const anchorRect = button.menuButton.getBoundingClientRect();
  const groupRect = button.container.getBoundingClientRect();
  const playerRect = getPlayerRect();
  const menuWidth = quickMenu.container.offsetWidth || 420;
  const menuHeight = quickMenu.container.offsetHeight || 520;
  const isVertical = button.position === "left" || button.position === "right";
  const boundsLeft = Math.max(12, (playerRect?.left ?? 0) + 12);
  const boundsTop = Math.max(12, (playerRect?.top ?? 0) + 12);
  const boundsRight = Math.min(
    globalThis.innerWidth - 12,
    (playerRect?.right ?? globalThis.innerWidth) - 12,
  );
  const boundsBottom = Math.min(
    globalThis.innerHeight - 12,
    (playerRect?.bottom ?? globalThis.innerHeight) - 12,
  );
  const desiredLeft = isVertical
    ? button.position === "right"
      ? anchorRect.left - menuWidth - 12
      : anchorRect.right + 12
    : anchorRect.right - menuWidth;
  const left = Math.max(
    boundsLeft,
    Math.min(Math.max(boundsLeft, boundsRight - menuWidth), desiredLeft),
  );
  const desiredTop = isVertical ? anchorRect.top : groupRect.bottom + 12;
  const fallbackTop = isVertical
    ? Math.max(boundsTop, boundsBottom - menuHeight)
    : groupRect.top - menuHeight - 12;
  const top = Math.max(
    boundsTop,
    Math.min(
      Math.max(boundsTop, boundsBottom - menuHeight),
      desiredTop + menuHeight <= boundsBottom
        ? desiredTop
        : Math.max(boundsTop, fallbackTop),
    ),
  );

  quickMenu.container.style.left = `${left}px`;
  quickMenu.container.style.top = `${top}px`;
}

function positionVoiceModeMenu(): void {
  if (!voiceModeMenu || !button) {
    return;
  }

  const anchorRect = button.translateGroup.getBoundingClientRect();
  const playerRect = getPlayerRect();
  const menuWidth = voiceModeMenu.container.offsetWidth || 360;
  const menuHeight = voiceModeMenu.container.offsetHeight || 240;
  const isVertical = button.position === "left" || button.position === "right";
  const boundsLeft = Math.max(12, (playerRect?.left ?? 0) + 12);
  const boundsTop = Math.max(12, (playerRect?.top ?? 0) + 12);
  const boundsRight = Math.min(
    globalThis.innerWidth - 12,
    (playerRect?.right ?? globalThis.innerWidth) - 12,
  );
  const boundsBottom = Math.min(
    globalThis.innerHeight - 12,
    (playerRect?.bottom ?? globalThis.innerHeight) - 12,
  );
  const desiredLeft = isVertical
    ? button.position === "right"
      ? anchorRect.left - menuWidth - 12
      : anchorRect.right + 12
    : anchorRect.left;
  const left = Math.max(
    boundsLeft,
    Math.min(Math.max(boundsLeft, boundsRight - menuWidth), desiredLeft),
  );
  const desiredTop = isVertical ? anchorRect.top : anchorRect.bottom + 12;
  const fallbackTop = anchorRect.top - menuHeight - 12;
  const top = Math.max(
    boundsTop,
    Math.min(
      Math.max(boundsTop, boundsBottom - menuHeight),
      desiredTop + menuHeight <= boundsBottom
        ? desiredTop
        : Math.max(boundsTop, fallbackTop),
    ),
  );

  voiceModeMenu.container.style.left = `${left}px`;
  voiceModeMenu.container.style.top = `${top}px`;
}

function setQuickMenuOpen(open: boolean): void {
  const menu = ensureQuickMenu();
  const currentButton = ensureButton();

  if (open) {
    if (voiceModeMenu && !voiceModeMenu.hidden) {
      voiceModeMenu.hidden = true;
      currentButton.translateChevron.setAttribute("aria-expanded", "false");
    }
    menu.hidden = false;
    currentButton.menuButton.setAttribute("aria-expanded", "true");
    debugDriveTopFrame("Drive picker opened", { type: "quickMenu" });
    positionQuickMenu();
    postBridgeCommand("request-state");
    return;
  }

  menu.hidden = true;
  currentButton.menuButton.setAttribute("aria-expanded", "false");
}

function syncVoiceModeMenuState(): void {
  if (!voiceModeMenu) {
    return;
  }

  const status = normalizeStatus(currentState);
  const selectedMode = getSelectedVoiceMode(currentState);
  const selectedPlaybackState =
    status === "success" ? currentState?.voicePlaybackState || "idle" : "idle";
  for (const item of voiceModeMenu.bodyContainer.querySelectorAll<HTMLElement>(
    ".vot-voice-mode-menu-item",
  )) {
    const mode = item.dataset.mode === "lively" ? "lively" : "standard";
    const isSelected = item.dataset.mode === selectedMode;
    const title = item.querySelector<HTMLElement>(
      ".vot-voice-mode-menu-item-title",
    );
    const etaLabel = getVoiceModeEtaLabel(mode);
    item.dataset.selected = String(isSelected);
    item.setAttribute("aria-pressed", String(isSelected));
    item.dataset.playbackState = isSelected ? selectedPlaybackState : "idle";
    item.dataset.loading = String(isSelected && status === "loading");
    if (title) {
      title.textContent = etaLabel
        ? `${getVoiceModeLabel(mode)} ${etaLabel}`
        : getVoiceModeLabel(mode);
    }
  }
}

function setVoiceModeMenuOpen(open: boolean): void {
  const menu = ensureVoiceModeMenu();
  const currentButton = ensureButton();

  if (open) {
    setQuickMenuOpen(false);
    syncVoiceModeMenuState();
    menu.hidden = false;
    currentButton.translateChevron.setAttribute("aria-expanded", "true");
    debugDriveTopFrame("Drive picker opened", { type: "voiceMode" });
    positionVoiceModeMenu();
    postBridgeCommand("request-state");
    return;
  }

  menu.hidden = true;
  currentButton.translateChevron.setAttribute("aria-expanded", "false");
}

function applyQuickMenuState(state: BridgeQuickMenuState | null): void {
  if (
    !languagePairSelect ||
    !subtitlesSelect ||
    !videoVolumeSlider ||
    !translationVolumeSlider ||
    !videoVolumeSliderLabel ||
    !translationVolumeSliderLabel
  ) {
    return;
  }

  const menuState = state ?? createPlaceholderQuickMenuState();
  const fromItems = mapBridgeItemsToSelectItems(menuState.fromItems);
  const toItems = mapBridgeItemsToSelectItems(menuState.toItems);
  const subtitlesItems = mapBridgeItemsToSelectItems(menuState.subtitlesItems);

  languagePairSelect.fromSelect.updateItems(fromItems);
  languagePairSelect.toSelect.updateItems(toItems);
  languagePairSelect.setSelectedValues(
    getSelectedValue(menuState.fromItems, "auto"),
    getSelectedValue(menuState.toItems, "ru"),
  );

  subtitlesSelect.updateItems(subtitlesItems);
  subtitlesSelect.setSelectedValue(
    getSelectedValue(menuState.subtitlesItems, "disabled"),
  );

  videoVolumeSlider.hidden = !menuState.showVideoSlider;
  videoVolumeSlider.value = menuState.videoVolume;
  videoVolumeSliderLabel.value = menuState.videoVolume;

  translationVolumeSlider.max = menuState.translationVolumeMax;
  translationVolumeSlider.value = menuState.translationVolume;
  translationVolumeSliderLabel.value = menuState.translationVolume;

  if (quickMenu && !quickMenu.hidden) {
    queueMicrotask(() => positionQuickMenu());
  }
}

function applyBridgeState(state: BridgeStatePayload): void {
  currentState = state;

  const root = ensureOverlayRoot();
  const currentButton = ensureButton();
  const nextStatus = normalizeStatus(state);
  const displayedVoiceMode = getDisplayedVoiceMode(state);

  root.hidden = false;
  currentButton.hidden = false;
  currentButton.opacity = 1;
  currentButton.status = nextStatus as Status;
  currentButton.loading = nextStatus === "loading";
  currentButton.setText(getButtonText(state));
  currentButton.container.dataset.voiceMode = displayedVoiceMode;
  currentButton.container.dataset.voicePlaybackState =
    state.voicePlaybackState || "idle";
  currentButton.showPiPButton(state.pipVisible ?? true);

  if (downloadTranslationButton) {
    downloadTranslationButton.hidden = !state.canDownloadTranslation;
  }
  if (downloadSubtitlesButton) {
    downloadSubtitlesButton.hidden = !state.canDownloadSubtitles;
  }

  applyQuickMenuState(state.quickMenu);
  syncVoiceModeMenuState();
}

function positionButton(rect: DOMRect): void {
  if (!button) {
    return;
  }

  const buttonWidth = button.container.offsetWidth || 58;
  const buttonHeight = button.container.offsetHeight || 220;
  const isVertical = button.position === "left" || button.position === "right";
  const left = isVertical
    ? button.position === "right"
      ? Math.max(
          12,
          Math.min(
            globalThis.innerWidth - buttonWidth - 12,
            rect.right - buttonWidth - 16,
          ),
        )
      : Math.max(
          12,
          Math.min(globalThis.innerWidth - buttonWidth - 12, rect.left + 16),
        )
    : Math.max(
        12,
        Math.min(
          globalThis.innerWidth - buttonWidth - 12,
          rect.right - buttonWidth - 16,
        ),
      );
  const top = isVertical
    ? Math.max(
        12,
        Math.min(
          globalThis.innerHeight - buttonHeight - 12,
          rect.top + (rect.height - buttonHeight) / 2,
        ),
      )
    : Math.max(
        12,
        Math.min(globalThis.innerHeight - buttonHeight - 12, rect.top + 16),
      );

  button.container.style.left = `${left}px`;
  button.container.style.top = `${top}px`;
}

function syncOverlayGeometry(): void {
  const root = ensureOverlayRoot();
  const rect = getPlayerRect();

  if (!rect || rect.width < 120 || rect.height < 80) {
    root.hidden = false;
    if (button) {
      button.hidden = true;
    }
    if (quickMenu && !quickMenu.hidden) {
      setQuickMenuOpen(false);
    }
    return;
  }

  root.hidden = false;
  const currentButton = ensureButton();
  currentButton.hidden = false;
  currentButton.position = getDriveRailPosition();
  currentButton.opacity = 1;
  positionButton(rect);

  if (currentState) {
    applyBridgeState(currentState);
  } else {
    currentButton.status = "none";
    currentButton.loading = false;
    currentButton.setText(getDefaultButtonText());
  }

  if (quickMenu && !quickMenu.hidden) {
    positionQuickMenu();
  }
  if (voiceModeMenu && !voiceModeMenu.hidden) {
    positionVoiceModeMenu();
  }
}

function scheduleLayoutSync(): void {
  if (layoutSyncScheduled) {
    return;
  }

  layoutSyncScheduled = true;
  globalThis.requestAnimationFrame(() => {
    layoutSyncScheduled = false;
    syncOverlayGeometry();
    observePlayerIframe();
  });
}

function syncBridge(): void {
  postBridgeMessage({
    [GOOGLE_DRIVE_BRIDGE_FLAG]: true,
    kind: "hello",
  });
  postBridgeCommand("request-state");
}

function ensureBridgePolling(): void {
  if (bridgePollTimer !== null) {
    return;
  }

  bridgePollTimer = globalThis.setInterval(() => {
    if (document.visibilityState === "hidden") {
      return;
    }

    if (!getDrivePlayerIframe()) {
      return;
    }

    syncBridge();
  }, 1500);
}

function observePlayerIframe(): void {
  const nextIframe = getDrivePlayerIframe();
  if (observedIframe === nextIframe) {
    return;
  }

  iframeResizeObserver?.disconnect();
  iframeResizeObserver = null;
  observedIframe = nextIframe;

  if (!nextIframe || typeof ResizeObserver === "undefined") {
    return;
  }

  iframeResizeObserver = new ResizeObserver(() => {
    scheduleLayoutSync();
  });
  iframeResizeObserver.observe(nextIframe);
  syncBridge();
}

function handleBridgeMessage(event: MessageEvent<unknown>): void {
  const data = event.data;
  if (
    !data ||
    typeof data !== "object" ||
    !((data as Record<string, unknown>)[GOOGLE_DRIVE_BRIDGE_FLAG] === true)
  ) {
    return;
  }

  const message = data as BridgeMessage;
  if (message.kind !== "state") {
    return;
  }

  debugDriveTopFrame("Drive top-frame state received", {
    status: message.state.status,
    loading: message.state.loading,
    labelText: message.state.labelText,
  });
  applyBridgeState(message.state);
  scheduleLayoutSync();
}

function isEventInsideActiveUi(target: EventTarget | null): boolean {
  const node = target as Node | null;
  if (!node) {
    return false;
  }

  return Boolean(
    button?.container.contains(node) ||
      voiceModeMenu?.container.contains(node) ||
      quickMenu?.container.contains(node) ||
      ensureDialogPortalRoot().contains(node),
  );
}

export function installGoogleDriveTopFramePatch(): void {
  if (installed || !isGoogleDriveTopFrameContext()) {
    return;
  }

  installed = true;
  cleanupLegacyTopFrameUi();
  ensureOverlayRoot();
  ensureButton();
  ensureQuickMenu();
  ensureVoiceModeMenu();
  void ensureSettingsData().then(() => scheduleLayoutSync());
  scheduleLayoutSync();
  syncBridge();
  ensureBridgePolling();

  globalThis.addEventListener("message", handleBridgeMessage);
  globalThis.addEventListener("resize", scheduleLayoutSync, { passive: true });
  globalThis.addEventListener("scroll", scheduleLayoutSync, {
    passive: true,
    capture: true,
  });
  document.addEventListener("fullscreenchange", scheduleLayoutSync, true);
  document.addEventListener("webkitfullscreenchange", scheduleLayoutSync, true);
  document.addEventListener("visibilitychange", scheduleLayoutSync, true);
  document.addEventListener(
    "pointermove",
    () => {
      scheduleLayoutSync();
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!isEventInsideActiveUi(event.target)) {
        if (quickMenu && !quickMenu.hidden) {
          setQuickMenuOpen(false);
        }
        if (voiceModeMenu && !voiceModeMenu.hidden) {
          setVoiceModeMenuOpen(false);
        }
      }
    },
    { capture: true, passive: true },
  );

  domObserver = new MutationObserver(() => {
    scheduleLayoutSync();
  });
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "src"],
  });
}
