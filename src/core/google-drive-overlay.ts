import { render } from "lit-html";
import {
  CHEVRON_ICON,
  MENU_ICON,
  PIP_ICON_SVG,
  TRANSLATE_ICON_SVG,
} from "../ui/icons";

const GOOGLE_DRIVE_OVERLAY_ROOT_ATTR = "data-vot-google-drive-overlay-root";
const GOOGLE_DRIVE_POSITION_PATCH_ATTR =
  "data-vot-google-drive-overlay-position-patched";
const GOOGLE_DRIVE_PROXY_CONTROLS_ATTR = "data-vot-google-drive-proxy-controls";
const GOOGLE_DRIVE_PROXY_BUTTON_ATTR = "data-vot-google-drive-proxy-button";
const GOOGLE_DRIVE_BRIDGE_FLAG = "__votGoogleDriveBridge";
const GOOGLE_DRIVE_ACTIVE_HANDLER_KEY = "__VOT_GOOGLE_DRIVE_ACTIVE_HANDLER__";
const GOOGLE_DRIVE_ACTIVITY_HIDE_DELAY_MS = 4000;
const PRIMARY_PLAYER_ROOT_SELECTORS = [
  "#movie_player",
  ".html5-video-player",
  "#player",
];
const FALLBACK_PLAYER_ROOT_SELECTOR = ".html5-video-container";
const PLAYER_ROOT_SELECTOR = [
  ...PRIMARY_PLAYER_ROOT_SELECTORS,
  FALLBACK_PLAYER_ROOT_SELECTOR,
].join(", ");

let installed = false;
let syncScheduled = false;
let hideTimer: number | null = null;
let playerRootObserver: MutationObserver | null = null;
let observedPlayerRoot: HTMLElement | null = null;
let buttonObserver: MutationObserver | null = null;
let observedButton: HTMLElement | null = null;
let topFrameBridgeConnected = false;

type GoogleDriveBridgeCommand =
  | "translate"
  | "pip"
  | "menu"
  | "request-state"
  | "select-voice-mode"
  | "open-settings"
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

type GoogleDriveBridgeSelectItem = {
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
};

type GoogleDriveQuickMenuStatePayload = {
  fromItems: GoogleDriveBridgeSelectItem[];
  toItems: GoogleDriveBridgeSelectItem[];
  subtitlesItems: GoogleDriveBridgeSelectItem[];
  videoVolume: number;
  translationVolume: number;
  translationVolumeMax: number;
  showVideoSlider: boolean;
};

type GoogleDriveBridgeStatePayload = {
  status: string;
  loading: boolean;
  voiceMode: string;
  voicePlaybackState: string;
  labelText: string;
  pipVisible: boolean;
  canDownloadTranslation: boolean;
  canDownloadSubtitles: boolean;
  quickMenu: GoogleDriveQuickMenuStatePayload | null;
};

function getHost(): string {
  return String(globalThis.location.hostname || "").toLowerCase();
}

function getWebkitFullscreenElement(): Element | null {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  return doc.webkitFullscreenElement ?? null;
}

function getCurrentFullscreenElement(): HTMLElement | null {
  const fullscreenEl =
    document.fullscreenElement ?? getWebkitFullscreenElement();
  return fullscreenEl instanceof HTMLElement ? fullscreenEl : null;
}

export function isGoogleDriveInlineOverlayContext(): boolean {
  return (
    getHost() === "youtube.googleapis.com" &&
    globalThis.location.pathname.startsWith("/embed")
  );
}

function findPlayerRootInScope(
  scope: ParentNode | null | undefined,
): HTMLElement | null {
  if (!scope || typeof (scope as ParentNode).querySelector !== "function") {
    return null;
  }

  for (const selector of PRIMARY_PLAYER_ROOT_SELECTORS) {
    const matched = (scope as ParentNode).querySelector<HTMLElement>(selector);
    if (matched?.isConnected) {
      return matched;
    }
  }

  const fallback = (scope as ParentNode).querySelector<HTMLElement>(
    FALLBACK_PLAYER_ROOT_SELECTOR,
  );
  return fallback?.isConnected ? fallback : null;
}

