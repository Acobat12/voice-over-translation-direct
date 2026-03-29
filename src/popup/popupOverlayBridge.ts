import type { MainToPopupMessage, PopupOption } from "./popupMessages";

type PopupState = MainToPopupMessage["payload"];

type PopupGeometry = {
  width: number;
  height: number;
  left: number;
  top: number;
};

export class PopupOverlayBridge {
  private static readonly GEOMETRY_STORAGE_KEY = "vot-popup-overlay-geometry";

  private popup: Window | null = null;
  private isBound = false;
  private geometrySaveTimer: ReturnType<typeof setTimeout> | null = null;

  private onTranslate?: () => void;
  private onTurnOff?: () => void;
  private onSettings?: () => void;
  private onDownload?: () => void;
  private onDownloadSubtitles?: () => void;
  private onToggleSubtitles?: () => void;
  private onVideoVolumeChange?: (value: number) => void;
  private onTranslationVolumeChange?: (value: number) => void;
  private onFromLanguageChange?: (value: string) => void;
  private onToLanguageChange?: (value: string) => void;
  private onAutoTranslateChange?: (value: boolean) => void;
  private onAutoSubtitlesChange?: (value: boolean) => void;
  private onSyncVolumeChange?: (value: boolean) => void;
  private onShowVideoSliderChange?: (value: boolean) => void;
  private onAudioBoosterChange?: (value: boolean) => void;
  private onAutoVolumeChange?: (value: boolean) => void;
  private onSmartDuckingChange?: (value: boolean) => void;

  open(): void {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return;
    }

    const geometry = this.readGeometry();
    const features = this.buildPopupFeatures(geometry);
    this.popup = window.open("", "vot_overlay", features);

    if (!this.popup) return;

    const doc = this.popup.document;
    doc.title = "VOT";

    while (doc.firstChild) doc.removeChild(doc.firstChild);

    const html = doc.createElement("html");
    const head = doc.createElement("head");
    const meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    const title = doc.createElement("title");
    title.textContent = "VOT";
    const style = doc.createElement("style");
    style.textContent = `
      :root {
        color-scheme: dark;
        --vot-bg: #0f172a;
        --vot-card: #111827;
        --vot-card-2: #1f2937;
        --vot-text: #f9fafb;
        --vot-muted: rgba(248, 250, 252, 0.72);
        --vot-border: rgba(255,255,255,0.08);
        --vot-accent: #2563eb;
        --vot-accent-2: #1d4ed8;
        --vot-success: #059669;
        --vot-warning: #d97706;
        --vot-danger: #dc2626;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 14px;
        font-family: Arial, sans-serif;
        background:
          radial-gradient(circle at top right, rgba(37,99,235,.14), transparent 34%),
          linear-gradient(180deg, #0b1220, var(--vot-bg));
        color: var(--vot-text);
      }
      .vot-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        border: 1px solid var(--vot-border);
        border-radius: 16px;
        padding: 14px;
        background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.025));
        box-shadow: 0 16px 36px rgba(0,0,0,.28);
      }
      .vot-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .vot-title-wrap { display: flex; flex-direction: column; gap: 3px; }
      .vot-title { font-size: 13px; opacity: .82; font-weight: 700; }
      .vot-subtitle { font-size: 11px; color: var(--vot-muted); }
      .vot-badge {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(255,255,255,.08);
        color: var(--vot-text);
      }
      .vot-badge[data-status="loading"] { background: rgba(217,119,6,.18); color: #fbbf24; }
      .vot-badge[data-status="success"] { background: rgba(5,150,105,.18); color: #34d399; }
      .vot-badge[data-status="error"] { background: rgba(220,38,38,.18); color: #fca5a5; }
      .vot-row { display: flex; gap: 8px; align-items: center; }
      .vot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .vot-field { display: flex; flex-direction: column; gap: 6px; }
      .vot-label { font-size: 12px; color: var(--vot-muted); }
      .vot-select,
      button {
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 14px;
        background: var(--vot-card-2);
        color: var(--vot-text);
      }
      .vot-select { width: 100%; }
      button {
        cursor: pointer;
        font-weight: 600;
        transition: transform .12s ease, background .12s ease, opacity .12s ease;
      }
      button:hover { background: #273244; }
      button:active { transform: translateY(1px); }
      button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .45; }
      #vot-main-btn { flex: 1; background: var(--vot-accent); border-color: transparent; }
      #vot-main-btn:hover { background: var(--vot-accent-2); }
      #vot-main-btn[data-mode="turn-off"] { background: var(--vot-danger); }
      #vot-main-btn[data-mode="turn-off"]:hover { background: #b91c1c; }
      #vot-subtitles-btn[data-active="true"] {
        background: rgba(37,99,235,.18);
        border-color: rgba(96,165,250,.35);
      }
      #vot-download-btn:disabled { text-decoration: line-through; }
      #vot-status { font-size: 12px; opacity: .92; }
      #vot-hint { font-size: 12px; color: var(--vot-muted); line-height: 1.35; }
      .vot-slider-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .vot-slider-value { font-size: 12px; color: var(--vot-muted); }
      input[type="range"] { width: 100%; accent-color: var(--vot-accent); }
      .vot-toggle-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .vot-toggle {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-radius: 12px;
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06);
      }
      .vot-toggle input { margin: 0; }
    `;
    head.append(meta, title, style);

