import { localizationProvider } from "../../localization/localizationProvider";

import {
  actualCompatVersion,
  defaultAutoHideDelay,
  defaultAutoVolume,
  defaultDetectService,
  defaultTranslationService,
  m3u8ProxyHost,
  proxyOnlyCountries,
  proxyWorkerHost,
} from "../../config/config";
import type { VideoHandler } from "../../index";
import type { LanguageSelectKey } from "../../types/components/select";
import debug from "../../utils/debug";
import { GM_fetch, isProxyOnlyExtension, isSupportGMXhr } from "../../utils/gm";
import { updateConfig, votStorage } from "../../utils/storage";
import { calculatedResLang } from "../../utils/utils";
import { countryCode, setCountryCode } from "../shared";
import { shouldUsePopupOverlayWindow } from "../../core/popupOverlayPolicy";
import { PopupOverlayBridge } from "../../popup/popupOverlayBridge";

let countryCodeRequestInFlight: Promise<void> | null = null;

async function ensureCountryCode(): Promise<void> {
  if (countryCode) {
    return;
  }

  countryCodeRequestInFlight ??= (async () => {
    try {
      const response = await GM_fetch(
        "https://cloudflare-dns.com/cdn-cgi/trace",
        {
          timeout: 7000,
        },
      );
      const trace = await response.text();
      const loc = trace.split("\n").find((line) => line.startsWith("loc="));
      setCountryCode(loc?.slice(4, 6).toUpperCase());
    } catch (err) {
      console.error("[VOT] Error getting country:", err);
    }
  })().finally(() => {
    countryCodeRequestInFlight = null;
  });

  await countryCodeRequestInFlight;
}

