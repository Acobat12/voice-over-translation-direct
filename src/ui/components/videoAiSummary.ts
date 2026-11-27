import YoutubeHelper from "../../core/youtubeHelper";
import { localizationProvider } from "../../localization/localizationProvider";
import { GM_fetch } from "../../utils/gm";

/** Optional AI summary: subtitle text + sampled video frames. No automatic uploads. */
const MAX_TRANSCRIPT = 250000;

function findVideo(): HTMLVideoElement | null {
  return (
    Array.from(document.querySelectorAll("video"))
      .filter((video) => video.videoWidth > 0 && video.videoHeight > 0)
      .sort(
        (a, b) =>
          b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
      )[0] ?? null
  );
}

function transcriptFromTracks(video: HTMLVideoElement | null): string {
  if (!video) return "";
  const lines: string[] = [];
  for (const track of Array.from(video.textTracks)) {
    if (track.kind !== "subtitles" && track.kind !== "captions") continue;
    if (!track.cues) continue;
    for (const cue of Array.from(track.cues)) {
      const text = (cue as VTTCue).text?.replace(/<[^>]*>/g, "").trim();
      if (text)
        lines.push(
          `${Math.floor(cue.startTime / 60)}:${String(Math.floor(cue.startTime % 60)).padStart(2, "0")} ${text}`,
        );
    }
    if (lines.length) break;
  }
  return lines.join("\n").slice(0, MAX_TRANSCRIPT);
}

type SubtitleSource = { url: string; language?: string; source?: string };
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function parseSubtitlePayload(raw: string): string {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data.events))
      return data.events
        .map((event: any) => {
          const text = (event.segs ?? [])
            .map((seg: any) => String(seg.utf8 ?? ""))
            .join("")
            .trim();
          return text
            ? `${formatTime(Number(event.tStartMs ?? 0) / 1000)} ${text}`
            : "";
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, MAX_TRANSCRIPT);
    if (Array.isArray(data))
      return data
        .map((item: any) => {
          const text = String(item.text ?? item.value ?? "").trim();
          return text
            ? `${formatTime(Number(item.start ?? item.startTime ?? 0))} ${text}`
            : "";
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, MAX_TRANSCRIPT);
  } catch {
    /* WebVTT or SRT */
  }
  let lastTime = 0;
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^(WEBVTT|NOTE|STYLE|REGION)/i.test(trimmed) ||
        /^\d+$/.test(trimmed)
      )
        return "";
      if (trimmed.includes("-->")) {
        const start = trimmed.split("-->")[0].trim().split(":").map(Number);
        if (start.length >= 2 && start.every(Number.isFinite))
          lastTime = start.reduce((sum, value) => sum * 60 + value, 0);
        return "";
      }
      return `${formatTime(lastTime)} ${trimmed.replace(/<[^>]+>/g, "").trim()}`;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TRANSCRIPT);
}
async function loadSubtitleSources(
  sources: SubtitleSource[],
): Promise<{ text: string; source: string }> {
  for (const source of sources) {
    if (!/^https?:\/\//i.test(source.url)) continue;
    try {
      const response = await GM_fetch(source.url, {
        method: "GET",
        forceGmXhr: true,
        timeout: 12000,
      });
      if (!response.ok) continue;
      const text = parseSubtitlePayload(await response.text());
      if (text.trim())
        return {
          text,
          source: `${source.source ?? localizationProvider.get("VOTSummarySource")} (${source.language ?? localizationProvider.get("VOTSummaryAuto")})`,
        };
    } catch {
      /* next subtitle source */
    }
  }
  return { text: "", source: "" };
}
function collectSources(extra: SubtitleSource[]): SubtitleSource[] {
  const candidates: SubtitleSource[] = [...extra];
  try {
    candidates.push(...YoutubeHelper.getSubtitles("ru"));
  } catch {
    /* not YouTube */
  }
  for (const track of document.querySelectorAll("video track[src]")) {
    const src = track.getAttribute("src");
    if (src)
      try {
        candidates.push({
          url: new URL(src, document.baseURI).href,
          language: track.getAttribute("srclang") ?? undefined,
          source: "HTML5",
        });
      } catch {
        /* invalid URL */
      }
  }
  const unique = new Map<string, SubtitleSource>();
  for (const item of candidates) if (item?.url) unique.set(item.url, item);
  return [...unique.values()];
}

type Caption = { time: number; text: string };

function parseTime(raw: string): number | null {
  const parts = raw.replace(",", ".").trim().split(":");
  if (
    parts.length > 3 ||
    parts.length < 2 ||
    parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))
  )
    return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function normalizeText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|nbsp|lt|gt|quot);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCaptions(raw: string): Caption[] {
  const captions: Caption[] = [];
  let lastTime = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^WEBVTT|^NOTE|^STYLE|^REGION/i.test(trimmed)) continue;
    const arrow = trimmed.match(
      /(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?\s*-->\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2})/,
    );
    if (arrow) {
      lastTime = parseTime(arrow[0].split("-->")[0]) ?? lastTime;
      continue;
    }
    if (/^\d+$/.test(trimmed)) continue;
    const timestamp = trimmed.match(
      /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\]?\s*[-–:]?\s*(.+)$/,
    );
    const time = timestamp ? parseTime(timestamp[1]) : null;
    const content = normalizeText(timestamp ? timestamp[2] : trimmed);
    if (content) captions.push({ time: time ?? lastTime, text: content });
  }
  const unique: Caption[] = [];
  for (const caption of captions) {
    const prev = unique[unique.length - 1];
    if (
      prev &&
      (prev.text === caption.text ||
        (caption.text.startsWith(prev.text) && caption.time - prev.time < 6))
    ) {
      if (caption.text.length > prev.text.length) prev.text = caption.text;
      continue;
    }
    unique.push(caption);
  }
  return unique;
}

