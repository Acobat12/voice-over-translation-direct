import type { AudioChunk } from "./audioChunks";
import { getWebCreatorAudioChunks } from "./webCreator";
import type { WebAbrWindow } from "./youtubePlayer";
import { assertYouTubeAudioIsUsefulForVot } from "./youtubeSabrSupport";

export type { WebAbrWindow } from "./youtubePlayer";
export {
  getWebAbrResolvedAudioLanguage,
  type WebAbrResolvedAudioLanguage,
} from "./youtubeSabrSupport";

/** Independent WebABR / WEB_CREATOR transport; never invokes SABR. */
export async function* getWebAbrAudioChunks(
  targetWindow: WebAbrWindow,
  videoId: string,
  signal: AbortSignal,
  _transportStartIndex = 0,
  sourceLanguage?: string,
): AsyncGenerator<AudioChunk> {
  assertYouTubeAudioIsUsefulForVot(targetWindow, videoId, sourceLanguage);
  yield* getWebCreatorAudioChunks(
    targetWindow,
    videoId,
    signal,
    sourceLanguage,
  );
}