export async function init(this: VideoHandler) {
  if (this.initialized) return;

  const audioContextSupported = this.isAudioContextSupported;

  // Retrieve settings from storage.
  this.data = await votStorage.getValues({
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
    downloadWithName: isSupportGMXhr,
    sendNotifyOnComplete: false,
    subtitlesMaxLength: 300,
    subtitlesSmartLayout: true,
    highlightWords: false,
    subtitlesFontSize: 20,
    subtitlesFontFamily: "default-sans",
    subtitlesOpacity: 20,
    subtitlesDownloadFormat: "srt",
    responseLanguage: calculatedResLang,
    defaultVolume: 100,
    onlyBypassMediaCSP: audioContextSupported,
    newAudioPlayer: audioContextSupported,
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
    // Audio download now uses direct network requests (GM_fetch/GM_xmlhttpRequest).
    useAudioDownload: isSupportGMXhr,
    compatVersion: "",
    account: {},
    localeHash: "",
    localeUpdatedAt: 0,
  });
  if (this.data.compatVersion !== actualCompatVersion) {
    this.data = await updateConfig(this.data);
    await votStorage.set("compatVersion", actualCompatVersion);
  }

  try {
    if (
      calculatedResLang === "en" &&
      this.data?.enabledDontTranslateLanguages &&
      Array.isArray(this.data?.dontTranslateLanguages) &&
      this.data.dontTranslateLanguages.length === 1 &&
      this.data.dontTranslateLanguages[0] === "en" &&
      typeof this.data.responseLanguage === "string" &&
      this.data.responseLanguage !== "en"
    ) {
      const responseLang = this.data.responseLanguage as LanguageSelectKey;
      this.data.dontTranslateLanguages = [responseLang];
      await votStorage.set(
        "dontTranslateLanguages",
        this.data.dontTranslateLanguages,
      );
    }
  } catch {
    // Ignore migration errors
  }

  this.uiManager.data = this.data;
  // Translation volume starts from the user's saved default volume.
  console.log("[VOT] data from db:", this.data);

  // Enable translate proxy if extension isn't compatible with GM_xmlhttpRequest
  if (!this.data.translateProxyEnabled && isProxyOnlyExtension) {
    this.data.translateProxyEnabled = 1;
  }

  // Determine country for proxy purposes
  await ensureCountryCode();

  if (
    countryCode &&
    proxyOnlyCountries.includes(countryCode) &&
    this.data.translateProxyEnabledDefault
  ) {
    this.data.translateProxyEnabled = 2;
  }

  debug.log(
    "translateProxyEnabled",
    this.data.translateProxyEnabled,
    this.data.translateProxyEnabledDefault,
  );
  debug.log("Extension compatibility passed...");

  await this.initVOTClient();

  // Initialize UI elements and events.
  this.uiManager.initUI();
  this.uiManager.initUIEvents();

  if (shouldUsePopupOverlayWindow()) {
    this.popupOverlayBridge = new PopupOverlayBridge();
    this.popupOverlayBridge.bind();
    this.popupOverlayBridge.open();
    this.popupOverlayBridge.setHandlers({
      onTranslate: () => {
        void this.uiManager.handleTranslationBtnClick();
      },
      onTurnOff: () => {
        void this.stopTranslation();
      },
      onSettings: () => {
        this.overlayVisibility?.cancel?.();
        this.overlayVisibility?.show?.();
        this.uiManager.votSettingsView?.open?.();
      },
      onDownload: () => {
        void (this.uiManager as any).handleDownloadTranslationClick?.();
      },
      onToggleSubtitles: () => {
        void this.toggleSubtitlesForCurrentLangPair().finally(() => {
          this.syncPopupOverlayState();
        });
      },
      onFromLanguageChange: (value) => {
        if (this.videoData) {
          this.videoData.detectedLanguage = value as any;
          this.videoManager.rememberUserLanguageSelection(this.videoData.videoId, value as any);
        }
        this.setSelectMenuValues(value, this.videoData?.responseLanguage ?? this.translateToLang);
        this.syncPopupOverlayState({ fromLangValue: value });
      },
      onToLanguageChange: (value) => {
        this.translateToLang = value as any;
        if (this.videoData) {
          this.videoData.responseLanguage = value as any;
        }
        this.data.responseLanguage = value as any;
        void votStorage.set("responseLanguage", value as any);
        this.setSelectMenuValues(this.videoData?.detectedLanguage ?? this.translateFromLang, value);
        this.syncPopupOverlayState({ toLangValue: value });
      },
      onAutoTranslateChange: (value) => {
        this.data.autoTranslate = value;
        void votStorage.set("autoTranslate", value);
        this.syncPopupOverlayState({ autoTranslateEnabled: value });
      },
      onAutoSubtitlesChange: (value) => {
        this.data.autoSubtitles = value;
        void votStorage.set("autoSubtitles", value);
        this.syncPopupOverlayState({ autoSubtitlesEnabled: value });
      },
      onSyncVolumeChange: (value) => {
        this.data.syncVolume = value;
        void votStorage.set("syncVolume", value);
        this.syncPopupOverlayState({ syncVolumeEnabled: value });
      },
      onShowVideoSliderChange: (value) => {
        this.data.showVideoSlider = value;
        void votStorage.set("showVideoSlider", value);
        if (this.uiManager.votOverlayView?.videoVolumeSlider) {
          this.uiManager.votOverlayView.videoVolumeSlider.hidden = !value || this.uiManager.votOverlayView.votButton?.status !== "success";
        }
        this.syncPopupOverlayState({ showVideoSliderEnabled: value });
      },
      onAudioBoosterChange: (value) => {
        this.data.audioBooster = value;
        void votStorage.set("audioBooster", value);
        const slider = this.uiManager.votOverlayView?.translationVolumeSlider;
        if (slider) {
          slider.max = value ? 300 : 100;
          if (!value && Number(slider.value) > 100) {
            slider.value = 100;
            if (this.audioPlayer?.player) this.audioPlayer.player.volume = 1;
            this.data.defaultVolume = 100;
          }
        }
        this.syncPopupOverlayState({
          audioBoosterEnabled: value,
          translationVolume: Number(this.uiManager.votOverlayView?.translationVolumeSlider?.value ?? this.data.defaultVolume ?? 100),
        });
      },
      onAutoVolumeChange: (value) => {
        this.data.enabledAutoVolume = value;
        void votStorage.set("enabledAutoVolume", value);
        this.setupAudioSettings();
        this.syncPopupOverlayState({ autoVolumeEnabled: value });
      },
      onSmartDuckingChange: (value) => {
        this.data.enabledSmartDucking = value;
        void votStorage.set("enabledSmartDucking", value);
        this.syncPopupOverlayState({ smartDuckingEnabled: value });
      },
      onVideoVolumeChange: (value) => {
        this.setVideoVolume(value / 100);
        this.onVideoVolumeSliderSynced(value);
        if (this.uiManager.votOverlayView?.videoVolumeSlider) {
          this.uiManager.votOverlayView.videoVolumeSlider.value = value;
        }
        this.syncPopupOverlayState({ videoVolume: value });
      },
      onTranslationVolumeChange: (value) => {
        this.data.defaultVolume = value;
        if (this.audioPlayer?.player) {
          this.audioPlayer.player.volume = value / 100;
        }
        this.onTranslationVolumeSliderSynced(value);
        if (this.uiManager.votOverlayView?.translationVolumeSlider) {
          this.uiManager.votOverlayView.translationVolumeSlider.value = value;
        }
        this.syncPopupOverlayState({ translationVolume: value });
      },
    });

    if (this.uiManager.votOverlayView?.votButton?.container) {
      this.uiManager.votOverlayView.votButton.container.style.display = "none";
    }

    if (this.uiManager.votOverlayView?.votMenu?.container) {
      this.uiManager.votOverlayView.votMenu.container.style.display = "none";
    }

    this.syncPopupOverlayState({
      status: "none",
      label: localizationProvider.get("translateVideo"),
      hint: "Popup mode for Google-hosted players.",
    });
  } else if (this.uiManager.votOverlayView?.votButton?.container) {
    this.uiManager.votOverlayView.votButton.container.hidden = true;
  }

  // Get video data and create player.
  this.createPlayer();

  this.translateToLang = this.data.responseLanguage ?? "ru";
  this.initExtraEvents();

  this.initialized = true;
}