    const body = doc.createElement("body");
    const card = doc.createElement("div");
    card.className = "vot-card";

    const header = doc.createElement("div");
    header.className = "vot-header";
    const titleWrap = doc.createElement("div");
    titleWrap.className = "vot-title-wrap";
    const titleEl = doc.createElement("div");
    titleEl.className = "vot-title";
    titleEl.textContent = "Voice Over Translation";
    const subtitleEl = doc.createElement("div");
    subtitleEl.className = "vot-subtitle";
    subtitleEl.textContent = "Popup mode for Google-hosted players.";
    titleWrap.append(titleEl, subtitleEl);
    const badge = doc.createElement("div");
    badge.id = "vot-badge";
    badge.className = "vot-badge";
    badge.dataset.status = "none";
    badge.textContent = "idle";
    header.append(titleWrap, badge);

    const rowMain = doc.createElement("div");
    rowMain.className = "vot-row";
    const mainBtn = doc.createElement("button");
    mainBtn.id = "vot-main-btn";
    mainBtn.textContent = "Translate video";
    rowMain.append(mainBtn);

    const langGrid = doc.createElement("div");
    langGrid.className = "vot-grid";
    const fromField = doc.createElement("div");
    fromField.className = "vot-field";
    const fromLabel = doc.createElement("div");
    fromLabel.className = "vot-label";
    fromLabel.textContent = "From";
    const fromSelect = doc.createElement("select");
    fromSelect.id = "vot-from-lang";
    fromSelect.className = "vot-select";
    fromField.append(fromLabel, fromSelect);
    const toField = doc.createElement("div");
    toField.className = "vot-field";
    const toLabel = doc.createElement("div");
    toLabel.className = "vot-label";
    toLabel.textContent = "To";
    const toSelect = doc.createElement("select");
    toSelect.id = "vot-to-lang";
    toSelect.className = "vot-select";
    toField.append(toLabel, toSelect);
    langGrid.append(fromField, toField);

    const toggleRow = doc.createElement("div");
    toggleRow.className = "vot-toggle-row";
    const autoTranslateWrap = doc.createElement("label");
    autoTranslateWrap.className = "vot-toggle";
    const autoTranslateInput = doc.createElement("input");
    autoTranslateInput.type = "checkbox";
    autoTranslateInput.id = "vot-auto-translate";
    const autoTranslateText = doc.createElement("span");
    autoTranslateText.textContent = "Auto translate";
    autoTranslateWrap.append(autoTranslateInput, autoTranslateText);
    const autoSubtitlesWrap = doc.createElement("label");
    autoSubtitlesWrap.className = "vot-toggle";
    const autoSubtitlesInput = doc.createElement("input");
    autoSubtitlesInput.type = "checkbox";
    autoSubtitlesInput.id = "vot-auto-subtitles";
    const autoSubtitlesText = doc.createElement("span");
    autoSubtitlesText.textContent = "Auto subtitles";
    autoSubtitlesWrap.append(autoSubtitlesInput, autoSubtitlesText);
    toggleRow.append(autoTranslateWrap, autoSubtitlesWrap);

