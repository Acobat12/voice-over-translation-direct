import { availableLangs, availableTTS } from "@vot.js/shared/consts";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";
import { render } from "lit-html";
import type { VideoHandler } from "../..";
import { maxAudioVolume } from "../../config/config";
import { EventImpl } from "../../core/eventImpl";
import { localizationProvider } from "../../localization/localizationProvider";
import type { Direction, Position } from "../../types/components/votButton";
import type { StorageData } from "../../types/storage";
import type { ButtonLayout, OverlayMount } from "../../types/uiManager";
import type {
  OverlayViewEventMap,
  OverlayViewProps,
} from "../../types/views/overlay";
import ui from "../../ui";
import debug from "../../utils/debug";
import type { IntervalIdleChecker } from "../../utils/intervalIdleChecker";
import { votStorage } from "../../utils/storage";
import { isPiPAvailable } from "../../utils/utils";
import DownloadButton from "../components/downloadButton";
import Label from "../components/label";
import LanguagePairSelect from "../components/languagePairSelect";
import Select from "../components/select";
import Slider from "../components/slider";
import SliderLabel from "../components/sliderLabel";
import Tooltip from "../components/tooltip";
import VOTButton from "../components/votButton";
import VOTMenu from "../components/votMenu";
import VOTRail from "../components/votRail";
import {
  CHECK_ICON,
  SETTINGS_ICON,
  SUBTITLES_ICON,
  VOICE_WAVE_ICON,
} from "./../icons";
import { didTooltipMountContextChange } from "../mount";

export class OverlayView {
  private static readonly BIG_CONTAINER_WIDTH_PX = 550;
  private static readonly MENU_CLAMP_GAP_PX = 12;
  private static readonly MENU_CLICK_GUARD_MS = 180;

  mount: OverlayMount;
  globalPortal: HTMLElement;
  private abortController: AbortController | null = null;
  private defaultVolumePersistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly defaultVolumePersistDelayMs = 250;
  private quickMenuOpenedAt = 0;
  private voiceModeMenuOpenedAt = 0;

  private dragging = false;
  private dragCandidate = false;
  private dragDirty = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private currentClientX = 0;
  private readonly dragThresholdPx = 6;
  private containerRect: DOMRect | null = null;
  private dragIsBigContainer: boolean | null = null;
  private checkerUnsubscribe: (() => void) | null = null;

  private initialized = false;
  private readonly data: Partial<StorageData>;
  private readonly videoHandler?: VideoHandler;
  private readonly intervalIdleChecker: IntervalIdleChecker;

  private readonly events: {
    [K in keyof OverlayViewEventMap]: EventImpl<OverlayViewEventMap[K]>;
  } = {
    "click:settings": new EventImpl<OverlayViewEventMap["click:settings"]>(),
    "click:pip": new EventImpl<OverlayViewEventMap["click:pip"]>(),
    "click:downloadTranslation": new EventImpl<
      OverlayViewEventMap["click:downloadTranslation"]
    >(),
    "click:downloadSubtitles": new EventImpl<
      OverlayViewEventMap["click:downloadSubtitles"]
    >(),
    "click:translate": new EventImpl<OverlayViewEventMap["click:translate"]>(),
    "click:subtitles": new EventImpl<OverlayViewEventMap["click:subtitles"]>(),
    "select:voiceMode": new EventImpl<
      OverlayViewEventMap["select:voiceMode"]
    >(),
    "input:videoVolume": new EventImpl<
      OverlayViewEventMap["input:videoVolume"]
    >(),
    "input:translationVolume": new EventImpl<
      OverlayViewEventMap["input:translationVolume"]
    >(),
    "select:fromLanguage": new EventImpl<
      OverlayViewEventMap["select:fromLanguage"]
    >(),
    "select:toLanguage": new EventImpl<
      OverlayViewEventMap["select:toLanguage"]
    >(),
    "select:subtitles": new EventImpl<
      OverlayViewEventMap["select:subtitles"]
    >(),
  };

  // button
  votButton?: VOTButton | VOTRail;
  votButtonTooltip?: Tooltip;
  // menu
  votMenu?: VOTMenu;
  voiceModeMenu?: VOTMenu;
  downloadTranslationButton?: DownloadButton;
  downloadSubtitlesButton?: HTMLElement;
  openSettingsButton?: HTMLElement;
  languagePairSelect?: LanguagePairSelect<RequestLang, ResponseLang>;
  subtitlesSelectLabel?: Label;
  subtitlesSelect?: Select;
  videoVolumeSliderLabel?: SliderLabel;
  videoVolumeSlider?: Slider;
  translationVolumeSliderLabel?: SliderLabel;
  translationVolumeSlider?: Slider;

  constructor({
    mount,
    globalPortal,
    data = {},
    videoHandler,
    intervalIdleChecker,
  }: OverlayViewProps) {
    this.mount = mount;
    this.globalPortal = globalPortal;
    this.data = data;
    this.videoHandler = videoHandler;
    this.intervalIdleChecker = intervalIdleChecker;
  }

  get root(): HTMLElement {
    return this.mount.root;
  }

  get portalContainer(): HTMLElement {
    return this.mount.portalContainer;
  }

  get tooltipLayoutRoot(): HTMLElement | undefined {
    return this.mount.tooltipLayoutRoot;
  }

  get useRailLayout(): boolean {
    const site = this.videoHandler?.site;
    if (!site) {
      return false;
    }

    if (site.host === "googledrive") {
      return false;
    }

    return true;
  }

  private get menuHost(): HTMLElement {
    return this.useRailLayout ? this.globalPortal : this.root;
  }

  private get selectedVoiceMode(): "standard" | "lively" {
    return this.data.useLivelyVoice ? "lively" : "standard";
  }

  private getVoiceModeLabel(mode = this.selectedVoiceMode): string {
    return mode === "lively"
      ? localizationProvider.get("VOTLivelyVoices")
      : localizationProvider.get("VOTStandardVoices");
  }

  private getVoiceModeDescription(mode = this.selectedVoiceMode): string {
    return mode === "lively"
      ? localizationProvider.get("VOTLivelyVoicesDescription")
      : localizationProvider.get("VOTStandardVoicesDescription");
  }