function findPreferredPlayerRootAncestor(
  start: Element | null | undefined,
): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  let current = start;

  while (current instanceof HTMLElement) {
    if (
      PRIMARY_PLAYER_ROOT_SELECTORS.some((selector) =>
        current.matches(selector),
      )
    ) {
      return current;
    }

    if (!fallback && current.matches(FALLBACK_PLAYER_ROOT_SELECTOR)) {
      fallback = current;
    }

    current = current.parentElement;
  }

  return fallback;
}

function resolveBestPlayerRoot(
  container?: HTMLElement | null,
): HTMLElement | null {
  const globalMoviePlayer = document.getElementById("movie_player");
  if (
    globalMoviePlayer instanceof HTMLElement &&
    globalMoviePlayer.isConnected
  ) {
    return globalMoviePlayer;
  }

  const globalHtml5Player = document.querySelector<HTMLElement>(
    ".html5-video-player",
  );
  if (globalHtml5Player?.isConnected) {
    return globalHtml5Player;
  }

  const fullscreenEl = getCurrentFullscreenElement();
  const video = document.querySelector("video");
  const explicitClosest = findPreferredPlayerRootAncestor(container);
  const videoClosest = findPreferredPlayerRootAncestor(video);

  const candidates = [
    fullscreenEl?.matches?.(PLAYER_ROOT_SELECTOR) ? fullscreenEl : null,
    findPlayerRootInScope(fullscreenEl),
    explicitClosest instanceof HTMLElement ? explicitClosest : null,
    findPlayerRootInScope(container),
    videoClosest instanceof HTMLElement ? videoClosest : null,
    findPlayerRootInScope(video?.parentElement ?? null),
    findPlayerRootInScope(document),
    video?.parentElement instanceof HTMLElement ? video.parentElement : null,
    container instanceof HTMLElement ? container : null,
    document.body,
    document.documentElement,
  ];

  return (
    candidates.find((candidate): candidate is HTMLElement =>
      Boolean(candidate?.isConnected),
    ) ?? null
  );
}

function ensurePlayerRootPositioning(playerRoot: HTMLElement): void {
  const computed = globalThis.getComputedStyle(playerRoot);
  if (computed.position !== "static") {
    return;
  }

  playerRoot.setAttribute(GOOGLE_DRIVE_POSITION_PATCH_ATTR, "true");
  playerRoot.style.position = "relative";
}

function ensureOverlayRootStyles(overlayRoot: HTMLElement): void {
  overlayRoot.style.position = "fixed";
  overlayRoot.style.left = "0";
  overlayRoot.style.top = "0";
  overlayRoot.style.width = "0";
  overlayRoot.style.height = "0";
  overlayRoot.style.margin = "0";
  overlayRoot.style.padding = "0";
  overlayRoot.style.border = "0";
  overlayRoot.style.background = "transparent";
  overlayRoot.style.overflow = "visible";
  overlayRoot.style.pointerEvents = "none";
  overlayRoot.style.zIndex = "2147483647";
  overlayRoot.style.isolation = "isolate";
}

function syncOverlayRootGeometry(
  overlayRoot: HTMLElement,
  playerRoot: HTMLElement,
): void {
  const rect = playerRoot.getBoundingClientRect();
  overlayRoot.style.left = `${Math.round(rect.left)}px`;
  overlayRoot.style.top = `${Math.round(rect.top)}px`;
  overlayRoot.style.width = `${Math.round(rect.width)}px`;
  overlayRoot.style.height = `${Math.round(rect.height)}px`;
}

function getExistingOverlayRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[${GOOGLE_DRIVE_OVERLAY_ROOT_ATTR}="1"]`,
  );
}

export function ensureGoogleDriveOverlayRoot(
  container?: HTMLElement | null,
): HTMLElement | null {
  if (!isGoogleDriveInlineOverlayContext()) {
    return null;
  }

  const playerRoot = resolveBestPlayerRoot(container);
  if (!playerRoot) {
    return null;
  }

  ensurePlayerRootPositioning(playerRoot);

  let overlayRoot = getExistingOverlayRoot();
  if (!overlayRoot) {
    overlayRoot = document.createElement("vot-block");
    overlayRoot.setAttribute(GOOGLE_DRIVE_OVERLAY_ROOT_ATTR, "1");
    ensureOverlayRootStyles(overlayRoot);
  } else {
    ensureOverlayRootStyles(overlayRoot);
  }

  syncOverlayRootGeometry(overlayRoot, playerRoot);

  const host = document.body ?? document.documentElement;
  if (overlayRoot.parentElement !== host) {
    host.appendChild(overlayRoot);
  } else if (overlayRoot !== host.lastElementChild) {
    host.appendChild(overlayRoot);
  }

  return overlayRoot;
}

type OverlayNodes = {
  overlayRoot: HTMLElement;
  playerRoot: HTMLElement;
  controlsHost: HTMLElement;
  proxyControls: GoogleDriveProxyControls;
  button: HTMLElement | null;
  menu: HTMLElement | null;
  voiceModeMenu: HTMLElement | null;
};

type ProxyButtonKind = "translate" | "voice-menu" | "pip" | "menu";

type GoogleDriveProxyControls = {
  container: HTMLElement;
  translateButton: HTMLButtonElement;
  voiceMenuButton: HTMLButtonElement;
  pipButton: HTMLButtonElement;
  menuButton: HTMLButtonElement;
};

function getPreferredControlsContainer(
  playerRoot: HTMLElement,
): HTMLElement | null {
  const selectors = [
    ".ytp-right-controls",
    ".ytp-left-controls",
    ".ytp-chrome-controls",
    ".ytp-chrome-bottom",
  ];

  for (const selector of selectors) {
    const matched = playerRoot.querySelector<HTMLElement>(selector);
    if (matched?.isConnected) {
      return matched;
    }
  }

  return null;
}

export function ensureGoogleDriveControlsHost(
  container?: HTMLElement | null,
): HTMLElement | null {
  if (!isGoogleDriveInlineOverlayContext()) {
    return null;
  }

  const playerRoot = resolveBestPlayerRoot(container);
  if (!playerRoot) {
    return null;
  }

  const controlsContainer =
    getPreferredControlsContainer(playerRoot) ?? playerRoot;
  return controlsContainer;
}

function createProxyButton(
  kind: ProxyButtonKind,
  iconTemplate: unknown,
  ariaLabel: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ytp-button vot-google-drive-proxy-button";
  button.dataset.votGoogleDriveProxyButton = kind;
  button.setAttribute(GOOGLE_DRIVE_PROXY_BUTTON_ATTR, kind);
  button.setAttribute("aria-label", ariaLabel);

  const icon = document.createElement("span");
  icon.className = `vot-google-drive-proxy-button-icon vot-google-drive-proxy-button-icon--${kind}`;
  render(iconTemplate as any, icon);
  button.appendChild(icon);
  return button;
}

function getExistingProxyControls(): GoogleDriveProxyControls | null {
  const container = document.querySelector<HTMLElement>(
    `[${GOOGLE_DRIVE_PROXY_CONTROLS_ATTR}="1"]`,
  );
  if (!container) {
    return null;
  }

  const translateButton = container.querySelector<HTMLButtonElement>(
    `[${GOOGLE_DRIVE_PROXY_BUTTON_ATTR}="translate"]`,
  );
  const voiceMenuButton = container.querySelector<HTMLButtonElement>(
    `[${GOOGLE_DRIVE_PROXY_BUTTON_ATTR}="voice-menu"]`,
  );
  const pipButton = container.querySelector<HTMLButtonElement>(
    `[${GOOGLE_DRIVE_PROXY_BUTTON_ATTR}="pip"]`,
  );
  const menuButton = container.querySelector<HTMLButtonElement>(
    `[${GOOGLE_DRIVE_PROXY_BUTTON_ATTR}="menu"]`,
  );

  if (!translateButton || !voiceMenuButton || !pipButton || !menuButton) {
    return null;
  }

  return {
    container,
    translateButton,
    voiceMenuButton,
    pipButton,
    menuButton,
  };
}

function findCurrentVotButtonContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".vot-segmented-button");
}

function findCurrentVotButtonPart(selector: string): HTMLElement | null {
  return (
    findCurrentVotButtonContainer()?.querySelector<HTMLElement>(selector) ??
    null
  );
}

function findCurrentVoiceMenuButton(): HTMLElement | null {
  return findCurrentVotButtonPart(".vot-voice-menu-button");
}

function findCurrentPipButton(): HTMLElement | null {
  const container = findCurrentVotButtonContainer();
  const icons = Array.from(
    container?.querySelectorAll<HTMLElement>(".vot-segment-only-icon") ?? [],
  );

  return (
    icons.find((icon) =>
      /picture in picture|pip/i.test(icon.getAttribute("aria-label") ?? ""),
    ) ??
    icons[0] ??
    null
  );
}

function findCurrentMenuButton(): HTMLElement | null {
  const container = findCurrentVotButtonContainer();
  const icons = Array.from(
    container?.querySelectorAll<HTMLElement>(".vot-segment-only-icon") ?? [],
  );

  return (
    icons.find((icon) => /menu/i.test(icon.getAttribute("aria-label") ?? "")) ??
    icons[1] ??
    null
  );
}

function getCurrentQuickMenuHeaderButtons(): {
  downloadTranslation: HTMLElement | null;
  downloadSubtitles: HTMLElement | null;
  openSettings: HTMLElement | null;
} {
  const header = document.querySelector<HTMLElement>(
    ".vot-menu-header-container",
  );
  if (!header) {
    return {
      downloadTranslation: null,
      downloadSubtitles: null,
      openSettings: null,
    };
  }

  const buttons = Array.from(header.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.classList.contains("vot-icon-button"),
  );
  return {
    downloadTranslation: buttons[0] ?? null,
    downloadSubtitles: buttons[1] ?? null,
    openSettings: buttons[2] ?? null,
  };
}

function dispatchUnderlyingPrimaryAction(target: HTMLElement | null): void {
  if (!target) {
    return;
  }

  const pointerEvent = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    pointerType: "mouse",
    isPrimary: true,
  });
  target.dispatchEvent(pointerEvent);
  target.click?.();
}

function findCurrentVoiceModeMenuItem(
  mode: "standard" | "lively",
): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.vot-voice-mode-menu-item[data-mode="${mode}"]`,
  );
}