    const behaviorRow = doc.createElement("div");
    behaviorRow.className = "vot-toggle-row";
    const syncVolumeWrap = doc.createElement("label");
    syncVolumeWrap.className = "vot-toggle";
    const syncVolumeInput = doc.createElement("input");
    syncVolumeInput.type = "checkbox";
    syncVolumeInput.id = "vot-sync-volume";
    const syncVolumeText = doc.createElement("span");
    syncVolumeText.textContent = "Sync volume";
    syncVolumeWrap.append(syncVolumeInput, syncVolumeText);
    const showVideoSliderWrap = doc.createElement("label");
    showVideoSliderWrap.className = "vot-toggle";
    const showVideoSliderInput = doc.createElement("input");
    showVideoSliderInput.type = "checkbox";
    showVideoSliderInput.id = "vot-show-video-slider";
    const showVideoSliderText = doc.createElement("span");
    showVideoSliderText.textContent = "Video slider";
    showVideoSliderWrap.append(showVideoSliderInput, showVideoSliderText);
    behaviorRow.append(syncVolumeWrap, showVideoSliderWrap);

    const audioRow = doc.createElement("div");
    audioRow.className = "vot-toggle-row";
    const audioBoosterWrap = doc.createElement("label");
    audioBoosterWrap.className = "vot-toggle";
    const audioBoosterInput = doc.createElement("input");
    audioBoosterInput.type = "checkbox";
    audioBoosterInput.id = "vot-audio-booster";
    const audioBoosterText = doc.createElement("span");
    audioBoosterText.textContent = "Audio booster";
    audioBoosterWrap.append(audioBoosterInput, audioBoosterText);
    const autoVolumeWrap = doc.createElement("label");
    autoVolumeWrap.className = "vot-toggle";
    const autoVolumeInput = doc.createElement("input");
    autoVolumeInput.type = "checkbox";
    autoVolumeInput.id = "vot-auto-volume";
    const autoVolumeText = doc.createElement("span");
    autoVolumeText.textContent = "Auto volume";
    autoVolumeWrap.append(autoVolumeInput, autoVolumeText);
    audioRow.append(audioBoosterWrap, autoVolumeWrap);

    const duckingRow = doc.createElement("div");
    duckingRow.className = "vot-toggle-row";
    const smartDuckingWrap = doc.createElement("label");
    smartDuckingWrap.className = "vot-toggle";
    const smartDuckingInput = doc.createElement("input");
    smartDuckingInput.type = "checkbox";
    smartDuckingInput.id = "vot-smart-ducking";
    const smartDuckingText = doc.createElement("span");
    smartDuckingText.textContent = "Smart ducking";
    smartDuckingWrap.append(smartDuckingInput, smartDuckingText);
    duckingRow.append(smartDuckingWrap);

    const rowSecondary = doc.createElement("div");
    rowSecondary.className = "vot-row";
    const subtitlesBtn = doc.createElement("button");
    subtitlesBtn.id = "vot-subtitles-btn";
    subtitlesBtn.textContent = "Subtitles";
    const downloadBtn = doc.createElement("button");
    downloadBtn.id = "vot-download-btn";
    downloadBtn.textContent = "Download MP3";
    const downloadSubtitlesBtn = doc.createElement("button");
    downloadSubtitlesBtn.id = "vot-download-subtitles-btn";
    downloadSubtitlesBtn.textContent = "Download subtitles";
    rowSecondary.append(subtitlesBtn, downloadBtn, downloadSubtitlesBtn);