  private createVoiceModeMenuItem(mode: "standard" | "lively"): HTMLElement {
    const item = ui.createEl("vot-block", ["vot-voice-mode-menu-item"]);
    ui.makeButtonLike(item, {
      ariaLabel: this.getVoiceModeLabel(mode),
    });
    item.dataset.mode = mode;

    const icon = ui.createEl("vot-block", ["vot-voice-mode-menu-item-icon"]);
    render(VOICE_WAVE_ICON, icon);

    const content = ui.createEl("vot-block", [
      "vot-voice-mode-menu-item-content",
    ]);
    const title = ui.createEl("vot-block", ["vot-voice-mode-menu-item-title"]);
    title.textContent = this.getVoiceModeLabel(mode);
    const description = ui.createEl("vot-block", [
      "vot-voice-mode-menu-item-description",
    ]);
    description.textContent = this.getVoiceModeDescription(mode);
    content.append(title, description);

    const check = ui.createEl("vot-block", ["vot-voice-mode-menu-item-check"]);
    render(CHECK_ICON, check);

    item.append(icon, content, check);
    return item;
  }

  private shouldLogMobileOverlay(): boolean {
    return /^(m|music)\.youtube\.com$/i.test(
      String(globalThis.location.hostname || ""),
    );
  }

  /**
   * Update mount points (root/tooltipLayoutRoot) when the player container changes.
   * Moves already-mounted UI nodes and rebinds root-bound listeners (dragging).
   */
  updateMount(nextMount: OverlayMount): this {
    const prevRoot = this.mount.root;
    const nextRoot = nextMount.root;
    const prevTooltipRoot = this.mount.tooltipLayoutRoot;
    const nextTooltipRoot = nextMount.tooltipLayoutRoot;

    this.mount = nextMount;

    if (!this.isInitialized()) {
      return this;
    }

    // Move mounted nodes to new containers.
    if (prevRoot !== nextRoot) {
      if (this.votButton) {
        nextRoot.appendChild(this.votButton.container);
      }
      if (this.votMenu) {
        this.menuHost.appendChild(this.votMenu.container);
      }
      if (this.voiceModeMenu) {
        this.menuHost.appendChild(this.voiceModeMenu.container);
      }
    }

    // Tooltip geometry depends on both the layout root and the overlay root:
    // some fullscreen transitions only reparent the button/root while keeping
    // the same tooltipLayoutRoot, so force a refresh for either change.
    if (
      this.votButtonTooltip &&
      didTooltipMountContextChange(
        {
          root: prevRoot,
          portalContainer: this.mount.portalContainer,
          subtitlesMountContainer: this.mount.subtitlesMountContainer,
          tooltipLayoutRoot: prevTooltipRoot,
        },
        nextMount,
      )
    ) {
      // If tooltipLayoutRoot becomes undefined, fall back to documentElement.
      this.votButtonTooltip.updateMount({
        layoutRoot: nextTooltipRoot ?? document.documentElement,
      });
    }

    return this;
  }

  isInitialized(): this is {
    // #region Button type
    votButton: VOTButton | VOTRail;
    votButtonTooltip: Tooltip;
    // #endregion Button type
    // #region Menu type
    votMenu: VOTMenu;
    voiceModeMenu: VOTMenu;
    downloadTranslationButton: DownloadButton;
    downloadSubtitlesButton: HTMLElement;
    openSettingsButton: HTMLElement;
    languagePairSelect: LanguagePairSelect<RequestLang, ResponseLang>;
    subtitlesSelectLabel: Label;
    subtitlesSelect: Select;
    videoVolumeSliderLabel: SliderLabel;
    videoVolumeSlider: Slider;
    translationVolumeSliderLabel: SliderLabel;
    translationVolumeSlider: Slider;
    // #endregion Menu type
  } {
    return this.initialized;
  }

  calcButtonLayout(position: Position): ButtonLayout {
    if (this.useRailLayout) {
      if (position === "left" || position === "right") {
        return {
          direction: "column",
          position,
        };
      }

      return {
        direction: "row",
        position: position === "top" ? "top" : "default",
      };
    }

    if (this.isBigContainer && isSidePosition(position)) {
      return {
        direction: "column",
        position,
      };
    }

    return {
      direction: "row",
      position: "default",
    };
  }

  addEventListener<K extends keyof OverlayViewEventMap>(
    type: K,
    listener: (...data: OverlayViewEventMap[K]) => void,
  ): this {
    this.events[type].addListener(listener);
    return this;
  }

  removeEventListener<K extends keyof OverlayViewEventMap>(
    type: K,
    listener: (...data: OverlayViewEventMap[K]) => void,
  ): this {
    this.events[type].removeListener(listener);
    return this;
  }

  private scheduleDefaultVolumePersist(): void {
    if (this.defaultVolumePersistTimer !== undefined) {
      globalThis.clearTimeout(this.defaultVolumePersistTimer);
    }

    this.defaultVolumePersistTimer = globalThis.setTimeout(() => {
      this.defaultVolumePersistTimer = undefined;
      this.flushDefaultVolumePersist();
    }, this.defaultVolumePersistDelayMs);
  }

  private flushDefaultVolumePersist(): void {
    if (this.defaultVolumePersistTimer !== undefined) {
      globalThis.clearTimeout(this.defaultVolumePersistTimer);
      this.defaultVolumePersistTimer = undefined;
    }

    if (typeof this.data.defaultVolume !== "number") {
      return;
    }

    void votStorage.set("defaultVolume", this.data.defaultVolume);
  }

