import type { VideoHandler } from "..";
import {
  actualCompatVersion,
  maxAudioVolume,
  repositoryUrl,
} from "../config/config";
import { localizationProvider } from "../localization/localizationProvider";
import { serializeProcessedSubtitles } from "../subtitles/standards";
import type { Status } from "../types/components/votButton";
import type { StorageData } from "../types/storage";
import type { OverlayMount, UIManagerProps } from "../types/uiManager";
import ui from "../ui";
import debug from "../utils/debug";
import { resolveScopedFullscreenElement } from "../utils/dom";
import { downloadTranslation } from "../utils/download";
import { GM_fetch } from "../utils/gm";
import type { IntervalIdleChecker } from "../utils/intervalIdleChecker";
import { votStorage } from "../utils/storage";
import {
  clamp,
  clearFileName,
  type DownloadBlobOptions,
  downloadBlob,
} from "../utils/utils";
import VOTLocalizedError from "../utils/VOTLocalizedError";
import { applyOverlayMountUpdate } from "./mount";
import { OverlayView } from "./views/overlay";
import { SettingsView } from "./views/settings";

export class UIManager {
  mount: OverlayMount;
  private translationActionInFlight = false;

  private overlayEventsBound = false;
  private settingsEventsBound = false;
  private initialized = false;
  private readonly videoHandler?: VideoHandler;
  private readonly intervalIdleChecker: IntervalIdleChecker;
  data: Partial<StorageData>;

  votGlobalPortal?: HTMLElement;
  /**
   * Contains all elements over video player e.g. button, menu and etc
   */
  votOverlayView?: OverlayView;
  /**
   * Dialog settings menu
   */
  votSettingsView?: SettingsView;