    const videoVolumeField = doc.createElement("div");
    videoVolumeField.className = "vot-field";
    const videoVolumeHead = doc.createElement("div");
    videoVolumeHead.className = "vot-slider-head";
    const videoVolumeLabel = doc.createElement("div");
    videoVolumeLabel.id = "vot-video-volume-label";
    videoVolumeLabel.className = "vot-label";
    videoVolumeLabel.textContent = "Video volume";
    const videoVolumeValue = doc.createElement("div");
    videoVolumeValue.id = "vot-video-volume-value";
    videoVolumeValue.className = "vot-slider-value";
    videoVolumeValue.textContent = "100%";
    videoVolumeHead.append(videoVolumeLabel, videoVolumeValue);
    const videoVolumeInput = doc.createElement("input");
    videoVolumeInput.id = "vot-video-volume";
    videoVolumeInput.type = "range";
    videoVolumeInput.min = "0";
    videoVolumeInput.max = "100";
    videoVolumeInput.value = "100";
    videoVolumeField.append(videoVolumeHead, videoVolumeInput);

    const translationVolumeField = doc.createElement("div");
    translationVolumeField.className = "vot-field";
    const translationVolumeHead = doc.createElement("div");
    translationVolumeHead.className = "vot-slider-head";
    const translationVolumeLabel = doc.createElement("div");
    translationVolumeLabel.id = "vot-translation-volume-label";
    translationVolumeLabel.className = "vot-label";
    translationVolumeLabel.textContent = "Translation volume";
    const translationVolumeValue = doc.createElement("div");
    translationVolumeValue.id = "vot-translation-volume-value";
    translationVolumeValue.className = "vot-slider-value";
    translationVolumeValue.textContent = "100%";
    translationVolumeHead.append(translationVolumeLabel, translationVolumeValue);
    const translationVolumeInput = doc.createElement("input");
    translationVolumeInput.id = "vot-translation-volume";
    translationVolumeInput.type = "range";
    translationVolumeInput.min = "0";
    translationVolumeInput.max = "300";
    translationVolumeInput.value = "100";
    translationVolumeField.append(translationVolumeHead, translationVolumeInput);

    const statusEl = doc.createElement("div");
    statusEl.id = "vot-status";
    statusEl.textContent = "Status: none";
    const hintEl = doc.createElement("div");
    hintEl.id = "vot-hint";
    hintEl.textContent = "Popup mode for Google-hosted players.";

    card.append(
      header,
      rowMain,
      langGrid,
      toggleRow,
      behaviorRow,
      audioRow,
      duckingRow,
      rowSecondary,
      videoVolumeField,
      translationVolumeField,
      statusEl,
      hintEl,
    );
    body.append(card);
    html.append(head, body);
    doc.appendChild(html);

    mainBtn.addEventListener("click", () => {
      const mode = mainBtn.dataset.mode;
      if (mode === "turn-off") {
        this.onTurnOff?.();
      } else {
        this.onTranslate?.();
      }
    });
    downloadBtn.addEventListener("click", () => this.onDownload?.());
    downloadSubtitlesBtn.addEventListener("click", () => this.onDownloadSubtitles?.());

    subtitlesBtn.addEventListener("click", () => this.onToggleSubtitles?.());
    videoVolumeInput.addEventListener("input", () => {
      videoVolumeValue.textContent = `${videoVolumeInput.value}%`;
      this.onVideoVolumeChange?.(Number(videoVolumeInput.value));
    });
    translationVolumeInput.addEventListener("input", () => {
      translationVolumeValue.textContent = `${translationVolumeInput.value}%`;
      this.onTranslationVolumeChange?.(Number(translationVolumeInput.value));
    });
    fromSelect.addEventListener("change", () => this.onFromLanguageChange?.(fromSelect.value));
    toSelect.addEventListener("change", () => this.onToLanguageChange?.(toSelect.value));
    autoTranslateInput.addEventListener("change", () => this.onAutoTranslateChange?.(autoTranslateInput.checked));
    autoSubtitlesInput.addEventListener("change", () => this.onAutoSubtitlesChange?.(autoSubtitlesInput.checked));
    syncVolumeInput.addEventListener("change", () => this.onSyncVolumeChange?.(syncVolumeInput.checked));
    showVideoSliderInput.addEventListener("change", () => this.onShowVideoSliderChange?.(showVideoSliderInput.checked));
    audioBoosterInput.addEventListener("change", () => this.onAudioBoosterChange?.(audioBoosterInput.checked));
    autoVolumeInput.addEventListener("change", () => this.onAutoVolumeChange?.(autoVolumeInput.checked));
    smartDuckingInput.addEventListener("change", () => this.onSmartDuckingChange?.(smartDuckingInput.checked));