  initUI(buttonPosition: Position = "default") {
    if (this.isInitialized()) {
      throw new Error("[VOT] OverlayView is already initialized");
    }

    this.initialized = true;

    // #region Shared logic
    const { position, direction } = this.calcButtonLayout(buttonPosition);

    // #endregion Shared logic
    // #region VOT Button
    this.votButton = this.useRailLayout
      ? new VOTRail({
          position,
          direction,
          status: "none",
          labelHtml: localizationProvider.get("VOTRailTranslateAndDub"),
        })
      : new VOTButton({
          position,
          direction,
          status: "none",
          labelHtml: localizationProvider.get("translateVideo"),
        });
    this.votButton.opacity = 0;
    if (!this.pipButtonVisible) {
      this.votButton.showPiPButton(false);
    }
    if (this.useRailLayout && this.votButton instanceof VOTRail) {
      this.votButton.showSubtitlesButton(true);
      this.votButton.setButtonLabels({
        subtitles: localizationProvider.get("VOTSubtitles"),
        pip: "Picture in picture",
        menu: localizationProvider.get("VOTSettings"),
      });
    }
    this.root.appendChild(this.votButton.container);
    this.syncSharedRailPlacement();
    this.votButtonTooltip = new Tooltip({
      target: this.votButton.translateButton,
      content: this.useRailLayout
        ? localizationProvider.get("VOTRailTranslateAndDub")
        : localizationProvider.get("translateVideo"),
      position: this.votButton.tooltipPos,
      // Keep side-tooltip direction stable for the moved button (left/right)
      // so status/error text does not mirror to the opposite side.
      autoLayout: false,
      hidden: direction === "row",
      bordered: false,
      parentElement: this.globalPortal,
      layoutRoot: this.tooltipLayoutRoot,
    });

    // #endregion VOT Button
    // #region VOT Menu
    this.votMenu = new VOTMenu({
      titleHtml: localizationProvider.get("VOTSettings"),
      position,
    });
    this.menuHost.appendChild(this.votMenu.container);
    if (this.useRailLayout) {
      this.votMenu.container.classList.add("vot-menu--fixed-anchor");
      this.votMenu.container.style.position = "fixed";
      this.votMenu.container.style.left = "0";
      this.votMenu.container.style.top = "0";
      this.votMenu.container.style.zIndex = "2147483647";
      this.votMenu.container.style.pointerEvents = "auto";
      this.votMenu.container.style.width = "min(420px, calc(100vw - 24px))";
      this.votMenu.container.style.maxHeight = "calc(100vh - 24px)";
      this.votMenu.container.style.overflow = "visible";
      this.votMenu.contentWrapper.style.maxHeight = "calc(100vh - 80px)";
      this.votMenu.contentWrapper.style.overflowY = "auto";
      this.votMenu.contentWrapper.style.overflowX = "visible";
    }

    // A11y: link the menu toggle button to the popover.
    this.votButton.menuButton.setAttribute(
      "aria-controls",
      this.votMenu.container.id,
    );

    // #region VOT Menu Header
    this.downloadTranslationButton = new DownloadButton();
    this.downloadTranslationButton.hidden = true;

    this.downloadSubtitlesButton = ui.createIconButton(SUBTITLES_ICON, {
      ariaLabel: "Download subtitles",
    });
    this.downloadSubtitlesButton.hidden = true;

    this.openSettingsButton = ui.createIconButton(SETTINGS_ICON, {
      ariaLabel: localizationProvider.get("VOTSettings"),
    });

    this.votMenu.headerContainer.append(
      this.downloadTranslationButton.button,
      this.downloadSubtitlesButton,
      this.openSettingsButton,
    );

    // #endregion VOT Menu Header
    // #region VOT Menu Body

    const detectedLanguage =
      this.videoHandler?.videoData?.detectedLanguage ?? "en";
    const responseLanguage = this.data.responseLanguage ?? "ru";
    this.languagePairSelect = new LanguagePairSelect({
      from: {
        // `detectedLanguage` is dynamic and may include codes that aren't in
        // the compile-time Phrase union.
        selectTitle: localizationProvider.get(
          `langs.${detectedLanguage}` as any,
        ),
        items: Select.genLanguageItems(availableLangs, detectedLanguage),
      },
      to: {
        selectTitle: localizationProvider.get(
          `langs.${responseLanguage}` as any,
        ),
        items: Select.genLanguageItems(availableTTS, responseLanguage),
      },
      dialogParent: this.globalPortal,
    });

    this.subtitlesSelectLabel = new Label({
      labelText: localizationProvider.get("VOTSubtitles"),
    });
    this.subtitlesSelect = new Select({
      selectTitle: localizationProvider.get("VOTSubtitlesDisabled"),
      dialogTitle: localizationProvider.get("VOTSubtitles"),
      labelElement: this.subtitlesSelectLabel.container,
      dialogParent: this.globalPortal,
      items: [
        {
          label: localizationProvider.get("VOTSubtitlesDisabled"),
          value: "disabled",
          selected: true,
        },
      ],
    });

    const videoVolume = this.videoHandler
      ? this.videoHandler.getVideoVolume() * 100
      : 100;
    this.videoVolumeSliderLabel = new SliderLabel({
      labelText: localizationProvider.get("VOTVolume"),
      value: videoVolume,
    });

    this.videoVolumeSlider = new Slider({
      labelHtml: this.videoVolumeSliderLabel.container,
      value: videoVolume,
    });
    this.videoVolumeSlider.hidden =
      !this.data.showVideoSlider || this.votButton.status !== "success";

    const defaultVolume = this.data.defaultVolume ?? 100;
    this.translationVolumeSliderLabel = new SliderLabel({
      labelText: localizationProvider.get("VOTVolumeTranslation"),
      value: defaultVolume,
    });

    this.translationVolumeSlider = new Slider({
      labelHtml: this.translationVolumeSliderLabel.container,
      value: defaultVolume,
      max: this.data.audioBooster ? maxAudioVolume : 100,
    });
    this.translationVolumeSlider.hidden = this.votButton.status !== "success";

    this.votMenu.bodyContainer.append(
      this.languagePairSelect.container,
      this.subtitlesSelect.container,
      this.videoVolumeSlider.container,
      this.translationVolumeSlider.container,
    );

    if (this.useRailLayout) {
      this.voiceModeMenu = new VOTMenu({
        titleHtml: localizationProvider.get("VOTVoiceModeMenuTitle"),
        position: "default",
      });
      this.voiceModeMenu.container.classList.add("vot-menu--fixed-anchor");
      this.voiceModeMenu.container.classList.add("vot-voice-mode-menu");
      this.voiceModeMenu.container.style.position = "fixed";
      this.voiceModeMenu.container.style.left = "0";
      this.voiceModeMenu.container.style.top = "0";
      this.voiceModeMenu.container.style.zIndex = "2147483647";
      this.voiceModeMenu.container.style.pointerEvents = "auto";
      this.voiceModeMenu.container.style.width =
        "min(360px, calc(100vw - 24px))";
      this.voiceModeMenu.container.style.maxHeight = "calc(100vh - 24px)";
      this.voiceModeMenu.container.style.overflow = "visible";
      this.voiceModeMenu.contentWrapper.style.maxHeight = "calc(100vh - 80px)";
      this.voiceModeMenu.contentWrapper.style.overflowY = "auto";
      this.voiceModeMenu.contentWrapper.style.overflowX = "visible";
      this.voiceModeMenu.hidden = true;

      const standardItem = this.createVoiceModeMenuItem("standard");
      const livelyItem = this.createVoiceModeMenuItem("lively");
      this.voiceModeMenu.bodyContainer.append(standardItem, livelyItem);
      this.menuHost.appendChild(this.voiceModeMenu.container);

      if (this.votButton instanceof VOTRail) {
        this.votButton.translateChevron.setAttribute(
          "aria-controls",
          this.voiceModeMenu.container.id,
        );
      }
      this.syncVoiceModeUi();
      this.syncSubtitlesButtonUi();
    }

    // #endregion VOT Menu Body
    // #endregion VOT Menu
    return this;
  }