const STOPWORDS = new Set(
  "и в во на по для при из под над к ко от до за об обо о а но или что это как так то же бы был была были есть его её их они мы вы он она оно не ни да если уже еще ещё тут там вот только очень также тоже потому поэтому когда где кто чем чем-то про без после перед между через чтобы который которая которые которых которого этой этого эти этот все всё всех всем свою свои свой своих можно нужно надо будет более менее такой такая такие такой-то либо даже ведь либо ли у нас вам вам-то ну значит просто вообще здесь тогда сейчас далее".split(
    /\s+/,
  ),
);

function words(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
    (word) => !STOPWORDS.has(word),
  );
}

function summarizeCaptions(raw: string): { output: string; count: number } {
  const captions = parseCaptions(raw);
  if (!captions.length)
    throw new Error(localizationProvider.get("VOTSummaryEmpty"));
  const sentences: Caption[] = [];
  let buffer = "";
  let start = captions[0].time;
  for (const caption of captions) {
    if (!buffer) start = caption.time;
    buffer += (buffer ? " " : "") + caption.text;
    if (/[.!?…]$/.test(caption.text) || buffer.length > 240) {
      sentences.push({ time: start, text: buffer.trim() });
      buffer = "";
    }
  }
  if (buffer) sentences.push({ time: start, text: buffer.trim() });
  // Count words across all subtitles, then score informative, non-repetitive statements.
  const frequency = new Map<string, number>();
  const tokens = sentences.map((item) => [...new Set(words(item.text))]);
  for (const set of tokens)
    for (const word of set) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const scored = sentences.map((item, index) => {
    const terms = tokens[index];
    const relevance =
      terms.reduce(
        (score, term) => score + Math.log(1 + (frequency.get(term) ?? 0)),
        0,
      ) / Math.sqrt(Math.max(1, terms.length));
    const lengthPenalty =
      item.text.length < 35 ? 0.35 : item.text.length > 380 ? 0.75 : 1;
    return { ...item, score: relevance * lengthPenalty, terms: new Set(terms) };
  });
  const target = Math.min(12, Math.max(3, Math.ceil(sentences.length * 0.18)));
  const selected: typeof scored = [];
  for (const candidate of [...scored].sort((a, b) => b.score - a.score)) {
    if (selected.length >= target) break;
    const repetitive = selected.some((prev) => {
      const common = [...candidate.terms].filter((word) =>
        prev.terms.has(word),
      ).length;
      return (
        common / Math.max(1, Math.min(candidate.terms.size, prev.terms.size)) >
        0.76
      );
    });
    if (!repetitive) selected.push(candidate);
  }
  if (!selected.length) selected.push(scored[0]);
  selected.sort((a, b) => a.time - b.time);
  return {
    output:
      localizationProvider
        .get("VOTSummaryHeading")
        .replace("{0}", String(selected.length))
        .replace("{1}", String(sentences.length)) +
      "\n\n" +
      selected
        .map((item) => `[${formatTime(item.time)}] ${item.text}`)
        .join("\n\n") +
      "\n\n" +
      localizationProvider.get("VOTSummaryDisclaimer"),
    count: captions.length,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Local extractive summary. No API key, neural model, video frames or remote AI requests. */
export function openVideoAiSummary(extraSources: SubtitleSource[] = []): void {
  const existing = document.getElementById("vot-ai-summary-dialog");
  if (existing) {
    existing.remove();
    return;
  }
  const backdrop = el("div");
  backdrop.id = "vot-ai-summary-dialog";
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box";
  const panel = el("section");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", localizationProvider.get("VOTSummaryTitle"));
  panel.style.cssText =
    "box-sizing:border-box;width:min(620px,100%);max-height:90vh;overflow:auto;background:#202124;color:#f1f3f4;border-radius:16px;padding:20px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px #0008";
  const title = el("h2", localizationProvider.get("VOTSummaryTitle"));
  title.style.cssText = "margin:0 0 8px;font-size:19px";
  const note = el(
    "p",
    "Быстрая локальная выборка важных фрагментов субтитров с таймкодами. Не требуется API-ключ или загрузка ИИ-модели. Субтитры могут загружаться с видеосайта, но их содержимое не отправляется сервисам ИИ.",
  );
  note.style.cssText = "margin:0 0 12px;opacity:.85";
  const transcriptLabel = el(
    "label",
    localizationProvider.get("VOTSummaryTranscript"),
  );
  const transcript = el("textarea");
  transcript.rows = 8;
  transcript.value = transcriptFromTracks(findVideo());
  transcript.placeholder = localizationProvider.get("VOTSummaryPlaceholder");
  const status = el("p", "");
  status.setAttribute("role", "status");
  const reloadSubtitles = el(
    "button",
    localizationProvider.get("VOTSummaryFind"),
  );
  reloadSubtitles.type = "button";
  const fetchSubtitles = async () => {
    status.textContent = localizationProvider.get("VOTSummarySearching");
    const fromTracks = transcriptFromTracks(findVideo());
    if (fromTracks.trim()) {
      transcript.value = fromTracks;
      status.textContent = localizationProvider.get("VOTSummaryFromPlayer");
      return;
    }
    const loaded = await loadSubtitleSources(collectSources(extraSources));
    if (!backdrop.isConnected) return;
    if (loaded.text) {
      transcript.value = loaded.text;
      status.textContent = localizationProvider
        .get("VOTSummaryLoaded")
        .replace("{0}", () => loaded.source);
    } else
      status.textContent = localizationProvider.get("VOTSummaryUnavailable");
  };
  reloadSubtitles.addEventListener("click", () => {
    void fetchSubtitles();
  });
  const result = el("pre");
  result.style.cssText =
    "white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:12px 0 0";
  const actions = el("div");
  actions.style.cssText = "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap";
  const analyze = el("button", localizationProvider.get("VOTSummaryRun"));
  const close = el("button", localizationProvider.get("VOTSummaryClose"));
  transcript.style.cssText =
    "display:block;box-sizing:border-box;width:100%;margin:5px 0 12px;background:#303134;color:white;border:1px solid #777;border-radius:8px;padding:9px;font:inherit";
  for (const button of [analyze, close, reloadSubtitles])
    button.style.cssText =
      "background:#8ab4f8;color:#202124;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;font:inherit";
  const dismiss = () => backdrop.remove();
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dismiss();
  });
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
  });
  analyze.addEventListener("click", () => {
    try {
      const summary = summarizeCaptions(transcript.value);
      result.textContent = summary.output;
      status.textContent = localizationProvider
        .get("VOTSummaryDone")
        .replace("{0}", String(summary.count));
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
  actions.append(analyze, close);
  panel.append(
    title,
    note,
    transcriptLabel,
    transcript,
    reloadSubtitles,
    actions,
    status,
    result,
  );
  backdrop.append(panel);
  document.body.append(backdrop);
  void fetchSubtitles();
}