  constructor({
    mount,
    data = {},
    videoHandler,
    intervalIdleChecker,
  }: UIManagerProps) {
    this.mount = mount;
    this.videoHandler = videoHandler;
    this.data = data;
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

  private getSubtitlesMountContainer(): HTMLElement {
    return this.mount.subtitlesMountContainer;
  }

  isInitialized(): this is {
    votGlobalPortal: HTMLElement;
    votOverlayView: OverlayView;
    votSettingsView: SettingsView;
  } {
    return this.initialized;
  }

  initUI() {
    if (this.isInitialized()) {
      throw new Error("[VOT] UIManager is already initialized");
    }

    this.initialized = true;

    this.votGlobalPortal = ui.createPortal();
    this.getGlobalPortalHost(this.mount).appendChild(this.votGlobalPortal);

    this.votOverlayView = new OverlayView({
      mount: this.mount,
      globalPortal: this.votGlobalPortal,
      data: this.data,
      videoHandler: this.videoHandler,
      intervalIdleChecker: this.intervalIdleChecker,
    });
    // Preserve the user's last chosen button position across UI reloads
    // (e.g. when changing the menu language).
    this.votOverlayView.initUI(this.data.buttonPos ?? "default");

    this.votSettingsView = new SettingsView({
      globalPortal: this.votGlobalPortal,
      data: this.data,
      videoHandler: this.videoHandler,
    });
    this.votSettingsView.initUI();

    this.videoHandler?.subtitlesWidget?.updateMount({
      container: this.getSubtitlesMountContainer(),
      tooltipLayoutRoot: this.mount.tooltipLayoutRoot,
    });

    return this;
  }

  updateMount(mount: OverlayMount) {
    const globalPortalHost = this.getGlobalPortalHost(mount);
    if (this.votGlobalPortal?.parentElement !== globalPortalHost) {
      globalPortalHost.appendChild(this.votGlobalPortal);
    }

    this.mount = applyOverlayMountUpdate(this.mount, mount, (nextMount) => {
      this.votOverlayView?.updateMount(nextMount);
    });

    this.videoHandler?.subtitlesWidget?.updateMount({
      container: this.getSubtitlesMountContainer(),
      tooltipLayoutRoot: mount.tooltipLayoutRoot,
    });

    return this;
  }

  private getGlobalPortalHost(mount: OverlayMount): HTMLElement {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    const fullscreenEl = doc.fullscreenElement ?? doc.webkitFullscreenElement;
    const isCurrentVideoFullscreen = Boolean(
      resolveScopedFullscreenElement(fullscreenEl, [mount.root], {
        allowDocumentViewport: true,
      }),
    );
    return isCurrentVideoFullscreen ? mount.root : document.documentElement;
  }

  initUIEvents() {
    if (!this.isInitialized()) {
      throw new Error("[VOT] UIManager isn't initialized");
    }

    this.votOverlayView.initUIEvents();
    if (!this.overlayEventsBound) {
      this.bindOverlayViewEvents();
      this.overlayEventsBound = true;
    }

    this.votSettingsView.initUIEvents();
    if (!this.settingsEventsBound) {
      this.bindSettingsViewEvents();
      this.settingsEventsBound = true;
    }
  }

  private bindOverlayViewEvents() {
    const overlayView = this.votOverlayView;
    if (!overlayView) {
      return;
    }

    overlayView
      .addEventListener("click:translate", async () => {
        await this.handleTranslationBtnClick();
      })
      .addEventListener("click:pip", async () => {
        if (!this.videoHandler) {
          return;
        }

        try {
          const isPiPActive =
            this.videoHandler.video === document.pictureInPictureElement;
          await (isPiPActive
            ? document.exitPictureInPicture()
            : this.videoHandler.video.requestPictureInPicture());
        } catch (err) {
          debug.warn("[VOT] Failed to toggle Picture-in-Picture", err);
        }
      })
      .addEventListener("click:subtitles", async () => {
        if (!this.videoHandler) {
          return;
        }

        try {
          await this.videoHandler.toggleSubtitlesForCurrentLangPair();
        } catch (err) {
          debug.warn("[VOT] Failed to toggle subtitles", err);
        }
      })
      .addEventListener("click:settings", async () => {
        this.videoHandler?.subtitlesWidget?.releaseTooltip();
        this.videoHandler?.overlayVisibility?.cancel();
        this.videoHandler?.overlayVisibility?.show();
        this.votSettingsView.open();
      })
      .addEventListener("click:downloadTranslation", async () => {
        await this.handleDownloadTranslationClick();
      })
      .addEventListener("click:downloadSubtitles", async () => {
        await this.handleDownloadSubtitlesClick();
      })
      .addEventListener("select:voiceMode", async (mode) => {
        const livelyEnabled = mode === "lively";
        if (livelyEnabled && !this.data.account?.token) {
          this.videoHandler?.subtitlesWidget?.releaseTooltip();
          this.videoHandler?.overlayVisibility?.cancel();
          this.videoHandler?.overlayVisibility?.show();
          this.votSettingsView.open();
          return;
        }

        const previousMode = this.data.useLivelyVoice ? "lively" : "standard";
        debug.log("[voice-menu] selected mode", {
          previousMode,
          mode,
          translationActive: this.videoHandler?.hasActiveSource() ?? false,
          translationBusy: this.isTranslationBusy(),
        });
        this.data.useLivelyVoice = livelyEnabled;
        if (this.votSettingsView.useLivelyVoiceCheckbox) {
          this.votSettingsView.useLivelyVoiceCheckbox.checked = livelyEnabled;
        }
        this.votOverlayView?.syncVoiceModeUi();

        if (!this.videoHandler) {
          this.runDetached(
            votStorage.set("useLivelyVoice", livelyEnabled),
            "Failed to persist voice mode selection",
          );
          return;
        }

        try {
          debug.log("[voice-menu] applyVoiceModeSelection called", {
            previousMode,
            nextMode: mode,
            startWhenIdle: true,
          });
          await this.applyVoiceModeSelection(previousMode, mode, {
            startWhenIdle: true,
          });
        } catch (err) {
          debug.warn("[voice-menu] translation failed", err);
          debug.warn("[VOT] Failed to apply voice mode selection", err);
        } finally {
          this.runDetached(
            votStorage.set("useLivelyVoice", livelyEnabled),
            "Failed to persist voice mode selection",
          );
        }
      })
      .addEventListener("input:videoVolume", (volume) => {
        if (!this.videoHandler) {
          return;
        }

        this.videoHandler.setVideoVolume(volume / 100);
        if (!this.data.syncVolume) {
          this.videoHandler.onVideoVolumeSliderSynced(volume);
          return;
        }

        this.videoHandler.syncVolumeWrapper("video", volume);
      })
      .addEventListener("input:translationVolume", (volume) => {
        if (!this.videoHandler) {
          return;
        }

        // Prefer the actual event payload (the overlay also updates `data`, but
        // using the payload is simpler and avoids accidental desyncs).
        const nextVolume = volume ?? this.data.defaultVolume ?? 100;
        this.videoHandler.syncTranslationPlaybackVolume();
        if (!this.data.syncVolume) {
          this.videoHandler.onTranslationVolumeSliderSynced(nextVolume);
          return;
        }
        const syncResult = this.videoHandler.syncVolumeWrapper(
          "translation",
          nextVolume,
        );
        if (typeof syncResult?.nextVideo === "number") {
          this.videoHandler.applyManualVideoVolumeOverride(
            syncResult.nextVideo / 100,
          );
        }
      })
      .addEventListener("select:subtitles", (data) => {
        if (!this.videoHandler) {
          return;
        }

        this.runDetached(
          this.videoHandler.changeSubtitlesLang(data),
          "Failed to change subtitles language",
        );
      });
  }

  private snapshotDriveSelectItems(select: any) {
    const rawItems = Array.isArray(select?._items) ? select._items : [];
    return rawItems.map((item: any) => ({
      label: String(item?.label ?? ""),
      value: String(item?.value ?? ""),
      selected: item?.selected === true,
      disabled: item?.disabled === true,
    }));
  }

  getDriveQuickMenuState() {
    const overlayView = this.votOverlayView;
    if (!overlayView?.isInitialized()) {
      return null;
    }

    const fromSelect = overlayView.languagePairSelect?.fromSelect as any;
    const toSelect = overlayView.languagePairSelect?.toSelect as any;
    const subtitlesSelect = overlayView.subtitlesSelect as any;
    const videoVolumeSlider = overlayView.videoVolumeSlider;
    const translationVolumeSlider = overlayView.translationVolumeSlider;

    return {
      fromItems: this.snapshotDriveSelectItems(fromSelect),
      toItems: this.snapshotDriveSelectItems(toSelect),
      subtitlesItems: this.snapshotDriveSelectItems(subtitlesSelect),
      videoVolume: Math.round(
        videoVolumeSlider?.value ??
          (this.videoHandler?.getVideoVolume?.() ?? 1) * 100,
      ),
      translationVolume: Math.round(
        translationVolumeSlider?.value ?? this.data.defaultVolume ?? 100,
      ),
      translationVolumeMax:
        translationVolumeSlider?.max ??
        (this.data.audioBooster ? maxAudioVolume : 100),
      showVideoSlider:
        !videoVolumeSlider?.hidden && Boolean(this.data.showVideoSlider),
    };
  }

  getDriveVoiceState() {
    const configuredMode = this.data.useLivelyVoice ? "lively" : "standard";
    const actualMode = this.videoHandler?.activeVoiceMode;
    const displayedMode =
      this.videoHandler?.hasActiveSource() && actualMode
        ? actualMode
        : configuredMode;
    const buttonStatus = this.votOverlayView?.votButton?.status ?? "none";
    const isLoading =
      this.votOverlayView?.votButton?.loading === true ||
      Boolean(this.videoHandler?.hadAsyncWait);

    if (isLoading) {
      return {
        voiceMode: displayedMode,
        voicePlaybackState: "loading",
        loading: true,
      } as const;
    }

    if (!this.videoHandler?.hasActiveSource()) {
      return {
        voiceMode: displayedMode,
        voicePlaybackState: "idle",
        loading: false,
      } as const;
    }

    if (buttonStatus === "error" || buttonStatus === "disabled") {
      return {
        voiceMode: displayedMode,
        voicePlaybackState: "idle",
        loading: false,
      } as const;
    }

    return {
      voiceMode: displayedMode,
      voicePlaybackState: this.videoHandler.video?.paused
        ? "paused"
        : "playing",
      loading: false,
    } as const;
  }

  private isTranslationBusy(): boolean {
    return Boolean(
      this.translationActionInFlight ||
        this.votOverlayView?.votButton?.loading === true ||
        this.videoHandler?.hadAsyncWait,
    );
  }

  private async waitForTranslationActionSettled(timeoutMs = 2000) {
    const startedAt = Date.now();
    while (this.isTranslationBusy()) {
      if (Date.now() - startedAt >= timeoutMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async startTranslationFlow(videoHandler: VideoHandler) {
    debug.log("[voice-menu] startTranslationFlow called", {
      status: this.votOverlayView?.votButton.status,
      loading: this.votOverlayView?.votButton.loading ?? false,
      hasActiveSource: videoHandler.hasActiveSource(),
      activeTranslation: Boolean(videoHandler.activeTranslation),
    });
    const sourceAudioState = videoHandler.syncSourceAudioAvailabilityUi({
      forceVisible: true,
    });
    if (!sourceAudioState.ready) {
      debug.warn("[voice-menu] startTranslationFlow early return reason", {
        reason: "source-audio-not-ready",
        state: sourceAudioState,
      });
      return;
    }
    if (this.votOverlayView!.votButton.status === "disabled") {
      this.transformBtn("none", localizationProvider.get("translateVideo"));
    }

    if (this.votOverlayView!.votButton.status === "error") {
      this.transformBtn("none", localizationProvider.get("translateVideo"));
    } else if (
      this.votOverlayView!.votButton.status !== "disabled" &&
      this.votOverlayView!.votButton.status !== "none" &&
      !videoHandler.hasActiveSource()
    ) {
      debug.log("[startTranslationFlow] reset stale button state");
      this.transformBtn("none", localizationProvider.get("translateVideo"));
    }

    debug.log("[startTranslationFlow] trying execute translation");

    await videoHandler.primePlaybackByGesture("translate-button");

    const videoData = await this.getVideoDataForTranslation(videoHandler);
    await videoHandler.videoManager.ensureDetectedLanguageForTranslation(
      videoData,
    );

    debug.log("[startTranslationFlow] Run translateFunc", videoData.videoId);

    try {
      await videoHandler.translateFunc(
        videoData.videoId,
        videoData.isStream,
        videoData.detectedLanguage,
        videoData.responseLanguage,
        videoData.translationHelp,
      );
      debug.log("[voice-menu] translation started", {
        videoId: videoData.videoId,
        hasActiveSource: videoHandler.hasActiveSource(),
        loading: this.votOverlayView?.votButton.loading ?? false,
        activeTranslation: Boolean(videoHandler.activeTranslation),
      });
    } catch (err) {
      debug.warn("[voice-menu] translation failed", err);
      throw err;
    }
  }

  private async applyVoiceModeSelection(
    previousMode: "standard" | "lively",
    nextMode: "standard" | "lively",
    options: { startWhenIdle?: boolean } = {},
  ) {
    const videoHandler = this.videoHandler;
    if (!videoHandler) {
      return;
    }

    const { startWhenIdle = false } = options;
    const hasActiveSource = videoHandler.hasActiveSource();
    const isBusy = this.isTranslationBusy();

    debug.log("[voice-menu] applyVoiceModeSelection called", {
      previousMode,
      nextMode,
      startWhenIdle,
      hasActiveSource,
      isBusy,
      loading: this.votOverlayView?.votButton.loading ?? false,
      translationActionInFlight: this.translationActionInFlight,
    });

    if (!hasActiveSource && !isBusy && !startWhenIdle) {
      debug.warn("[voice-menu] startTranslationFlow early return reason", {
        reason: "idle-and-startWhenIdle-disabled",
      });
      return;
    }

    if (previousMode === nextMode && hasActiveSource && !isBusy) {
      debug.warn("[voice-menu] startTranslationFlow early return reason", {
        reason: "same-mode-while-translation-active",
      });
      return;
    }

    try {
      await videoHandler.primePlaybackByGesture("voice-mode-selection");
    } catch (err) {
      debug.warn(
        "[VOT] Failed to prime playback before voice mode switch",
        err,
      );
    }

    if (hasActiveSource || isBusy) {
      try {
        await videoHandler.stopTranslation();
        await videoHandler.waitForPendingStopTranslate();
        await this.waitForTranslationActionSettled();
      } catch (err) {
        debug.warn(
          "[VOT] Failed to stop translation before voice mode restart",
          err,
        );
      }
    }

    if (videoHandler.hasActiveSource()) {
      debug.warn("[voice-menu] startTranslationFlow early return reason", {
        reason: "active-source-still-present-after-stop",
      });
      return;
    }

    if (this.translationActionInFlight) {
      await this.waitForTranslationActionSettled();
    }

    if (this.translationActionInFlight) {
      debug.warn("[voice-menu] startTranslationFlow early return reason", {
        reason: "translation-action-still-in-flight",
      });
      return;
    }

    this.translationActionInFlight = true;
    try {
      await this.startTranslationFlow(videoHandler);
    } finally {
      this.translationActionInFlight = false;
    }
  }

  private async restartDriveTranslationIfActive() {
    const videoHandler = this.videoHandler;
    if (!videoHandler || !this.votOverlayView?.isInitialized()) {
      return;
    }

    if (!videoHandler.hasActiveSource()) {
      return;
    }

    try {
      await videoHandler.stopTranslation();
      await videoHandler.waitForPendingStopTranslate();
      await this.waitForTranslationActionSettled();
      await this.handleTranslationBtnClick();
    } catch (err) {
      debug.warn("[VOT] Failed to restart translation after Drive change", err);
    }
  }

  async applyDriveFromLanguage(value: string) {
    if (!this.videoHandler) {
      return;
    }

    if (this.videoHandler.videoData) {
      this.videoHandler.videoManager.rememberUserLanguageSelection(
        this.videoHandler.videoData.videoId,
        value as any,
      );
    }

    this.videoHandler.setSelectMenuValues(
      value as any,
      this.videoHandler.videoData?.responseLanguage ??
        this.videoHandler.translateToLang,
    );
    await this.videoHandler.ensureSubtitlesForCurrentLangPair?.();
    await this.videoHandler.updateSubtitlesLangSelect?.();
    await this.restartDriveTranslationIfActive();
  }

  async applyDriveToLanguage(value: string) {
    if (!this.videoHandler) {
      return;
    }

    this.data.responseLanguage = value as any;
    void votStorage.set("responseLanguage", value as any);

    this.videoHandler.setSelectMenuValues(
      (this.videoHandler.videoData?.detectedLanguage ??
        this.videoHandler.translateFromLang) as any,
      value as any,
    );
    await this.videoHandler.ensureSubtitlesForCurrentLangPair?.();
    await this.videoHandler.updateSubtitlesLangSelect?.();
    await this.restartDriveTranslationIfActive();
  }

  async applyDriveSubtitles(value: string) {
    if (!this.videoHandler) {
      return;
    }

    await this.videoHandler.changeSubtitlesLang(value);
  }

  applyDriveVideoVolume(volume: number) {
    if (!this.videoHandler) {
      return;
    }

    const overlayView = this.votOverlayView;
    const nextVolume = clamp(Math.round(volume), 0, 100);
    if (overlayView?.isInitialized() && overlayView.videoVolumeSlider) {
      overlayView.videoVolumeSlider.value = nextVolume;
    }

    this.videoHandler.setVideoVolume(nextVolume / 100);
    if (!this.data.syncVolume) {
      this.videoHandler.onVideoVolumeSliderSynced(nextVolume);
      return;
    }

    this.videoHandler.syncVolumeWrapper("video", nextVolume);
  }

  applyDriveTranslationVolume(volume: number) {
    if (!this.videoHandler) {
      return;
    }

    const overlayView = this.votOverlayView;
    const maxVolume =
      overlayView?.isInitialized() && overlayView.translationVolumeSlider
        ? overlayView.translationVolumeSlider.max
        : this.data.audioBooster
          ? maxAudioVolume
          : 100;
    const nextVolume = clamp(Math.round(volume), 0, maxVolume);

    if (overlayView?.isInitialized() && overlayView.translationVolumeSlider) {
      overlayView.translationVolumeSlider.value = nextVolume;
    } else if (this.data.defaultVolume !== nextVolume) {
      this.data.defaultVolume = nextVolume;
      void votStorage.set("defaultVolume", nextVolume);
    }

    this.videoHandler.syncTranslationPlaybackVolume();
    if (!this.data.syncVolume) {
      this.videoHandler.onTranslationVolumeSliderSynced(nextVolume);
      return;
    }

    const syncResult = this.videoHandler.syncVolumeWrapper(
      "translation",
      nextVolume,
    );
    if (typeof syncResult?.nextVideo === "number") {
      this.videoHandler.applyManualVideoVolumeOverride(
        syncResult.nextVideo / 100,
      );
    }
  }

  applyDriveSyncVolume(enabled: boolean) {
    if (!this.videoHandler) {
      return;
    }

    this.data.syncVolume = enabled;
    this.videoHandler.setupAudioSettings();
    if (!enabled) {
      return;
    }

    this.withInitializedOverlayView((overlayView) => {
      const videoSlider = overlayView.videoVolumeSlider;
      const translationSlider = overlayView.translationVolumeSlider;
      if (!videoSlider || !translationSlider) {
        return;
      }

      this.videoHandler!.syncTranslationPlaybackVolume();
      this.videoHandler!.resetVolumeLinkState(
        Number(videoSlider.value),
        Number(translationSlider.value),
      );
    });
  }

  applyDriveShowVideoSlider(checked: boolean) {
    this.data.showVideoSlider = checked;

    this.withInitializedOverlayView((overlayView) => {
      if (!overlayView.videoVolumeSlider || !overlayView.votButton) {
        return;
      }

      overlayView.videoVolumeSlider.container.hidden =
        !this.data.showVideoSlider ||
        overlayView.votButton.status !== "success";
    });
  }

  applyDriveAudioBooster(enabled: boolean) {
    this.data.audioBooster = enabled;

    this.withInitializedOverlayView((overlayView) => {
      if (!overlayView.translationVolumeSlider) {
        return;
      }

      const currentVolume = overlayView.translationVolumeSlider.value;
      const maxVolume = this.data.audioBooster ? maxAudioVolume : 100;
      overlayView.translationVolumeSlider.max = maxVolume;
      const nextVolume = clamp(currentVolume, 0, maxVolume);
      overlayView.translationVolumeSlider.value = nextVolume;
      this.videoHandler?.onTranslationVolumeSliderSynced(nextVolume);
      this.videoHandler?.syncTranslationPlaybackVolume();
    });
  }

  async applyDriveUseLivelyVoice(enabled: boolean) {
    const previousMode = this.data.useLivelyVoice ? "lively" : "standard";
    const nextMode = enabled ? "lively" : "standard";
    this.data.useLivelyVoice = enabled;

    if (!this.videoHandler) {
      return;
    }

    if (!this.videoHandler.hasActiveSource() && !this.isTranslationBusy()) {
      return;
    }

    await this.applyVoiceModeSelection(previousMode, nextMode);
  }

  private bindSettingsViewEvents() {
    const settingsView = this.votSettingsView;
    if (!settingsView) {
      return;
    }

    settingsView
      .addEventListener("update:account", async (account) => {
        if (!this.videoHandler) {
          return;
        }

        this.videoHandler.votClient.apiToken = account?.token;
      })
      .addEventListener("change:autoTranslate", async (checked) => {
        const videoHandler = this.videoHandler;
        if (checked && videoHandler && !videoHandler.hasActiveSource()) {
          await this.handleTranslationBtnClick();
        }
      })
      .addEventListener("change:autoSubtitles", async (checked) => {
        if (!checked || !this.videoHandler?.videoData?.videoId) {
          return;
        }

        await this.videoHandler.enableSubtitlesForCurrentLangPair();
      })
      .addEventListener("change:showVideoVolume", () => {
        this.withInitializedOverlayView((overlayView) => {
          if (!overlayView.videoVolumeSlider || !overlayView.votButton) {
            return;
          }

          overlayView.videoVolumeSlider.container.hidden =
            !this.data.showVideoSlider ||
            overlayView.votButton.status !== "success";
        });
      })
      .addEventListener("change:audioBooster", async () => {
        this.withInitializedOverlayView((overlayView) => {
          if (!overlayView.translationVolumeSlider) {
            return;
          }

          const currentVolume = overlayView.translationVolumeSlider.value;
          const maxVolume = this.data.audioBooster ? maxAudioVolume : 100;
          overlayView.translationVolumeSlider.max = maxVolume;
          const nextVolume = clamp(currentVolume, 0, maxVolume);
          overlayView.translationVolumeSlider.value = nextVolume;
          this.videoHandler?.onTranslationVolumeSliderSynced(nextVolume);
          this.videoHandler?.syncTranslationPlaybackVolume();
        });
      })
      .addEventListener("change:syncVolume", (checked) => {
        if (!this.videoHandler) {
          return;
        }
        this.videoHandler.setupAudioSettings();
        if (!checked) {
          return;
        }

        this.withInitializedOverlayView((overlayView) => {
          const videoSlider = overlayView.videoVolumeSlider;
          const translationSlider = overlayView.translationVolumeSlider;
          if (!videoSlider || !translationSlider) {
            return;
          }

          this.videoHandler.syncTranslationPlaybackVolume();

          this.videoHandler.resetVolumeLinkState(
            Number(videoSlider.value),
            Number(translationSlider.value),
          );
        });
      })
      .addEventListener("change:useLivelyVoice", (checked) => {
        if (!this.videoHandler) {
          return;
        }

        this.votOverlayView?.syncVoiceModeUi();

        const nextMode = checked ? "lively" : "standard";
        const previousMode = checked ? "standard" : "lively";

        this.runDetached(
          this.applyVoiceModeSelection(previousMode, nextMode),
          "Failed to apply voice mode change",
        );
      })
      .addEventListener("change:subtitlesHighlightWords", (checked) => {
        this.updateSubtitlesWidgetSetting(
          checked,
          this.data.highlightWords,
          (widget, value) => {
            widget.setHighlightWords(value);
          },
        );
      })
      .addEventListener("change:subtitlesSmartLayout", (checked) => {
        this.updateSubtitlesWidgetSetting(
          checked,
          this.data.subtitlesSmartLayout,
          (widget, value) => {
            widget.setSmartLayout(value);
          },
        );
      })
      .addEventListener("input:subtitlesMaxLength", (value) => {
        this.updateSubtitlesWidgetSetting(
          value,
          this.data.subtitlesMaxLength,
          (widget, nextValue) => {
            widget.setMaxLength(nextValue);
          },
        );
      })
      .addEventListener("input:subtitlesFontSize", (value) => {
        this.updateSubtitlesWidgetSetting(
          value,
          this.data.subtitlesFontSize,
          (widget, nextValue) => {
            widget.setFontSize(nextValue);
          },
        );
      })
      .addEventListener("select:subtitlesFontFamily", (item) => {
        this.updateSubtitlesWidgetSetting(
          item,
          this.data.subtitlesFontFamily,
          (widget, nextValue) => {
            widget.setFontFamily(nextValue);
          },
        );
      })
      .addEventListener("input:subtitlesBackgroundOpacity", (value) => {
        this.updateSubtitlesWidgetSetting(
          value,
          this.data.subtitlesOpacity,
          (widget, nextValue) => {
            widget.setOpacity(nextValue);
          },
        );
      })
      .addEventListener("change:proxyWorkerHost", (_value) => {
        if (!this.videoHandler) {
          return;
        }

        // Proxy host changes invalidate cached requests/URLs and should stop
        // the current translation session.
        this.runDetached(
          this.videoHandler.handleProxySettingsChanged("proxyWorkerHost"),
          "Failed to apply proxyWorkerHost change",
        );
      })
      .addEventListener("select:proxyTranslationStatus", () => {
        // Switching proxy mode changes request routing. Drop stale cache and
        // stop translation so the next run starts with fresh settings.
        if (!this.videoHandler) {
          return;
        }

        this.runDetached(
          this.videoHandler.handleProxySettingsChanged(
            "proxyTranslationStatus",
          ),
          "Failed to apply proxyTranslationStatus change",
        );
      })
      .addEventListener("change:useNewAudioPlayer", () => {
        this.restartAudioPlayer();
      })
      .addEventListener("change:onlyBypassMediaCSP", () => {
        this.restartAudioPlayer();
      })
      .addEventListener("select:translationTextService", () => {
        this.withSubtitlesWidget((widget) => {
          widget.resetTranslationContext(true);
        });
      })
      .addEventListener("change:showPiPButton", () => {
        this.withInitializedOverlayView((overlayView) => {
          if (!overlayView.votButton) {
            return;
          }

          overlayView.votButton.showPiPButton(overlayView.pipButtonVisible);
        });
      })
      .addEventListener("select:buttonPosition", (item) => {
        this.withInitializedOverlayView((overlayView) => {
          const preferredPosition = this.data.buttonPos ?? item;
          const { position, direction } =
            overlayView.calcButtonLayout(preferredPosition);
          overlayView.updateButtonLayout(position, direction);
          overlayView.syncVoiceModeUi();
        });
      })
      .addEventListener("select:menuLanguage", async () => {
        await this.reloadMenu();
      })
      .addEventListener("click:bugReport", () => {
        if (!this.videoHandler) {
          return;
        }

        const params = new URLSearchParams(
          this.videoHandler.collectReportInfo(),
        ).toString();

        globalThis
          .open(`${repositoryUrl}/issues/new?${params}`, "_blank")
          ?.focus();
      })
      .addEventListener("click:resetSettings", async () => {
        const valuesForClear = await votStorage.list();
        await Promise.all(valuesForClear.map((key) => votStorage.delete(key)));
        await votStorage.set("compatVersion", actualCompatVersion);

        globalThis.location.reload();
      });
  }
  async downloadCurrentSubtitles() {
    await this.handleDownloadSubtitlesClick();
  }
  private async handleDownloadTranslationClick() {
    const overlayView = this.votOverlayView;
    const videoHandler = this.videoHandler;
    if (
      !overlayView?.isInitialized() ||
      !videoHandler?.downloadTranslationUrl ||
      !videoHandler.videoData
    ) {
      return;
    }

    const downloadButton = overlayView.downloadTranslationButton;
    const downloadUrl = videoHandler.downloadTranslationUrl;
    const filename = this.data.downloadWithName
      ? clearFileName(videoHandler.getDownloadBaseName())
      : `translation_${videoHandler.videoData.videoId}`;
    const isMobile = this.isLikelyMobileDownloadContext();
    const saveOptions: DownloadBlobOptions = { preferShare: isMobile };

    const setProgress = (progress: number) => {
      if (downloadButton) {
        downloadButton.progress = progress;
      }
    };

    setProgress(0);
    try {
      await this.downloadTranslationAudio(
        downloadUrl,
        filename,
        setProgress,
        saveOptions,
      );
    } catch (err) {
      console.error("[VOT] Download translation failed:", err);
      if (!this.triggerUrlDownload(downloadUrl, `${filename}.mp3`)) {
        globalThis.open(downloadUrl, "_blank")?.focus();
      }
    } finally {
      setProgress(0);
    }
  }

  private async downloadTranslationAudio(
    downloadUrl: string,
    filename: string,
    onProgress: (progress: number) => void,
    saveOptions: DownloadBlobOptions,
  ) {
    // Download the full audio. A range request (bytes=0-0) only returns a tiny
    // fragment (~1 byte + headers), which results in a silent ~5KB file.
    const response = await GM_fetch(downloadUrl, { timeout: 0 });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await downloadTranslation(response, filename, onProgress, saveOptions);
  }

  private async handleDownloadSubtitlesClick() {
    const videoHandler = this.videoHandler;
    if (!videoHandler?.yandexSubtitles || !videoHandler.videoData) {
      return;
    }

    const subsFormat = this.data.subtitlesDownloadFormat ?? "json";
    const subsContent = serializeProcessedSubtitles(
      videoHandler.yandexSubtitles,
      subsFormat,
      {
        assTitle:
          videoHandler.videoData.localizedTitle ??
          videoHandler.videoData.title ??
          videoHandler.videoData.downloadTitle,
      },
    );
    const blob = new Blob(
      [
        subsFormat === "json"
          ? JSON.stringify(subsContent)
          : (subsContent as string),
      ],
      {
        type: "text/plain",
      },
    );
    const filename = this.data.downloadWithName
      ? clearFileName(videoHandler.getDownloadBaseName())
      : `subtitles_${videoHandler.videoData.videoId}`;
    const targetFilename = `${filename}.${subsFormat}`;
    const isMobile = this.isLikelyMobileDownloadContext();
    const saveOptions: DownloadBlobOptions = { preferShare: isMobile };

    await downloadBlob(blob, targetFilename, saveOptions);
  }

  async reloadMenu() {
    if (!this.votOverlayView?.isInitialized()) {
      throw new Error("[VOT] OverlayView isn't initialized");
    }

    // Preserve overlay state across UI rebuild.
    const prevButtonOpacity = this.votOverlayView.votButton.opacity;
    const prevButtonHidden = this.votOverlayView.votButton.container.hidden;
    const prevMenuHidden = this.votOverlayView.votMenu.hidden;
    const prevButtonPos = this.data.buttonPos ?? "default";
    const settingsWasOpen =
      this.votSettingsView?.dialog?.container?.hidden === false;

    await this.videoHandler?.stopTranslation();
    this.release();
    this.initUI();
    this.initUIEvents();
    if (!this.videoHandler) {
      return this;
    }

    // Restore button/menu visibility + layout.
    try {
      const { position, direction } =
        this.votOverlayView.calcButtonLayout(prevButtonPos);
      this.votOverlayView.updateButtonLayout(position, direction);
      this.votOverlayView.votMenu.hidden = prevMenuHidden;
      this.votOverlayView.votButton.container.hidden = prevButtonHidden;
      this.votOverlayView.votButton.opacity = prevButtonOpacity;
      this.votOverlayView.syncVoiceModeUi();
    } catch (err) {
      debug.warn(
        "[VOT] Failed to restore overlay state after menu reload",
        err,
      );
    }

    // Re-bind overlay visibility interactions (overlay elements were recreated).
    try {
      this.videoHandler.rebindOverlayVisibilityTargets();
    } catch (err) {
      debug.warn("[VOT] Failed to rebind overlay visibility targets", err);
    }

    // Keep settings open when language changes (better UX).
    if (settingsWasOpen) {
      try {
        this.votSettingsView?.open();
      } catch (err) {
        debug.warn("[VOT] Failed to reopen settings after menu reload", err);
      }
    }

    await this.videoHandler.updateSubtitlesLangSelect();
    const widget = this.videoHandler.subtitlesWidget;
    if (widget) {
      widget.resetTranslationContext(true);
    }

    return this;
  }

  async handleTranslationBtnClick() {
    if (!this.votOverlayView?.isInitialized()) {
      throw new Error("[VOT] OverlayView isn't initialized");
    }

    const videoHandler = this.videoHandler;
    if (!videoHandler) {
      return this;
    }

    debug.log("[handleTranslationBtnClick] click translationBtn");

    if (videoHandler.isAwaitingAutoplayRecovery()) {
      debug.log("[handleTranslationBtnClick] resume pending autoplay recovery");
      await videoHandler.resumePendingAutoplayRecovery("button");
      return this;
    }

    // Реально выключаем только если перевод уже играет
    if (videoHandler.hasActiveSource()) {
      debug.log("[handleTranslationBtnClick] stop active translation");
      await videoHandler.stopTranslation();
      return this;
    }

    // Если уже идёт запуск перевода — игнорируем повторный вызов
    if (
      this.translationActionInFlight ||
      this.votOverlayView.votButton.loading
    ) {
      debug.log("[handleTranslationBtnClick] ignore re-entry while loading");
      return this;
    }

    this.translationActionInFlight = true;

    try {
      await this.startTranslationFlow(videoHandler);
    } catch (err) {
      if (this.isAbortError(err)) {
        this.transformBtn("none", localizationProvider.get("translateVideo"));
        return this;
      }

      console.error("[VOT]", err);

      if (!(err instanceof Error)) {
        this.transformBtn("error", String(err));
        return this;
      }

      const message =
        err.name === "VOTLocalizedError"
          ? (err as VOTLocalizedError).localizedMessage
          : err.message;

      this.transformBtn("error", message);
    } finally {
      this.translationActionInFlight = false;
    }

    return this;
  }

  private async getVideoDataForTranslation(videoHandler: VideoHandler) {
    if (!videoHandler.videoData?.videoId) {
      videoHandler.videoData = await videoHandler.getVideoData();
    }

    if (this.shouldRefreshVideoDataBeforeTranslation(videoHandler)) {
      videoHandler.videoData = await videoHandler.getVideoData();
    }

    if (!videoHandler.videoData?.videoId) {
      throw new VOTLocalizedError("VOTNoVideoIDFound");
    }

    return videoHandler.videoData;
  }

  private shouldRefreshVideoDataBeforeTranslation(videoHandler: VideoHandler) {
    return (
      (videoHandler.site.host === "vk" &&
        videoHandler.site.additionalData === "clips") ||
      videoHandler.site.host === "douyin"
    );
  }

  private isAbortError(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
  }

  private isLoadingText(text: string) {
    // Localization keys have historically varied in casing across builds.
    const delayed = localizationProvider.get("TranslationDelayed");
    return (
      typeof text === "string" &&
      (text.includes(localizationProvider.get("translationTake")) ||
        (delayed ? text.includes(delayed) : false))
    );
  }

  transformBtn(status: Status, text: string) {
    if (!this.votOverlayView?.isInitialized()) {
      throw new Error("[VOT] OverlayView isn't initialized");
    }

    this.votOverlayView.votButton.status = status;
    this.votOverlayView.votButton.loading =
      status === "error" && this.isLoadingText(text);
    this.votOverlayView.votButton.setText(text);
    this.votOverlayView.votButtonTooltip.setContent(text);
    this.votOverlayView.syncVoiceModeUi();
    return this;
  }

  release() {
    if (!this.isInitialized()) {
      return this;
    }

    if (
      /^(m|music)\.youtube\.com$/i.test(
        String(globalThis.location.hostname || ""),
      )
    ) {
      console.log("[VOT][mobile-overlay][ui] UIManager release");
    }

    // Release child views before removing the shared portal.
    // Each view is now idempotent and releases events before DOM.
    this.votOverlayView?.release();
    this.votSettingsView?.release();
    this.votGlobalPortal?.remove();

    this.initialized = false;
    return this;
  }

  private withInitializedOverlayView(
    callback: (overlayView: OverlayView) => void,
  ) {
    if (!this.votOverlayView?.isInitialized()) {
      return;
    }

    callback(this.votOverlayView);
  }

  private withSubtitlesWidget(
    callback: (widget: NonNullable<VideoHandler["subtitlesWidget"]>) => void,
  ) {
    const widget = this.videoHandler?.subtitlesWidget;
    if (!widget) {
      return;
    }

    callback(widget);
  }

  private updateSubtitlesWidgetSetting<T>(
    nextValue: T,
    storedValue: T | undefined,
    apply: (
      widget: NonNullable<VideoHandler["subtitlesWidget"]>,
      value: T,
    ) => void,
  ) {
    this.withSubtitlesWidget((widget) => {
      apply(widget, storedValue ?? nextValue);
    });
  }

  private runDetached(task: Promise<unknown>, errorMessage: string) {
    void task.catch((err) => {
      debug.warn(`[VOT] ${errorMessage}`, err);
    });
  }

  private triggerUrlDownload(url: string, filename: string): boolean {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      // Cross-origin downloads can ignore `download`; keep navigation off the
      // current tab in that case.
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch {
      return false;
    }
  }

  private isLikelyMobileDownloadContext(): boolean {
    if (
      this.videoHandler?.site.additionalData === "mobile" ||
      this.videoHandler?.site.additionalData === "music"
    ) {
      return true;
    }

    return (
      typeof matchMedia === "function" &&
      matchMedia("(pointer: coarse)").matches
    );
  }

  private restartAudioPlayer() {
    void this.restartAudioPlayerSafely();
  }

  private async restartAudioPlayerSafely() {
    const videoHandler = this.videoHandler;
    if (!videoHandler) {
      return;
    }

    try {
      await videoHandler.stopTranslate();
      videoHandler.createPlayer();
    } catch (err) {
      debug.warn("[VOT] Failed to restart audio player", err);
    }
  }
}