type GoogleDriveActiveUiManager = {
  getDriveQuickMenuState?: () => GoogleDriveQuickMenuStatePayload | null;
  getDriveVoiceState?: () => {
    voiceMode: string;
    voicePlaybackState: string;
    loading: boolean;
  } | null;
  applyDriveFromLanguage?: (value: string) => Promise<void> | void;
  applyDriveToLanguage?: (value: string) => Promise<void> | void;
  applyDriveSubtitles?: (value: string) => Promise<void>;
  applyDriveVideoVolume?: (value: number) => void;
  applyDriveTranslationVolume?: (value: number) => void;
  applyDriveSyncVolume?: (value: boolean) => void;
  applyDriveShowVideoSlider?: (value: boolean) => void;
  applyDriveAudioBooster?: (value: boolean) => void;
  applyDriveUseLivelyVoice?: (value: boolean) => void;
};

type GoogleDriveActiveHandler = {
  uiManager?: GoogleDriveActiveUiManager;
  ensureSubtitlesForCurrentLangPair?: () => Promise<void> | void;
  updateSubtitlesLangSelect?: () => Promise<void> | void;
};

function getActiveGoogleDriveHandler(): GoogleDriveActiveHandler | null {
  const value = (globalThis as Record<string, unknown>)[
    GOOGLE_DRIVE_ACTIVE_HANDLER_KEY
  ];
  return value && typeof value === "object"
    ? (value as GoogleDriveActiveHandler)
    : null;
}

function getActiveGoogleDriveUiManager(): GoogleDriveActiveUiManager | null {
  return getActiveGoogleDriveHandler()?.uiManager ?? null;
}

function collectBridgeStatePayload(): GoogleDriveBridgeStatePayload {
  const button = findCurrentVotButtonContainer();
  const labelText =
    button
      ?.querySelector<HTMLElement>(".vot-segment-label")
      ?.textContent?.trim() ?? "";
  const uiManager = getActiveGoogleDriveUiManager();
  const quickMenu = uiManager?.getDriveQuickMenuState?.() ?? null;
  const voiceState = uiManager?.getDriveVoiceState?.() ?? null;
  const isLoading =
    typeof voiceState?.loading === "boolean"
      ? voiceState.loading
      : button?.dataset.loading === "true";

  return {
    status: button?.dataset.status ?? "none",
    loading: isLoading,
    voiceMode: voiceState?.voiceMode ?? button?.dataset.voiceMode ?? "standard",
    voicePlaybackState:
      voiceState?.voicePlaybackState ??
      button?.dataset.voicePlaybackState ??
      "idle",
    labelText,
    pipVisible: !findCurrentPipButton()?.hidden,
    canDownloadTranslation:
      !getCurrentQuickMenuHeaderButtons().downloadTranslation?.hidden,
    canDownloadSubtitles:
      !getCurrentQuickMenuHeaderButtons().downloadSubtitles?.hidden,
    quickMenu,
  };
}

