import type { VideoData as CoreVideoData } from "@vot.js/core/types/client";
import type { TranslationHelp } from "@vot.js/core/types/yandex";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";
import type { SubtitleDescriptor } from "../subtitles/types";

export type VideoData = Omit<
  CoreVideoData<string>,
  "duration" | "detectedLanguage" | "translationHelp" | "isStream" | "subtitles"
> & {
  downloadTitle: string;
  duration: number;
  detectedLanguage: RequestLang;
  responseLanguage: ResponseLang;
  isStream: boolean;
  translationHelp: TranslationHelp[] | null;
  subtitles?: SubtitleDescriptor[];
};

/**
 * Country code used for proxy settings. Populated lazily during init.
 */
export let countryCode: string | undefined;

export function setCountryCode(next: string | undefined) {
  countryCode = next;
}