  private getMenuBoundsRect(): DOMRect {
    return (
      this.videoHandler?.container?.getBoundingClientRect?.() ??
      this.root.getBoundingClientRect()
    );
  }

  private positionFixedMenu(
    menu: VOTMenu,
    anchorRect: DOMRect,
    opts: { alignToGroup?: DOMRect } = {},
  ): void {
    if (!this.useRailLayout || !this.votButton) {
      return;
    }

    const boundsRect = this.getMenuBoundsRect();
    const menuWidth = menu.container.offsetWidth || 360;
    const menuHeight = menu.container.offsetHeight || 240;
    const isVertical =
      this.votButton.position === "left" || this.votButton.position === "right";
    const gap = OverlayView.MENU_CLAMP_GAP_PX;
    const boundsLeft = Math.max(gap, boundsRect.left + gap);
    const boundsTop = Math.max(gap, boundsRect.top + gap);
    const boundsRight = Math.min(
      globalThis.innerWidth - gap,
      boundsRect.right - gap,
    );
    const boundsBottom = Math.min(
      globalThis.innerHeight - gap,
      boundsRect.bottom - gap,
    );
    const horizontalAnchorRect = opts.alignToGroup ?? anchorRect;

    const desiredLeft = isVertical
      ? this.votButton.position === "right"
        ? anchorRect.left - menuWidth - gap
        : anchorRect.right + gap
      : horizontalAnchorRect.left +
        (horizontalAnchorRect.width - menuWidth) / 2;
    const left = Math.max(
      boundsLeft,
      Math.min(Math.max(boundsLeft, boundsRight - menuWidth), desiredLeft),
    );

    const desiredTop = isVertical
      ? anchorRect.top
      : (opts.alignToGroup?.bottom ?? anchorRect.bottom) + gap;
    const fallbackTop = isVertical
      ? Math.max(boundsTop, boundsBottom - menuHeight)
      : (opts.alignToGroup?.top ?? anchorRect.top) - menuHeight - gap;
    const top = Math.max(
      boundsTop,
      Math.min(
        Math.max(boundsTop, boundsBottom - menuHeight),
        desiredTop + menuHeight <= boundsBottom
          ? desiredTop
          : Math.max(boundsTop, fallbackTop),
      ),
    );

    menu.container.style.left = `${left}px`;
    menu.container.style.top = `${top}px`;
  }

  private positionQuickMenu(): void {
    if (!this.useRailLayout || !this.votMenu || !this.votButton) {
      return;
    }

    this.positionFixedMenu(
      this.votMenu,
      this.votButton.menuButton.getBoundingClientRect(),
      {
        alignToGroup: this.votButton.container.getBoundingClientRect(),
      },
    );
  }

  private positionVoiceModeMenu(): void {
    if (
      !this.useRailLayout ||
      !this.voiceModeMenu ||
      !(this.votButton instanceof VOTRail)
    ) {
      return;
    }

    this.positionFixedMenu(
      this.voiceModeMenu,
      this.votButton.translateGroup.getBoundingClientRect(),
    );
  }

  private shouldSuppressFreshMenuInteraction(
    kind: "quick" | "voice",
    event: Event,
  ): boolean {
    const openedAt =
      kind === "quick" ? this.quickMenuOpenedAt : this.voiceModeMenuOpenedAt;
    if (!openedAt) {
      return false;
    }

    const elapsed = Date.now() - openedAt;
    if (elapsed > OverlayView.MENU_CLICK_GUARD_MS) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if ("stopImmediatePropagation" in event) {
      event.stopImmediatePropagation();
    }

    debug.log("[menu-guard] suppress fresh menu interaction", {
      kind,
      elapsed,
      type: event.type,
    });
    return true;
  }

  private syncSharedRailPlacement(): void {
    if (!this.useRailLayout || !(this.votButton instanceof VOTRail)) {
      return;
    }

    const style = this.votButton.container.style;
    style.position = "absolute";
    style.bottom = "";

    switch (this.votButton.position) {
      case "left":
        style.left = "50px";
        style.right = "";
        style.top = "12.5vh";
        style.transform = "";
        break;
      case "right":
        style.left = "";
        style.right = "0";
        style.top = "12.5vh";
        style.transform = "";
        break;
      case "top":
      case "default":
      default:
        style.left = "50%";
        style.right = "";
        style.top = "5rem";
        style.transform = "translate(-50%)";
        break;
    }
  }

  syncSubtitlesButtonUi(): this {
    if (
      !this.useRailLayout ||
      !(this.votButton instanceof VOTRail) ||
      !this.subtitlesSelect
    ) {
      return this;
    }

    this.votButton.showSubtitlesButton(true);
    return this;
  }

  private setVoiceModeMenuOpen(open: boolean): void {
    if (!this.voiceModeMenu || !(this.votButton instanceof VOTRail)) {
      return;
    }

    if (open) {
      this.votMenu!.hidden = true;
      this.votButton.menuButton.setAttribute("aria-expanded", "false");
      this.syncVoiceModeUi();
      this.voiceModeMenu.hidden = false;
      this.voiceModeMenuOpenedAt = Date.now();
      this.votButton.translateChevron.setAttribute("aria-expanded", "true");
      queueMicrotask(() => this.positionVoiceModeMenu());
      return;
    }

    this.voiceModeMenu.hidden = true;
    this.votButton.translateChevron.setAttribute("aria-expanded", "false");
  }

