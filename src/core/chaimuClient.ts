import config from "chaimu/config";
import { AudioPlayer, ChaimuPlayer, initAudioContext } from "chaimu/player";
import type {
  ChaimuOpts,
  FetchFunction,
  FetchOpts,
} from "chaimu/types/controller";

export default class Chaimu {
  _debug = false;
  audioContext: AudioContext | undefined;
  player: AudioPlayer | ChaimuPlayer;
  video: HTMLVideoElement;
  fetchFn: FetchFunction;
  fetchOpts: FetchOpts;

  constructor({
    url,
    video,
    debug = false,
    fetchFn = config.fetchFn,
    fetchOpts = {},
    preferAudio = false,
  }: ChaimuOpts) {
    this._debug = config.debug = debug;
    this.fetchFn = fetchFn;
    this.fetchOpts = fetchOpts;

    this.audioContext = preferAudio ? undefined : initAudioContext();

    this.player = preferAudio
      ? new AudioPlayer(this, url)
      : new ChaimuPlayer(this, url);

    this.video = video;
  }

  async init() {
    await this.player.init();
    if (this.video && !this.video.paused) {
      this.player.lipSync("play");
    }
    this.player.addVideoEvents();
  }

  set debug(value: boolean) {
    this._debug = config.debug = value;
  }

  get debug() {
    return this._debug;
  }
}