function postBridgeStateToParent(): void {
  if (!topFrameBridgeConnected || globalThis.parent === globalThis) {
    return;
  }

  globalThis.parent.postMessage(
    {
      [GOOGLE_DRIVE_BRIDGE_FLAG]: true,
      kind: "state",
      state: collectBridgeStatePayload(),
    },
    "*",
  );
}

async function executeBridgeCommand(
  command: GoogleDriveBridgeCommand,
  mode?: "standard" | "lively",
  value?: string | number | boolean,
): Promise<void> {
  const handler = getActiveGoogleDriveHandler();
  const uiManager = handler?.uiManager;

  if (command === "request-state") {
    await handler?.ensureSubtitlesForCurrentLangPair?.();
    await handler?.updateSubtitlesLangSelect?.();
    return;
  }

  if (command === "select-voice-mode") {
    dispatchUnderlyingPrimaryAction(
      mode ? findCurrentVoiceModeMenuItem(mode) : null,
    );
    return;
  }

  if (command === "translate") {
    dispatchUnderlyingPrimaryAction(
      findCurrentVotButtonPart(".vot-translate-button"),
    );
    return;
  }

  if (command === "pip") {
    dispatchUnderlyingPrimaryAction(findCurrentPipButton());
    return;
  }

  if (command === "menu") {
    dispatchUnderlyingPrimaryAction(findCurrentMenuButton());
    return;
  }

  const headerButtons = getCurrentQuickMenuHeaderButtons();

  if (command === "open-settings") {
    dispatchUnderlyingPrimaryAction(headerButtons.openSettings);
    return;
  }

  if (command === "download-translation") {
    dispatchUnderlyingPrimaryAction(headerButtons.downloadTranslation);
    return;
  }

  if (command === "download-subtitles") {
    dispatchUnderlyingPrimaryAction(headerButtons.downloadSubtitles);
    return;
  }

  if (command === "set-from-language" && typeof value === "string") {
    await uiManager?.applyDriveFromLanguage?.(value);
    return;
  }

  if (command === "set-to-language" && typeof value === "string") {
    await uiManager?.applyDriveToLanguage?.(value);
    return;
  }

  if (command === "set-subtitles" && typeof value === "string") {
    await uiManager?.applyDriveSubtitles?.(value);
    return;
  }

  if (command === "set-video-volume" && typeof value === "number") {
    uiManager?.applyDriveVideoVolume?.(value);
    return;
  }

  if (command === "set-translation-volume" && typeof value === "number") {
    uiManager?.applyDriveTranslationVolume?.(value);
    return;
  }

  if (command === "set-sync-volume" && typeof value === "boolean") {
    uiManager?.applyDriveSyncVolume?.(value);
    return;
  }

  if (command === "set-show-video-slider" && typeof value === "boolean") {
    uiManager?.applyDriveShowVideoSlider?.(value);
    return;
  }

  if (command === "set-audio-booster" && typeof value === "boolean") {
    uiManager?.applyDriveAudioBooster?.(value);
    return;
  }

  if (command === "set-use-lively-voice" && typeof value === "boolean") {
    uiManager?.applyDriveUseLivelyVoice?.(value);
  }
}

function handleTopFrameBridgeMessage(event: MessageEvent<unknown>): void {
  const data = event.data;
  if (
    !data ||
    typeof data !== "object" ||
    !((data as Record<string, unknown>)[GOOGLE_DRIVE_BRIDGE_FLAG] === true)
  ) {
    return;
  }

  const payload = data as Record<string, unknown>;
  const kind = payload.kind;
  if (kind === "hello") {
    topFrameBridgeConnected = true;
    scheduleSyncAndShow();
    postBridgeStateToParent();
    return;
  }

  if (kind !== "command") {
    return;
  }

  topFrameBridgeConnected = true;
  const command = payload.command;
  const mode = payload.mode;
  const value = payload.value;
  if (
    command === "translate" ||
    command === "pip" ||
    command === "menu" ||
    command === "request-state" ||
    command === "select-voice-mode" ||
    command === "open-settings" ||
    command === "download-translation" ||
    command === "download-subtitles" ||
    command === "set-from-language" ||
    command === "set-to-language" ||
    command === "set-subtitles" ||
    command === "set-video-volume" ||
    command === "set-translation-volume" ||
    command === "set-sync-volume" ||
    command === "set-show-video-slider" ||
    command === "set-audio-booster" ||
    command === "set-use-lively-voice"
  ) {
    void executeBridgeCommand(
      command,
      mode === "lively" || mode === "standard" ? mode : undefined,
      typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
        ? value
        : undefined,
    ).finally(() => {
      globalThis.setTimeout(() => {
        scheduleSyncAndShow();
        postBridgeStateToParent();
      }, 0);
    });
  }
}