  syncVoiceModeUi(): this {
    if (!this.useRailLayout || !this.votButton) {
      return this;
    }

    const configuredMode = this.selectedVoiceMode;
    const actualMode = this.videoHandler?.activeVoiceMode;
    const isLoading =
      this.votButton.loading || Boolean(this.videoHandler?.hadAsyncWait);
    const hasActiveSource = Boolean(this.videoHandler?.hasActiveSource());
    const displayedMode =
      hasActiveSource && actualMode ? actualMode : configuredMode;
    const status = this.votButton.status;
    const playbackState = isLoading
      ? "loading"
      : !hasActiveSource || status === "error" || status === "disabled"
        ? "idle"
        : this.videoHandler?.video?.paused
          ? "paused"
          : "playing";

    this.votButton.container.dataset.voiceMode = displayedMode;
    this.votButton.container.dataset.voicePlaybackState = playbackState;

    if (status === "success") {
      this.votButton.setText(this.getVoiceModeLabel(displayedMode));
      this.votButtonTooltip?.setContent(this.getVoiceModeLabel(displayedMode));
    }

    if (!this.voiceModeMenu) {
      return this;
    }

    this.voiceModeMenu.setText(
      localizationProvider.get("VOTVoiceModeMenuTitle"),
    );

    for (const item of this.voiceModeMenu.bodyContainer.querySelectorAll<HTMLElement>(
      ".vot-voice-mode-menu-item",
    )) {
      const mode = item.dataset.mode === "lively" ? "lively" : "standard";
      const isSelected = mode === displayedMode;
      const title = item.querySelector<HTMLElement>(
        ".vot-voice-mode-menu-item-title",
      );
      const description = item.querySelector<HTMLElement>(
        ".vot-voice-mode-menu-item-description",
      );
      const label = this.getVoiceModeLabel(mode);

      item.dataset.selected = String(isSelected);
      item.dataset.playbackState = isSelected ? playbackState : "idle";
      item.dataset.loading = String(isSelected && isLoading);
      item.setAttribute("aria-pressed", String(isSelected));
      item.setAttribute("aria-label", label);

      if (title) {
        title.textContent = label;
      }

      if (description) {
        description.textContent = this.getVoiceModeDescription(mode);
      }
    }

    return this;
  }

