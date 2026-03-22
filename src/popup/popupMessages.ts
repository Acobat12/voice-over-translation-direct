export type PopupOption = {
  value: string;
  label: string;
};

export type MainToPopupMessage = {
  source: "vot-main";
  type: "overlay-state";
  payload: {
    visible: boolean;
    status: "none" | "loading" | "success" | "error";
    label: string;
    canDownload?: boolean;
    hint?: string;
    fromLangLabel?: string;
    toLangLabel?: string;
    fromLangValue?: string;
    toLangValue?: string;
    fromLangOptions?: PopupOption[];
    toLangOptions?: PopupOption[];
    subtitlesEnabled?: boolean;
    videoVolume?: number;
    translationVolume?: number;
    canAdjustTranslationVolume?: boolean;
    autoTranslateEnabled?: boolean;
    autoSubtitlesEnabled?: boolean;
    syncVolumeEnabled?: boolean;
    showVideoSliderEnabled?: boolean;
    audioBoosterEnabled?: boolean;
    autoVolumeEnabled?: boolean;
    smartDuckingEnabled?: boolean;
  };
};
