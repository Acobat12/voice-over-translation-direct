export type YouTubeAudioMethod =
  | "innertube-abr"
  | "page-adaptive"
  | "page-progressive"
  | "mse"
  | "empty-audio"
  | "player-mse-tap"
  | "youtube-hls"
  | "external-provider";

const STORAGE_KEY = "vot.youtubeAudioMethod.v1";
type StoredWinner = {
  method: YouTubeAudioMethod;
  successes: number;
  updatedAt: number;
};

function readWinner(): StoredWinner | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as StoredWinner | null;
    return value && typeof value.method === "string" && value.successes > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

export function getRememberedYouTubeTranslationMethod():
  | YouTubeAudioMethod
  | undefined {
  return readWinner()?.method;
}

export function getYouTubeStrategyOrder(): Array<"ytAudio" | "webMseProxy"> {
  // Do not use the legacy hidden YouTube embed: it can fail with error 153.
  return ["ytAudio"];
}

export function rememberYouTubeTranslationMethod(
  method: YouTubeAudioMethod,
): void {
  const previous = readWinner();
  const next = {
    method,
    successes: previous?.method === method ? previous.successes + 1 : 1,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* optional */
  }
  console.log("[FORK][youtube-method] translation succeeded", next);
}

export function getYouTubeMethodLabel(method: YouTubeAudioMethod): string {
  const labels: Record<YouTubeAudioMethod, string> = {
    "innertube-abr": "Innertube ABR",
    "page-adaptive": "YouTube player adaptive URL",
    "page-progressive": "YouTube player progressive MP4",
    mse: "MSE capture",
    "empty-audio": "Yandex server source (empty-audio fallback)",
    "player-mse-tap": "Player/MSE tap",
    "youtube-hls": "YouTube HLS",
    "external-provider": "External provider",
  };
  return labels[method];
}
