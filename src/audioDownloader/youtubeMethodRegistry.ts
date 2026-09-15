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

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

export function getYouTubeStrategyOrder(): Array<"ytAudio" | "webMseProxy"> {
  const winner = readWinner()?.method;
  if (winner === "mse") return ["webMseProxy", "ytAudio"];
  if (winner && winner !== "empty-audio") return ["ytAudio", "webMseProxy"];
  return shuffle(["ytAudio", "webMseProxy"] as const);
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
  console.log("[VOT][youtube-method] translation succeeded", next);
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
