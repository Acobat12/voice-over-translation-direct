import { render } from "lit-html";

import type {
  Direction,
  Position,
  Status,
} from "../../types/components/votButton";
import UI from "../../ui";
import {
  CHEVRON_ICON,
  MENU_ICON,
  PIP_ICON_SVG,
  SUBTITLES_ICON,
  TRANSLATE_ICON_SVG,
  VOICE_WAVE_ICON,
} from "../icons";
import { getHiddenState, setHiddenState } from "./componentShared";

type VOTRailProps = {
  position?: Position;
  direction?: Direction;
  status?: Status;
  labelHtml?: string;
};

export default class VOTRail {
  container: HTMLElement;
  translateGroup: HTMLElement;
  translateButton: HTMLElement;
  translateLabel: HTMLElement;
  translateChevron: HTMLElement;
  subtitlesButton: HTMLElement;
  pipButton: HTMLElement;
  menuButton: HTMLElement;
  separator2: HTMLElement;

  private _opacity = 1;
  private _position: Position;
  private _direction: Direction;
  private _status: Status;
  private _labelText: string;

  constructor({
    position = "left",
    direction = "column",
    status = "none",
    labelHtml = "",
  }: VOTRailProps = {}) {
    this._position = position;
    this._direction = direction;
    this._status = status;
    this._labelText = labelHtml;

    const elements = this.createElements();
    this.container = elements.container;
    this.translateGroup = elements.translateGroup;
    this.translateButton = elements.translateButton;
    this.translateLabel = elements.translateLabel;
    this.translateChevron = elements.translateChevron;
    this.subtitlesButton = elements.subtitlesButton;
    this.pipButton = elements.pipButton;
    this.menuButton = elements.menuButton;
    this.separator2 = this.pipButton;
  }

  private createElements() {
    const container = UI.createEl("vot-block", ["vot-rail"]);
    container.dataset.position = this._position;
    container.dataset.direction = this._direction;
    container.dataset.status = this._status;

    const translateGroup = UI.createEl("vot-block", [
      "vot-rail-translate-group",
    ]);
    const translateButton = UI.createEl("vot-block", [
      "vot-rail-button",
      "vot-translate-button",
      "vot-rail-button-primary",
      "vot-rail-button-primary-action",
    ]);
    UI.makeButtonLike(translateButton, {
      ariaLabel: this._labelText || "Translate",
    });
    const translateIcon = UI.createEl("vot-block", [
      "vot-rail-button-icon",
      "vot-rail-button-icon--translate",
    ]);
    render(TRANSLATE_ICON_SVG, translateIcon);
    const voiceIcon = UI.createEl("vot-block", [
      "vot-rail-button-icon",
      "vot-rail-button-icon--voice",
    ]);
    render(VOICE_WAVE_ICON, voiceIcon);
    translateButton.setAttribute("title", this._labelText || "Translate");
    const translateLabel = UI.createEl("span", ["vot-rail-button-label"]);
    translateLabel.textContent = this._labelText || "Translate";
    const translateChevron = UI.createEl("vot-block", [
      "vot-rail-button",
      "vot-rail-button-chevron",
    ]);
    UI.makeButtonLike(translateChevron, {
      ariaLabel: "Select voice mode",
    });
    translateChevron.setAttribute("aria-haspopup", "dialog");
    translateChevron.setAttribute("aria-expanded", "false");
    render(CHEVRON_ICON, translateChevron);
    translateButton.append(translateIcon, voiceIcon, translateLabel);
    translateGroup.append(translateButton, translateChevron);

    const subtitlesButton = UI.createEl("vot-block", [
      "vot-rail-button",
      "vot-rail-button-secondary",
      "vot-subtitles-button",
    ]);
    UI.makeButtonLike(subtitlesButton, {
      ariaLabel: "Subtitles",
    });
    render(SUBTITLES_ICON, subtitlesButton);
    subtitlesButton.setAttribute("title", "Subtitles");

    const pipButton = UI.createEl("vot-block", [
      "vot-rail-button",
      "vot-rail-button-secondary",
      "vot-pip-button",
    ]);
    UI.makeButtonLike(pipButton, {
      ariaLabel: "Picture in picture",
    });
    render(PIP_ICON_SVG, pipButton);
    pipButton.setAttribute("title", "Picture in picture");

    const menuButton = UI.createEl("vot-block", [
      "vot-rail-button",
      "vot-rail-button-secondary",
      "vot-menu-button",
    ]);
    UI.makeButtonLike(menuButton, {
      ariaLabel: "Menu",
    });
    menuButton.setAttribute("aria-haspopup", "dialog");
    menuButton.setAttribute("aria-expanded", "false");
    render(MENU_ICON, menuButton);
    menuButton.setAttribute("title", "Menu");

    container.append(translateGroup, subtitlesButton, pipButton, menuButton);

    return {
      container,
      translateGroup,
      translateButton,
      translateLabel,
      translateChevron,
      subtitlesButton,
      pipButton,
      menuButton,
    };
  }

  setText(labelText: string) {
    this._labelText = labelText;
    const nextLabel = labelText || "Translate";
    this.translateLabel.textContent = nextLabel;
    this.translateButton.setAttribute("aria-label", nextLabel);
    this.translateButton.setAttribute("title", nextLabel);
    return this;
  }

  setButtonLabels({
    subtitles,
    pip,
    menu,
  }: {
    subtitles?: string;
    pip?: string;
    menu?: string;
  }) {
    if (subtitles) {
      this.subtitlesButton.setAttribute("aria-label", subtitles);
      this.subtitlesButton.setAttribute("title", subtitles);
    }

    if (pip) {
      this.pipButton.setAttribute("aria-label", pip);
      this.pipButton.setAttribute("title", pip);
    }

    if (menu) {
      this.menuButton.setAttribute("aria-label", menu);
      this.menuButton.setAttribute("title", menu);
    }

    return this;
  }

  showPiPButton(visible: boolean) {
    this.pipButton.hidden = !visible;
    return this;
  }

  showSubtitlesButton(visible: boolean) {
    this.subtitlesButton.hidden = !visible;
    return this;
  }

  remove() {
    this.container.remove();
    return this;
  }

  get tooltipPos() {
    return this.position === "right" ? "left" : "right";
  }

  set status(status: Status) {
    this._status = status;
    this.container.dataset.status = status;
  }

  get status() {
    return this._status;
  }

  set loading(isLoading: boolean) {
    this.container.dataset.loading = isLoading.toString();
  }

  get loading() {
    return this.container.dataset.loading === "true";
  }

  set hidden(isHidden: boolean) {
    setHiddenState(this.container, isHidden);
  }

  get hidden() {
    return getHiddenState(this.container);
  }

  get position() {
    return this._position;
  }

  set position(position: Position) {
    this._position = position;
    this.container.dataset.position = position;
  }

  get direction() {
    return this._direction;
  }

  set direction(direction: Direction) {
    this._direction = direction;
    this.container.dataset.direction = direction;
  }

  set opacity(opacity: number) {
    const nextOpacity = Number.isFinite(opacity) ? opacity : 1;
    this._opacity = nextOpacity;
    this.container.classList.toggle("vot-rail--hidden", nextOpacity <= 0.01);
  }

  get opacity() {
    return this._opacity;
  }
}