    doc.addEventListener("keydown", (event) => {
      const isInputTarget =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement;

      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }

      if (event.key === "Enter" && !isInputTarget) {
        event.preventDefault();
        const mode = mainBtn.dataset.mode;
        if (mode === "turn-off") {
          this.onTurnOff?.();
        } else {
          this.onTranslate?.();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (!downloadBtn.disabled) {
          this.onDownload?.();
        }
      }
    });

    this.attachGeometryPersistence(this.popup);
  }

  bind(): void {
    if (this.isBound) return;
    this.isBound = true;
  }

  setHandlers(options: {
    onTranslate?: () => void;
    onTurnOff?: () => void;
    onSettings?: () => void;
    onDownload?: () => void;
    onDownloadSubtitles?: () => void;
    onToggleSubtitles?: () => void;
    onVideoVolumeChange?: (value: number) => void;
    onTranslationVolumeChange?: (value: number) => void;
    onFromLanguageChange?: (value: string) => void;
    onToLanguageChange?: (value: string) => void;
    onAutoTranslateChange?: (value: boolean) => void;
    onAutoSubtitlesChange?: (value: boolean) => void;
    onSyncVolumeChange?: (value: boolean) => void;
    onShowVideoSliderChange?: (value: boolean) => void;
    onAudioBoosterChange?: (value: boolean) => void;
    onAutoVolumeChange?: (value: boolean) => void;
    onSmartDuckingChange?: (value: boolean) => void;
  }): void {
    this.onTranslate = options.onTranslate;
    this.onTurnOff = options.onTurnOff;
    this.onSettings = options.onSettings;
    this.onDownload = options.onDownload;
    this.onDownloadSubtitles = options.onDownloadSubtitles;
    this.onToggleSubtitles = options.onToggleSubtitles;
    this.onVideoVolumeChange = options.onVideoVolumeChange;
    this.onTranslationVolumeChange = options.onTranslationVolumeChange;
    this.onFromLanguageChange = options.onFromLanguageChange;
    this.onToLanguageChange = options.onToLanguageChange;
    this.onAutoTranslateChange = options.onAutoTranslateChange;
    this.onAutoSubtitlesChange = options.onAutoSubtitlesChange;
    this.onSyncVolumeChange = options.onSyncVolumeChange;
    this.onShowVideoSliderChange = options.onShowVideoSliderChange;
    this.onAudioBoosterChange = options.onAudioBoosterChange;
    this.onAutoVolumeChange = options.onAutoVolumeChange;
    this.onSmartDuckingChange = options.onSmartDuckingChange;
  }

  updateState(payload: PopupState): void {
    if (!this.popup || this.popup.closed) return;

    const mainBtn = this.getEl<HTMLButtonElement>("vot-main-btn");
    const subtitlesBtn = this.getEl<HTMLButtonElement>("vot-subtitles-btn");
    const downloadBtn = this.getEl<HTMLButtonElement>("vot-download-btn");
    const downloadSubtitlesBtn = this.getEl<HTMLButtonElement>("vot-download-subtitles-btn");
    const statusEl = this.getEl<HTMLDivElement>("vot-status");
    const hintEl = this.getEl<HTMLDivElement>("vot-hint");
    const fromSelect = this.getEl<HTMLSelectElement>("vot-from-lang");
    const toSelect = this.getEl<HTMLSelectElement>("vot-to-lang");
    const badge = this.getEl<HTMLDivElement>("vot-badge");
    const videoVolumeInput = this.getEl<HTMLInputElement>("vot-video-volume");
    const videoVolumeValue = this.getEl<HTMLDivElement>("vot-video-volume-value");
    const translationVolumeInput = this.getEl<HTMLInputElement>("vot-translation-volume");
    const translationVolumeValue = this.getEl<HTMLDivElement>("vot-translation-volume-value");
    const autoTranslateInput = this.getEl<HTMLInputElement>("vot-auto-translate");
    const autoSubtitlesInput = this.getEl<HTMLInputElement>("vot-auto-subtitles");
    const syncVolumeInput = this.getEl<HTMLInputElement>("vot-sync-volume");
    const showVideoSliderInput = this.getEl<HTMLInputElement>("vot-show-video-slider");
    const audioBoosterInput = this.getEl<HTMLInputElement>("vot-audio-booster");
    const autoVolumeInput = this.getEl<HTMLInputElement>("vot-auto-volume");
    const smartDuckingInput = this.getEl<HTMLInputElement>("vot-smart-ducking");

    this.popup.document.body.style.display = payload.visible ? "block" : "none";
    const isLoading = payload.status === "loading";

    if (mainBtn) {
      mainBtn.textContent = payload.label;
      mainBtn.dataset.mode = payload.status === "success" ? "turn-off" : "translate";
      mainBtn.disabled = isLoading;
    }
    if (badge) {
      badge.dataset.status = payload.status;
      badge.textContent = this.getBadgeText(payload.status);
    }
    if (subtitlesBtn) {
      subtitlesBtn.dataset.active = String(Boolean(payload.subtitlesEnabled));
      subtitlesBtn.textContent = payload.subtitlesEnabled ? "Subtitles: on" : "Subtitles: off";
    }
    if (downloadBtn) {
      downloadBtn.disabled = !payload.canDownload || isLoading;
      downloadBtn.title = payload.canDownload ? "Download translated audio" : "Translation audio is not available yet";
    }
    if (downloadSubtitlesBtn) {
      downloadSubtitlesBtn.disabled = !payload.canDownloadSubtitles || isLoading;
      downloadSubtitlesBtn.title = payload.canDownloadSubtitles
        ? "Download subtitles"
        : "Subtitles are not available yet";
    }
    if (statusEl) statusEl.textContent = `Status: ${payload.status}`;
    if (hintEl) hintEl.textContent = payload.hint ?? "Popup mode for Google-hosted players.";
    if (fromSelect) {
      this.renderSelectOptions(fromSelect, payload.fromLangOptions ?? [], payload.fromLangValue, payload.fromLangLabel);
    }
    if (toSelect) {
      this.renderSelectOptions(toSelect, payload.toLangOptions ?? [], payload.toLangValue, payload.toLangLabel);
    }
    if (fromSelect) fromSelect.disabled = isLoading;
    if (toSelect) toSelect.disabled = isLoading;
    //if (settingsBtn) settingsBtn.disabled = isLoading;
    if (subtitlesBtn) subtitlesBtn.disabled = isLoading;

    if (autoTranslateInput) {
      autoTranslateInput.checked = Boolean(payload.autoTranslateEnabled);
      autoTranslateInput.disabled = isLoading;
    }
    if (autoSubtitlesInput) {
      autoSubtitlesInput.checked = Boolean(payload.autoSubtitlesEnabled);
      autoSubtitlesInput.disabled = isLoading;
    }
    if (syncVolumeInput) {
      syncVolumeInput.checked = Boolean(payload.syncVolumeEnabled);
      syncVolumeInput.disabled = isLoading;
    }
    if (showVideoSliderInput) {
      showVideoSliderInput.checked = Boolean(payload.showVideoSliderEnabled);
      showVideoSliderInput.disabled = isLoading;
    }
    if (audioBoosterInput) {
      audioBoosterInput.checked = Boolean(payload.audioBoosterEnabled);
      audioBoosterInput.disabled = isLoading;
    }
    if (autoVolumeInput) {
      autoVolumeInput.checked = Boolean(payload.autoVolumeEnabled);
      autoVolumeInput.disabled = isLoading;
    }
    if (smartDuckingInput) {
      smartDuckingInput.checked = Boolean(payload.smartDuckingEnabled);
      smartDuckingInput.disabled = isLoading || !payload.autoVolumeEnabled;
    }
    if (videoVolumeInput && typeof payload.videoVolume === "number") {
      videoVolumeInput.value = String(Math.max(0, Math.min(100, Math.round(payload.videoVolume))));
      videoVolumeInput.disabled = isLoading || payload.showVideoSliderEnabled === false;
      if (videoVolumeValue) videoVolumeValue.textContent = `${videoVolumeInput.value}%`;
    }
    if (translationVolumeInput && typeof payload.translationVolume === "number") {
      translationVolumeInput.value = String(Math.max(0, Math.min(Number(translationVolumeInput.max), Math.round(payload.translationVolume))));
      translationVolumeInput.disabled = payload.canAdjustTranslationVolume === false || isLoading;
      if (translationVolumeValue) translationVolumeValue.textContent = `${translationVolumeInput.value}%`;
    }
  }

  close(): void {
    if (this.geometrySaveTimer) {
      clearTimeout(this.geometrySaveTimer);
      this.geometrySaveTimer = null;
    }
    try {
      this.persistGeometry();
      this.popup?.close();
    } catch {
      // ignore
    }
    this.popup = null;
  }

  private renderSelectOptions(
  select: HTMLSelectElement,
  options: PopupOption[],
  value?: string,
  fallbackLabel?: string,
): void {
  const currentSignature = JSON.stringify(options);

  if ((select.dataset.signature ?? "") !== currentSignature) {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }

    for (const option of options) {
      const el = select.ownerDocument.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      select.appendChild(el);
    }

    select.dataset.signature = currentSignature;
  }

  if (value && Array.from(select.options).some((option) => option.value === value)) {
    select.value = value;
  } else if (fallbackLabel) {
    const exists = Array.from(select.options).some(
      (option) => option.value === (value ?? ""),
    );

    if (!exists) {
      const fallback = select.ownerDocument.createElement("option");
      fallback.value = value ?? "";
      fallback.textContent = fallbackLabel;
      select.appendChild(fallback);
    }

    select.value = value ?? "";
  } else if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
}

  private getEl<T extends HTMLElement>(id: string): T | null {
    if (!this.popup || this.popup.closed) return null;
    return this.popup.document.getElementById(id) as T | null;
  }

  private getBadgeText(status: PopupState["status"]): string {
    switch (status) {
      case "loading":
        return "loading";
      case "success":
        return "active";
      case "error":
        return "error";
      default:
        return "idle";
    }
  }

  private buildPopupFeatures(geometry: PopupGeometry | null): string {
    const defaults = geometry ?? { width: 500, height: 520, left: 120, top: 120 };
    return [
      `width=${defaults.width}`,
      `height=${defaults.height}`,
      `left=${defaults.left}`,
      `top=${defaults.top}`,
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");
  }

  private readGeometry(): PopupGeometry | null {
    try {
      const raw = window.localStorage.getItem(PopupOverlayBridge.GEOMETRY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PopupGeometry>;
      if ([parsed.width, parsed.height, parsed.left, parsed.top].some((v) => typeof v !== "number")) {
        return null;
      }
      return {
        width: Math.max(420, Math.round(parsed.width!)),
        height: Math.max(420, Math.round(parsed.height!)),
        left: Math.round(parsed.left!),
        top: Math.round(parsed.top!),
      };
    } catch {
      return null;
    }
  }

  private attachGeometryPersistence(popup: Window): void {
    popup.addEventListener("beforeunload", () => {
      this.persistGeometry();
      this.popup = null;
    });
    popup.addEventListener("resize", () => this.scheduleGeometryPersist());
    popup.addEventListener("move", () => this.scheduleGeometryPersist());
  }

  private scheduleGeometryPersist(): void {
    if (this.geometrySaveTimer) {
      clearTimeout(this.geometrySaveTimer);
    }
    this.geometrySaveTimer = setTimeout(() => {
      this.geometrySaveTimer = null;
      this.persistGeometry();
    }, 200);
  }

  private persistGeometry(): void {
    if (!this.popup || this.popup.closed) return;
    try {
      const geometry: PopupGeometry = {
        width: this.popup.outerWidth,
        height: this.popup.outerHeight,
        left: this.popup.screenX,
        top: this.popup.screenY,
      };
      window.localStorage.setItem(PopupOverlayBridge.GEOMETRY_STORAGE_KEY, JSON.stringify(geometry));
    } catch {
      // ignore
    }
  }
}