  initUIEvents() {
    if (!this.isInitialized()) {
      throw new Error("[VOT] OverlayView isn't initialized");
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.checkerUnsubscribe?.();
    this.checkerUnsubscribe = this.intervalIdleChecker.subscribe(() => {
      this.onCheckerTick();
    });

    // #region [Events] VOT Button
    // Prevent button click events from propagating.
    this.votButton.container.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      { signal },
    );

    // Keyboard support for custom elements.
    const activateOnKey = (handler: () => void) => (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    };
    const isPrimaryActionPointer = (event: PointerEvent) =>
      event.isPrimary && event.button === 0;

    // Quick settings popover state helpers.
    const setMenuOpen = (
      open: boolean,
      { returnFocusToToggle = false }: { returnFocusToToggle?: boolean } = {},
    ) => {
      if (!this.isInitialized()) return;

      if (open && this.voiceModeMenu && !this.voiceModeMenu.hidden) {
        this.setVoiceModeMenuOpen(false);
      }

      this.votMenu.hidden = !open;
      this.votButton.menuButton.setAttribute("aria-expanded", open.toString());

      // The translate button tooltip is helpful when the menu is closed, but
      // becomes visual noise when the menu is open.
      if (this.votButtonTooltip) {
        this.votButtonTooltip.hidden =
          open || this.votButton.direction === "row";
      }

      if (open) {
        this.quickMenuOpenedAt = Date.now();
        if (this.useRailLayout) {
          queueMicrotask(() => this.positionQuickMenu());
        }
        queueMicrotask(() => this.openSettingsButton?.focus?.());
      } else if (returnFocusToToggle) {
        queueMicrotask(() => this.votButton.menuButton.focus?.());
      } else {
        this.votButton.menuButton.blur();
      }
    };

    const toggleMenu = () => setMenuOpen(this.votMenu.hidden);
    const closeMenu = (returnFocusToToggle = false) =>
      setMenuOpen(false, { returnFocusToToggle });

    const handleTranslate = () => {
      if (this.useRailLayout) {
        if (this.votButton?.status === "success") {
          debug.log("[voice-menu] translate button clicked while active");
          this.setVoiceModeMenuOpen(false);
          closeMenu();
          this.events["click:translate"].dispatch();
          return;
        }

        if (this.votButton?.loading) {
          debug.log("[voice-menu] translate button ignored because loading");
          return;
        }

        debug.log("[voice-menu] translate button opens voice mode menu");
        closeMenu();
        this.setVoiceModeMenuOpen(this.voiceModeMenu?.hidden ?? true);
        return;
      }

      closeMenu();
      this.events["click:translate"].dispatch();
    };

    if (this.useRailLayout) {
      this.votButton.translateButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          handleTranslate();
        },
        { signal },
      );
    } else {
      this.votButton.translateButton.addEventListener(
        "pointerdown",
        (event) => {
          if (!isPrimaryActionPointer(event)) return;
          event.preventDefault();
          handleTranslate();
        },
        { signal },
      );
    }

    this.votButton.translateButton.addEventListener(
      "keydown",
      activateOnKey(handleTranslate),
      { signal },
    );

    if (this.useRailLayout && this.votButton instanceof VOTRail) {
      const toggleVoiceModeMenu = () => {
        closeMenu();
        this.setVoiceModeMenuOpen(this.voiceModeMenu?.hidden ?? true);
      };

      this.votButton.translateChevron.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleVoiceModeMenu();
        },
        { signal },
      );

      this.votButton.translateChevron.addEventListener(
        "keydown",
        activateOnKey(toggleVoiceModeMenu),
        { signal },
      );
    }

    this.votButton.pipButton.addEventListener(
      "pointerdown",
      (event) => {
        if (!isPrimaryActionPointer(event)) return;
        this.setVoiceModeMenuOpen(false);
        closeMenu();
        this.events["click:pip"].dispatch();
      },
      { signal },
    );
    this.votButton.pipButton.addEventListener(
      "keydown",
      activateOnKey(() => {
        this.setVoiceModeMenuOpen(false);
        closeMenu();
        this.events["click:pip"].dispatch();
      }),
      { signal },
    );

    this.votButton.menuButton.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setVoiceModeMenuOpen(false);
        toggleMenu();
      },
      { signal },
    );
    this.votButton.menuButton.addEventListener(
      "keydown",
      activateOnKey(toggleMenu),
      { signal },
    );

    if (this.useRailLayout && this.votButton instanceof VOTRail) {
      const handleOpenSubtitles = () => {
        this.setVoiceModeMenuOpen(false);
        closeMenu();
        queueMicrotask(() => this.subtitlesSelect?.outer.click());
      };

      this.votButton.subtitlesButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          handleOpenSubtitles();
        },
        { signal },
      );

      this.votButton.subtitlesButton.addEventListener(
        "keydown",
        activateOnKey(handleOpenSubtitles),
        { signal },
      );
    }

    // #region [Events] VOT Button Dragging
    // Enable cross-platform dragging:
    // - Pointer Events on desktop/pen
    // - Touch Events fallback on mobile
    // Also set `touch-action: none` so browsers don't treat the gesture as a
    // scroll/pinch action.
    const touchAction = "none";
    this.votButton.container.style.touchAction = touchAction;
    // `touch-action` is not inherited, so ensure child segments are also covered.
    this.votButton.translateButton.style.touchAction = touchAction;
    this.votButton.pipButton.style.touchAction = touchAction;
    this.votButton.menuButton.style.touchAction = touchAction;
    if (this.votButton instanceof VOTRail) {
      this.votButton.translateChevron.style.touchAction = touchAction;
      this.votButton.subtitlesButton.style.touchAction = touchAction;
    }

    this.votButton.container.addEventListener("pointerdown", this.onDragStart, {
      signal,
    });
    this.votButton.container.addEventListener(
      "touchstart",
      this.onTouchDragStart,
      { signal, passive: false },
    );

    // #endregion [Events] VOT Button Dragging
    // #endregion [Events] VOT Button
    // #region [Events] VOT Menu
    this.votMenu.container.addEventListener(
      "pointerdown",
      (e) => {
        this.shouldSuppressFreshMenuInteraction("quick", e);
      },
      { signal, capture: true },
    );
    this.votMenu.container.addEventListener(
      "click",
      (e) => {
        this.shouldSuppressFreshMenuInteraction("quick", e);
      },
      { signal, capture: true },
    );
    this.votMenu.container.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      { signal },
    );

    // don't change mousedown, otherwise it may break on youtube
    for (const event of ["pointerdown", "mousedown"]) {
      this.votMenu.container.addEventListener(
        event,
        (e) => {
          e.stopImmediatePropagation();
        },
        { signal },
      );
    }

    if (this.voiceModeMenu) {
      this.voiceModeMenu.container.addEventListener(
        "pointerdown",
        (e) => {
          this.shouldSuppressFreshMenuInteraction("voice", e);
        },
        { signal, capture: true },
      );
      this.voiceModeMenu.container.addEventListener(
        "click",
        (e) => {
          this.shouldSuppressFreshMenuInteraction("voice", e);
        },
        { signal, capture: true },
      );
      this.voiceModeMenu.container.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        },
        { signal },
      );

      for (const event of ["pointerdown", "mousedown"] as const) {
        this.voiceModeMenu.container.addEventListener(
          event,
          (e) => {
            e.stopImmediatePropagation();
          },
          { signal },
        );
      }

      this.voiceModeMenu.container.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== "Escape") return;

          e.preventDefault();
          e.stopPropagation();
          this.setVoiceModeMenuOpen(false);
        },
        { signal },
      );

      for (const item of this.voiceModeMenu.bodyContainer.querySelectorAll<HTMLElement>(
        ".vot-voice-mode-menu-item",
      )) {
        const mode = item.dataset.mode === "lively" ? "lively" : "standard";
        const dispatchMode = () => {
          debug.log("[voice-menu] voice menu item clicked", { mode });
          void this.events["select:voiceMode"].dispatchAsync(mode);
          this.setVoiceModeMenuOpen(false);
        };

        item.addEventListener(
          "pointerdown",
          (event) => {
            if (!isPrimaryActionPointer(event)) return;
            event.preventDefault();
            dispatchMode();
          },
          { signal },
        );
        item.addEventListener("keydown", activateOnKey(dispatchMode), {
          signal,
        });
      }
    }

    // Close the quick-settings menu when clicking outside.
    // Capture phase ensures we run even if the host page stops bubbling.
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (this.votMenu.hidden && this.voiceModeMenu?.hidden !== false) return;

        const target = e.target as Node | null;
        const path =
          typeof e.composedPath === "function"
            ? (e.composedPath() as unknown as EventTarget[])
            : [];

        const isInsideMenu =
          (target && this.votMenu.container.contains(target)) ||
          path.includes(this.votMenu.container);
        const isInsideVoiceModeMenu =
          !!this.voiceModeMenu &&
          ((target && this.voiceModeMenu.container.contains(target)) ||
            path.includes(this.voiceModeMenu.container));
        const isInsideToggle =
          (target && this.votButton.menuButton.contains(target)) ||
          path.includes(this.votButton.menuButton);
        const isInsideVoiceToggle =
          this.votButton instanceof VOTRail &&
          ((target && this.votButton.translateGroup.contains(target)) ||
            path.includes(this.votButton.translateGroup));
        const isInsideButton =
          (target && this.votButton.container.contains(target)) ||
          path.includes(this.votButton.container);

        // Keep menu open while interacting with dialogs spawned from it
        // (language picker, etc.).
        const isInsideDialog =
          target instanceof HTMLElement &&
          !!target.closest(".vot-dialog-container");

        if (
          isInsideMenu ||
          isInsideVoiceModeMenu ||
          isInsideToggle ||
          isInsideVoiceToggle ||
          isInsideButton ||
          isInsideDialog
        ) {
          return;
        }

        closeMenu(false);
        this.setVoiceModeMenuOpen(false);
      },
      { signal, capture: true, passive: true },
    );

    // Escape closes the menu when focused inside it.
    // NOTE: We keep the WAI-ARIA pattern (return focus to the toggle) only
    // when the user is in *keyboard navigation* mode (Tab). Otherwise, ESC is
    // treated as a quick-dismiss and we blur the toggle so the auto-hide timer
    // can work as expected.
    //
    // This fixes: "ESC close doesn't auto-hide after delay; works only when
    // using the close button".
    this.votMenu.container.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;

        const keyboardNav =
          document.documentElement.classList.contains("vot-keyboard-nav");

        e.preventDefault();
        e.stopPropagation();

        closeMenu(keyboardNav);

        // Closing via keyboard doesn't trigger pointerleave/focusout reliably,
        // so we manually queue overlay auto-hide when the overlay isn't hovered.
        const hovered =
          this.votButton.container.matches(":hover") ||
          this.votMenu.container.matches(":hover") ||
          this.voiceModeMenu?.container.matches(":hover");

        if (!hovered) {
          this.videoHandler?.overlayVisibility?.queueAutoHide?.();
        }
      },
      { signal },
    );

    // #region [Events] VOT Menu Header
    this.downloadTranslationButton.addEventListener("click", () => {
      this.events["click:downloadTranslation"].dispatch();
    });

    this.downloadSubtitlesButton.addEventListener(
      "click",
      () => {
        this.events["click:downloadSubtitles"].dispatch();
      },
      { signal },
    );

    this.openSettingsButton.addEventListener(
      "click",
      () => {
        closeMenu();
        this.events["click:settings"].dispatch();
      },
      { signal },
    );

    // #endregion [Events] VOT Menu Header
    // #region [Events] VOT Menu Body
    this.languagePairSelect.fromSelect.addEventListener(
      "selectItem",
      (language) => {
        if (this.videoHandler?.videoData) {
          this.videoHandler.videoData.detectedLanguage = language;
          this.videoHandler.videoManager.rememberUserLanguageSelection(
            this.videoHandler.videoData.videoId,
            language,
          );
        }
        this.events["select:fromLanguage"].dispatch(language);
      },
    );

    this.languagePairSelect.toSelect.addEventListener(
      "selectItem",
      async (language) => {
        if (this.videoHandler?.videoData) {
          this.videoHandler.translateToLang =
            this.videoHandler.videoData.responseLanguage = language;
        }
        const prevResponseLanguage = this.data.responseLanguage;
        if (prevResponseLanguage !== language) {
          this.data.responseLanguage = language;
          await votStorage.set("responseLanguage", this.data.responseLanguage);
        }

        // UX: keep the "Don't translate from selected languages" list in sync
        // with the selected response language, but only while the list still
        // looks like the old default.
        if (
          this.data.enabledDontTranslateLanguages &&
          Array.isArray(this.data.dontTranslateLanguages) &&
          this.data.dontTranslateLanguages.length === 1 &&
          prevResponseLanguage !== language &&
          typeof prevResponseLanguage === "string" &&
          this.data.dontTranslateLanguages[0] === prevResponseLanguage
        ) {
          this.data.dontTranslateLanguages = [language];
          await votStorage.set(
            "dontTranslateLanguages",
            this.data.dontTranslateLanguages,
          );
        }
        this.events["select:toLanguage"].dispatch(language);
      },
    );

    this.subtitlesSelect.addEventListener("beforeOpen", async (dialog) => {
      if (!this.videoHandler?.videoData) {
        return;
      }

      const cacheKey = this.videoHandler.getSubtitlesCacheKey(
        this.videoHandler.videoData.videoId,
        this.videoHandler.videoData.detectedLanguage,
        this.videoHandler.videoData.responseLanguage,
      );
      if (this.videoHandler.subtitlesCacheKey === cacheKey) {
        return;
      }

      if (this.videoHandler.cacheManager.getSubtitles(cacheKey) !== undefined) {
        await this.videoHandler.ensureSubtitlesForCurrentLangPair();
        return;
      }

      const prevLoading = this.votButton?.loading ?? false;
      if (this.votButton) {
        this.votButton.loading = true;
      }
      const loadingEl = ui.createInlineLoader();
      loadingEl.style.margin = "0 auto";
      dialog.footerContainer.appendChild(loadingEl);
      try {
        await this.videoHandler.ensureSubtitlesForCurrentLangPair();
      } finally {
        loadingEl.remove();
        if (this.votButton) {
          this.votButton.loading = prevLoading;
        }
        this.syncVoiceModeUi();
      }
    });

    this.subtitlesSelect.addEventListener("selectItem", (data) => {
      this.events["select:subtitles"].dispatch(data);
    });

    this.videoVolumeSlider.addEventListener("input", (value, fromSetter) => {
      if (this.videoVolumeSliderLabel) {
        this.videoVolumeSliderLabel.value = value;
      }
      if (fromSetter) {
        return;
      }

      this.events["input:videoVolume"].dispatch(value);
    });

    this.translationVolumeSlider.addEventListener(
      "input",
      (value, fromSetter) => {
        if (this.translationVolumeSliderLabel) {
          this.translationVolumeSliderLabel.value = value;
        }
        if (this.data.defaultVolume !== value) {
          this.data.defaultVolume = value;
          this.scheduleDefaultVolumePersist();
        }
        if (fromSetter) {
          return;
        }

        this.events["input:translationVolume"].dispatch(value);
      },
    );

    if (this.useRailLayout && this.videoHandler?.video) {
      const syncRailUi = () => this.syncVoiceModeUi();
      for (const eventName of [
        "play",
        "pause",
        "waiting",
        "playing",
        "ended",
      ] as const) {
        this.videoHandler.video.addEventListener(eventName, syncRailUi, {
          signal,
        });
      }
    }

    // #endregion [Events] VOT Menu Body
    // #endregion [Events] VOT Menu
    return this;
  }

  updateButtonLayout(position: Position, direction: Direction) {
    if (!this.isInitialized()) {
      return this;
    }

    this.votMenu.position = position;

    this.votButton.position = position;
    this.votButton.direction = direction;
    this.syncSharedRailPlacement();

    this.votButtonTooltip.hidden = direction === "row";
    this.votButtonTooltip.setPosition(this.votButton.tooltipPos);
    this.syncVoiceModeUi();
    if (!this.votMenu.hidden) {
      queueMicrotask(() => this.positionQuickMenu());
    }
    if (this.voiceModeMenu && !this.voiceModeMenu.hidden) {
      queueMicrotask(() => this.positionVoiceModeMenu());
    }

    return this;
  }

  moveButton(percentX: number) {
    if (!this.isInitialized()) {
      return this;
    }

    const isBigContainer = this.dragIsBigContainer ?? this.isBigContainer;
    const position = VOTButton.calcPosition(percentX, isBigContainer);
    if (position === this.votButton.position) {
      return this;
    }

    const direction = VOTButton.calcDirection(position);
    this.data.buttonPos = position;
    this.updateButtonLayout(position, direction);

    return this;
  }

  private startDragSession(
    clientX: number,
    clientY: number,
    activitySource: string,
  ): void {
    this.dragCandidate = true;
    this.dragging = false;
    this.dragStartX = clientX;
    this.dragStartY = clientY;
    this.currentClientX = clientX;

    this.containerRect = this.root.getBoundingClientRect();
    this.dragIsBigContainer = this.isBigContainer;
    this.dragDirty = false;
    this.intervalIdleChecker.markActivity(activitySource);
    this.intervalIdleChecker.requestImmediateTick();
  }

  private queueDragTick(activitySource: string): void {
    if (this.dragDirty) {
      return;
    }

    this.dragDirty = true;
    this.intervalIdleChecker.markActivity(activitySource);
    this.intervalIdleChecker.requestImmediateTick();
  }

  private updateDragFromMove(
    clientX: number,
    clientY: number,
    activitySource: string,
  ): void {
    this.currentClientX = clientX;

    if (!this.dragCandidate) return;

    if (!this.dragging) {
      const dx = Math.abs(this.currentClientX - this.dragStartX);
      const dy = Math.abs(clientY - this.dragStartY);
      if (dx + dy >= this.dragThresholdPx) {
        this.dragging = true;
      }
    }

    if (!this.dragging) {
      return;
    }

    this.queueDragTick(activitySource);
  }

  onDragStart = (event: PointerEvent) => {
    // Only start drag on the primary pointer and the "primary" button.
    // (For touch pointers, `button` is 0.)
    if (!event.isPrimary || event.button !== 0) return;

    // On touch devices we prefer Touch Events for dragging (better compatibility
    // with browser gesture handling and passive listener defaults).
    if (event.pointerType === "touch") return;

    event.preventDefault();

    this.startDragSession(event.clientX, event.clientY, "overlay-pointer-down");

    document.addEventListener("pointermove", this.onGlobalPointerMove, {
      passive: true,
    });
    document.addEventListener("pointerup", this.onDragEnd);
    document.addEventListener("pointercancel", this.onDragEnd);
  };

  // Touch fallback for browsers/environments that don't deliver Pointer Events
  // reliably on mobile. We only use the first active touch.
  onTouchDragStart = (event: TouchEvent) => {
    if (!event.touches || event.touches.length === 0) return;

    const touch = event.touches[0];
    this.startDragSession(touch.clientX, touch.clientY, "overlay-touch-start");

    // Register non-passive move listener so we can call preventDefault()
    // once we detect an actual drag.
    document.addEventListener("touchmove", this.onGlobalTouchMove, {
      passive: false,
    });
    document.addEventListener("touchend", this.onDragEnd);
    document.addEventListener("touchcancel", this.onDragEnd);
  };

  onGlobalTouchMove = (event: TouchEvent) => {
    if (!event.touches || event.touches.length === 0) return;
    const t = event.touches[0];
    this.updateDragFromMove(t.clientX, t.clientY, "overlay-touch-move");

    // Only prevent page scrolling once we're sure the user is dragging.
    if (this.dragging) {
      event.preventDefault();
    }
  };

  onGlobalPointerMove = (event: PointerEvent) => {
    this.updateDragFromMove(
      event.clientX,
      event.clientY,
      "overlay-pointer-move",
    );
  };

  private readonly applyDragFromState = () => {
    if (!this.dragging || !this.dragDirty || !this.containerRect) return;

    const width = this.containerRect.width;
    if (!(width > 0 && Number.isFinite(width))) {
      return;
    }

    this.dragDirty = false;
    const x = this.currentClientX - this.containerRect.left;
    const clampedX = Math.max(0, Math.min(x, width));
    const percentX = (clampedX / width) * 100;

    this.moveButton(percentX);
  };

  private readonly onCheckerTick = () => {
    this.applyDragFromState();
  };

  onDragEnd = () => {
    document.removeEventListener("pointermove", this.onGlobalPointerMove);
    document.removeEventListener("pointerup", this.onDragEnd);
    document.removeEventListener("pointercancel", this.onDragEnd);

    document.removeEventListener("touchmove", this.onGlobalTouchMove);
    document.removeEventListener("touchend", this.onDragEnd);
    document.removeEventListener("touchcancel", this.onDragEnd);
    this.applyDragFromState();

    const isBigContainer = this.dragIsBigContainer ?? this.isBigContainer;
    if (this.dragging && isBigContainer && this.data.buttonPos) {
      void votStorage.set("buttonPos", this.data.buttonPos);
    }

    this.dragging = false;
    this.dragCandidate = false;
    this.dragDirty = false;
    this.containerRect = null;
    this.dragIsBigContainer = null;
  };

  updateButtonOpacity(opacity: number) {
    if (!this.isInitialized() || !this.votMenu.hidden) {
      return this;
    }

    // Avoid redundant style writes on high-frequency interaction events.
    if (Math.abs(this.votButton.opacity - opacity) > 0.01) {
      this.votButton.opacity = opacity;
    }
    return this;
  }

  private doReleaseUI(): void {
    if (this.shouldLogMobileOverlay()) {
      console.log("[VOT][mobile-overlay][ui] remove overlay UI nodes", {
        hasButton: Boolean(this.votButton?.container?.isConnected),
        hasMenu: Boolean(this.votMenu?.container?.isConnected),
      });
    }
    this.votButton?.remove();
    this.votMenu?.remove();
    this.voiceModeMenu?.remove();
    this.votButtonTooltip?.release();
  }

  private doReleaseUIEvents(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.checkerUnsubscribe?.();
    this.checkerUnsubscribe = null;

    this.onDragEnd();
    this.flushDefaultVolumePersist();

    for (const event of Object.values(this.events)) {
      event.clear();
    }
  }

  release() {
    if (!this.isInitialized()) {
      return this;
    }

    if (this.shouldLogMobileOverlay()) {
      console.log("[VOT][mobile-overlay][ui] overlay view release");
    }
    // Release events first to prevent late handlers from touching removed DOM.
    this.doReleaseUIEvents();
    this.doReleaseUI();

    this.initialized = false;
    return this;
  }

  get isBigContainer() {
    const widthFromVideo =
      this.videoHandler?.video?.getBoundingClientRect?.().width;
    if (typeof widthFromVideo === "number" && Number.isFinite(widthFromVideo)) {
      return widthFromVideo > OverlayView.BIG_CONTAINER_WIDTH_PX;
    }

    const widthFromContainer =
      this.videoHandler?.container?.getBoundingClientRect?.().width;
    if (
      typeof widthFromContainer === "number" &&
      Number.isFinite(widthFromContainer)
    ) {
      return widthFromContainer > OverlayView.BIG_CONTAINER_WIDTH_PX;
    }

    return this.root.clientWidth > OverlayView.BIG_CONTAINER_WIDTH_PX;
  }

  get pipButtonVisible() {
    return isPiPAvailable() && !!this.data.showPiPButton;
  }
}

function isSidePosition(position: Position): position is "left" | "right" {
  return position === "left" || position === "right";
}