function bindProxyButton(
  proxyButton: HTMLButtonElement,
  resolveTarget: () => HTMLElement | null,
): void {
  if (proxyButton.dataset.bound === "true") {
    return;
  }

  proxyButton.dataset.bound = "true";
  proxyButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchUnderlyingPrimaryAction(resolveTarget());
  });
}

function ensureGoogleDriveProxyControls(
  controlsHost: HTMLElement,
): GoogleDriveProxyControls {
  let controls = getExistingProxyControls();

  if (!controls) {
    const container = document.createElement("div");
    container.className = "vot-google-drive-proxy-controls";
    container.setAttribute(GOOGLE_DRIVE_PROXY_CONTROLS_ATTR, "1");

    const translateButton = createProxyButton(
      "translate",
      TRANSLATE_ICON_SVG,
      "Translate video",
    );
    const voiceMenuButton = createProxyButton(
      "voice-menu",
      CHEVRON_ICON,
      "Select voice mode",
    );
    voiceMenuButton.setAttribute("aria-haspopup", "menu");
    voiceMenuButton.setAttribute("aria-expanded", "false");

    const pipButton = createProxyButton(
      "pip",
      PIP_ICON_SVG,
      "Picture in picture",
    );
    const menuButton = createProxyButton("menu", MENU_ICON, "Menu");
    menuButton.setAttribute("aria-haspopup", "dialog");
    menuButton.setAttribute("aria-expanded", "false");

    container.append(translateButton, voiceMenuButton, pipButton, menuButton);

    controls = {
      container,
      translateButton,
      voiceMenuButton,
      pipButton,
      menuButton,
    };
  }

  bindProxyButton(controls.translateButton, () =>
    findCurrentVotButtonPart(".vot-translate-button"),
  );
  bindProxyButton(controls.voiceMenuButton, findCurrentVoiceMenuButton);
  bindProxyButton(controls.pipButton, findCurrentPipButton);
  bindProxyButton(controls.menuButton, findCurrentMenuButton);

  if (topFrameBridgeConnected) {
    controls.container.remove();
    return controls;
  }

  const insertionAnchor =
    controlsHost.querySelector<HTMLElement>(
      ".ytp-subtitles-button, .ytp-settings-button",
    ) ?? controlsHost.firstElementChild;

  if (controls.container.parentElement !== controlsHost) {
    if (insertionAnchor && insertionAnchor.parentElement === controlsHost) {
      controlsHost.insertBefore(controls.container, insertionAnchor);
    } else {
      controlsHost.appendChild(controls.container);
    }
  } else if (
    insertionAnchor &&
    insertionAnchor.parentElement === controlsHost &&
    controls.container.nextElementSibling !== insertionAnchor
  ) {
    controlsHost.insertBefore(controls.container, insertionAnchor);
  }

  return controls;
}

function syncProxyControlsState(
  proxyControls: GoogleDriveProxyControls,
  button: HTMLElement | null,
): void {
  if (!button) {
    proxyControls.container.hidden = true;
    return;
  }

  if (topFrameBridgeConnected) {
    proxyControls.container.remove();
    return;
  }

  proxyControls.container.hidden = false;

  const status = button.dataset.status ?? "none";
  const voiceMode = button.dataset.voiceMode ?? "standard";
  const playbackState = button.dataset.voicePlaybackState ?? "idle";
  const loading = button.dataset.loading === "true";
  const translateSource = button.querySelector<HTMLElement>(
    ".vot-translate-button",
  );
  const voiceMenuSource = findCurrentVoiceMenuButton();
  const pipSource = findCurrentPipButton();
  const menuSource = findCurrentMenuButton();

  proxyControls.container.dataset.status = status;
  proxyControls.container.dataset.voiceMode = voiceMode;
  proxyControls.container.dataset.voicePlaybackState = playbackState;
  proxyControls.container.dataset.loading = String(loading);

  proxyControls.translateButton.dataset.status = status;
  proxyControls.translateButton.dataset.voiceMode = voiceMode;
  proxyControls.translateButton.dataset.voicePlaybackState = playbackState;
  proxyControls.translateButton.dataset.loading = String(loading);
  proxyControls.translateButton.setAttribute(
    "aria-label",
    translateSource?.getAttribute("aria-label") || "Translate video",
  );

  proxyControls.voiceMenuButton.dataset.voiceMode = voiceMode;
  proxyControls.voiceMenuButton.setAttribute(
    "aria-label",
    voiceMenuSource?.getAttribute("aria-label") || "Select voice mode",
  );
  proxyControls.voiceMenuButton.setAttribute(
    "aria-expanded",
    voiceMenuSource?.getAttribute("aria-expanded") || "false",
  );

  proxyControls.menuButton.setAttribute(
    "aria-label",
    menuSource?.getAttribute("aria-label") || "Menu",
  );
  proxyControls.menuButton.setAttribute(
    "aria-expanded",
    menuSource?.getAttribute("aria-expanded") || "false",
  );

  proxyControls.pipButton.hidden = Boolean(pipSource?.hidden);
  proxyControls.pipButton.setAttribute(
    "aria-label",
    pipSource?.getAttribute("aria-label") || "Picture in picture",
  );

  const isActive =
    status === "success" ||
    loading ||
    playbackState === "loading" ||
    playbackState === "playing" ||
    playbackState === "paused";
  proxyControls.translateButton.classList.toggle("is-active", isActive);
  proxyControls.translateButton.classList.toggle(
    "is-disabled",
    status === "disabled",
  );
}

function getOverlayNodes(): OverlayNodes | null {
  const overlayRoot = ensureGoogleDriveOverlayRoot();
  if (!overlayRoot) {
    return null;
  }

  const playerRoot = resolveBestPlayerRoot();
  if (!(playerRoot instanceof HTMLElement)) {
    return null;
  }

  const controlsHost = ensureGoogleDriveControlsHost(playerRoot);
  if (!(controlsHost instanceof HTMLElement)) {
    return null;
  }

  const proxyControls = ensureGoogleDriveProxyControls(controlsHost);

  return {
    overlayRoot,
    playerRoot,
    controlsHost,
    proxyControls,
    button: document.querySelector<HTMLElement>(".vot-segmented-button"),
    menu: document.querySelector<HTMLElement>(".vot-menu"),
    voiceModeMenu: document.querySelector<HTMLElement>(".vot-voice-mode-menu"),
  };
}

function syncOverlayNodes(): OverlayNodes | null {
  const nodes = getOverlayNodes();
  if (!nodes) {
    return null;
  }

  if (nodes.button) {
    nodes.button.classList.remove("vot-google-drive-native-controls");
    nodes.button.classList.add("vot-google-drive-proxy-source");
    nodes.button.style.position = "absolute";
    nodes.button.style.left = "-9999px";
    nodes.button.style.top = "-9999px";
    nodes.button.style.right = "auto";
    nodes.button.style.bottom = "auto";
    nodes.button.style.transform = "none";
    nodes.button.style.margin = "0";
    nodes.button.style.maxWidth = "0";
    nodes.button.style.zIndex = "1";

    if (nodes.button.parentElement !== nodes.overlayRoot) {
      nodes.overlayRoot.appendChild(nodes.button);
    }

    syncProxyControlsState(nodes.proxyControls, nodes.button);
  }

  for (const node of [nodes.menu, nodes.voiceModeMenu]) {
    if (!node) continue;
    if (node.parentElement !== nodes.overlayRoot) {
      nodes.overlayRoot.appendChild(node);
    } else if (node !== nodes.overlayRoot.lastElementChild) {
      nodes.overlayRoot.appendChild(node);
    }
  }

  return nodes;
}

function isMenuOpen(node: HTMLElement | null): boolean {
  return Boolean(node && !node.hidden);
}

function clearHideTimer(): void {
  if (hideTimer !== null) {
    globalThis.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function hideButton(): void {
  const nodes = getOverlayNodes();
  if (!nodes?.button) {
    return;
  }

  const activeElement = document.activeElement;
  const shouldKeepVisible =
    isMenuOpen(nodes.menu) ||
    isMenuOpen(nodes.voiceModeMenu) ||
    (activeElement instanceof Node &&
      (nodes.overlayRoot.contains(activeElement) ||
        nodes.button.contains(activeElement)));

  if (shouldKeepVisible) {
    return;
  }

  nodes.button.style.opacity = "0";
  nodes.button.classList.add("vot-segmented-button--hidden");
}

function showButton(): void {
  const nodes = syncOverlayNodes();
  if (!nodes?.button) {
    return;
  }

  nodes.button.hidden = false;
  nodes.button.removeAttribute("hidden");
  nodes.button.style.opacity = "1";
  nodes.button.classList.remove("vot-segmented-button--hidden");

  clearHideTimer();
  hideTimer = globalThis.setTimeout(
    () => hideButton(),
    GOOGLE_DRIVE_ACTIVITY_HIDE_DELAY_MS,
  );
}

function isActivityInsidePlayer(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) {
    return false;
  }

  const nodes = getOverlayNodes();
  if (!nodes) {
    return false;
  }

  return (
    nodes.playerRoot.contains(target) || nodes.overlayRoot.contains(target)
  );
}

function scheduleSyncAndShow(): void {
  if (syncScheduled) {
    return;
  }

  syncScheduled = true;
  globalThis.requestAnimationFrame(() => {
    syncScheduled = false;
    syncOverlayNodes();
    showButton();
    observeCurrentPlayerRoot();
    observeCurrentButton();
    postBridgeStateToParent();
  });
}

function observeCurrentPlayerRoot(): void {
  const nodes = getOverlayNodes();
  const nextPlayerRoot = nodes?.playerRoot ?? null;

  if (observedPlayerRoot === nextPlayerRoot) {
    return;
  }

  playerRootObserver?.disconnect();
  playerRootObserver = null;
  observedPlayerRoot = nextPlayerRoot;

  if (!nextPlayerRoot) {
    return;
  }

  playerRootObserver = new MutationObserver(() => {
    scheduleSyncAndShow();
  });

  playerRootObserver.observe(nextPlayerRoot, {
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
    childList: true,
    subtree: true,
  });
}

function observeCurrentButton(): void {
  const nextButton = findCurrentVotButtonContainer();

  if (observedButton === nextButton) {
    return;
  }

  buttonObserver?.disconnect();
  buttonObserver = null;
  observedButton = nextButton;

  if (!nextButton) {
    return;
  }

  buttonObserver = new MutationObserver(() => {
    scheduleSyncAndShow();
  });

  buttonObserver.observe(nextButton, {
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "aria-expanded",
      "aria-label",
      "data-status",
      "data-loading",
      "data-voice-mode",
      "data-voice-playback-state",
    ],
    childList: true,
    subtree: true,
  });
}

export function installGoogleDriveOverlayPatch(): void {
  if (installed || !isGoogleDriveInlineOverlayContext()) {
    return;
  }

  installed = true;
  globalThis.addEventListener("message", handleTopFrameBridgeMessage);

  const activityHandler = (event: Event) => {
    if (!isActivityInsidePlayer(event.target)) {
      return;
    }
    showButton();
  };

  scheduleSyncAndShow();

  document.addEventListener("pointermove", activityHandler, {
    passive: true,
    capture: true,
  });
  document.addEventListener("mousemove", activityHandler, {
    passive: true,
    capture: true,
  });
  document.addEventListener("pointerdown", activityHandler, {
    passive: true,
    capture: true,
  });
  document.addEventListener("pointerenter", activityHandler, {
    passive: true,
    capture: true,
  });
  document.addEventListener(
    "focusin",
    () => {
      showButton();
    },
    true,
  );
  document.addEventListener(
    "play",
    () => {
      scheduleSyncAndShow();
    },
    true,
  );
  document.addEventListener(
    "playing",
    () => {
      scheduleSyncAndShow();
    },
    true,
  );
  document.addEventListener(
    "pause",
    () => {
      scheduleSyncAndShow();
    },
    true,
  );

  const fullscreenHandler = () => {
    scheduleSyncAndShow();
  };
  document.addEventListener("fullscreenchange", fullscreenHandler, true);
  document.addEventListener("webkitfullscreenchange", fullscreenHandler, true);
  window.addEventListener("resize", fullscreenHandler, { passive: true });
  window.addEventListener("scroll", fullscreenHandler, {
    passive: true,
    capture: true,
  });

  const observer = new MutationObserver(() => {
    scheduleSyncAndShow();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
