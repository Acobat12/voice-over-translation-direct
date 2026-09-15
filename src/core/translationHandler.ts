import {
	type TranslatedVideoTranslationResponse,
	type TranslationHelp,
	type VideoTranslationResponse,
	VideoTranslationStatus,
} from "@vot.js/core/types/yandex";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";

import type { VideoData, VideoHandler } from "..";
import { AudioDownloader } from "../audioDownloader";
import {
	DOUYIN_AUDIO_STRATEGY,
	VK_AUDIO_STRATEGY,
	WEB_ABR_STRATEGY,
	WEB_MSE_PROXY_STRATEGY,
	YT_AUDIO_STRATEGY,
} from "../audioDownloader/strategies";
import { localizationProvider } from "../localization/localizationProvider";
import type {
	DownloadedAudioData,
	DownloadedPartialAudioData,
} from "../types/audioDownloader";
import { NEVER_ABORTED_SIGNAL, throwIfAborted } from "../utils/abort";
import debug from "../utils/debug";
import { getErrorMessage, isAbortError, makeAbortError } from "../utils/errors";
import {
	adjustTranslationEtaForDisplay,
	formatTranslationEta,
} from "../utils/timeFormatting";
import VOTLocalizedError from "../utils/VOTLocalizedError";
import { notifyTranslationFailureIfNeeded } from "../videoHandler/modules/translationShared";

type VotClientErrorShape = {
	name?: unknown;
	message?: unknown;
	data?: {
		message?: unknown;
	};
};

function asVotClientErrorShape(value: unknown): VotClientErrorShape | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as {
		name?: unknown;
		message?: unknown;
		data?: unknown;
	};
	const data =
		candidate.data && typeof candidate.data === "object"
			? (candidate.data as { message?: unknown })
			: undefined;

	return {
		name: candidate.name,
		message: candidate.message,
		data,
	};
}

function getServerErrorMessage(value: unknown): string | undefined {
	const err = asVotClientErrorShape(value);
	const message = err?.data?.message;
	return typeof message === "string" && message.length > 0
		? message
		: undefined;
}

export function isCompletedTranslationResponse(
	response: Pick<
		VideoTranslationResponse,
		"translated" | "status" | "url" | "remainingTime"
	>,
): response is TranslatedVideoTranslationResponse {
	return Boolean(
		response.translated &&
			(response.status === VideoTranslationStatus.FINISHED ||
				response.status === VideoTranslationStatus.PART_CONTENT) &&
			typeof response.url === "string" &&
			response.url.length > 0,
	);
}

/**
 * Historically we used `patch-package` to make `@vot.js/core` throw
 * `VOTLocalizedError` for a few common failure cases.
 *
 * We now keep the dependency unpatched and instead map known error messages
 * coming from the VOT client to the corresponding localized UI errors.
 */
function mapVotClientErrorForUi(error: unknown, siteHost?: string): unknown {
	const err = asVotClientErrorShape(error);
	if (!err) {
		return error;
	}
	if (err.name !== "VOTJSError") {
		return error;
	}

	const message = typeof err.message === "string" ? err.message : "";
	const serverMessage =
		typeof err.data?.message === "string" ? err.data.message : "";

	console.log("[VOT][mapVotClientErrorForUi]", {
		siteHost,
		originalMessage: message,
		serverMessage,
		rawError: error,
	});

	if (
		message === "Audio link wasn't received" ||
		message === "Audio link wasn't received from VOT response"
	) {
		return new VOTLocalizedError("audioNotReceived");
	}

	if (siteHost === "yandexdisk") {
		if (serverMessage) {
			return new Error(serverMessage);
		}
		return error;
	}
	if (serverMessage) {
		return new Error(serverMessage);
	}

	if (message === "Failed to request video translation") {
		return new VOTLocalizedError("requestTranslationFailed");
	}

	if (message === "Yandex couldn't translate video") {
		return new VOTLocalizedError("requestTranslationFailed");
	}

	return error;
}

type DownloadWaiter = {
	resolve: () => void;
	reject: (error: Error) => void;
};

type YandexDiskResolvedTarget = {
	url: string;
	videoId: string;
	host?: VideoData["host"];
	title?: string;
};

type CachedAudioUpload =
	| {
			key: string;
			kind: "full";
			translationId: string;
			videoId: string;
			videoUrl: string;
			fileId: string;
			audioData: Uint8Array;
	  }
	| {
			key: string;
			kind: "partial";
			translationId: string;
			videoId: string;
			videoUrl: string;
			fileId: string;
			chunks: Array<{
				audioData: Uint8Array;
				index: number;
				amount: number;
				version: number;
			}>;
	  };

const POST_AUDIO_TRANSLATE_RETRY_DELAY_MS = 5000;
const MAX_POST_AUDIO_TRANSLATE_RETRIES = 12;
const _YOUTUBE_SERVER_POLL_MAX_INITIAL_WAIT_SEC = 180;
const _YOUTUBE_SERVER_POLL_LONG_WAIT_MS = 120000;
const YOUTUBE_AUDIO_STREAM_TIMEOUT_MS = 30 * 60 * 1000;
const YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS = 30000;
const MAX_YOUTUBE_SERVER_POLL_ERROR_RETRIES = 60;

export class VOTTranslationHandler {
	readonly videoHandler: VideoHandler;
	readonly audioDownloader: AudioDownloader;
	downloading: boolean;
	private readonly downloadWaiters = new Set<DownloadWaiter>();
	private downloadFailureError?: Error;

	private activeTranslationUrl?: string;
	private activeAudioUploadUrl?: string;
	private translationRequestStateUrl?: string;
	private translationRequestStarted = false;
	private activeTranslationVoiceMode?: boolean;
	private handledAudioRequestKey?: string;
	private currentAudioRequestKey?: string;
	private cachedAudioUpload?: CachedAudioUpload;
	private repeatedAudioRequestCount = 0;
	private samePayloadReplayDone = false;
	private alternateTransportRetryDone = false;
	private webAbrTransportStartIndex = 0;
	private postAudioTranslateRetryCount = 0;
	private youtubeServerPollActive = false;
	private youtubeServerPollErrorCount = 0;
	private youtubeServerPollLastStatus?: number;
	private youtubeServerPollLastRemainingTime?: number;
	private youtubeServerPollLastTranslationId?: string;
	private youtubeServerPollRetryAttempt = 0;
	private youtubeFailedAudioSignalUrl?: string;
	private activeYandexDiskResolvedVideoData?: VideoData;

	constructor(videoHandler: VideoHandler) {
		this.videoHandler = videoHandler;

		const strategy =
			this.videoHandler.site.host === "vk"
				? VK_AUDIO_STRATEGY
				: this.videoHandler.site.host === "youtube"
					? WEB_ABR_STRATEGY
					: this.videoHandler.site.host === "yandexdisk"
						? "yandexDisk"
						: this.videoHandler.site.host === "douyin"
							? DOUYIN_AUDIO_STRATEGY
							: this.videoHandler.site.host === "custom"
								? "localFile"
								: YT_AUDIO_STRATEGY;

		this.audioDownloader = new AudioDownloader(strategy as any);
		this.downloading = false;

		this.audioDownloader
			.addEventListener("downloadedAudio", this.onDownloadedAudio)
			.addEventListener("downloadedPartialAudio", this.onDownloadedPartialAudio)
			.addEventListener("downloadAudioError", this.onDownloadAudioError);
	}

	isSourceAudioUploadInProgress(): boolean {
		return this.downloading;
	}

	resetTranslationRequestState(reason?: unknown): void {
		debug.log("[VOT][translate] reset request state", { reason });
		this.translationRequestStateUrl = undefined;
		this.activeAudioUploadUrl = undefined;
		this.translationRequestStarted = false;
		this.activeTranslationVoiceMode = undefined;
		this.handledAudioRequestKey = undefined;
		this.currentAudioRequestKey = undefined;
		this.cachedAudioUpload = undefined;
		this.repeatedAudioRequestCount = 0;
		this.samePayloadReplayDone = false;
		this.alternateTransportRetryDone = false;
		this.webAbrTransportStartIndex = 0;
		this.postAudioTranslateRetryCount = 0;
		this.youtubeServerPollActive = false;
		this.youtubeServerPollErrorCount = 0;
		this.youtubeServerPollLastStatus = undefined;
		this.youtubeServerPollLastRemainingTime = undefined;
		this.youtubeServerPollLastTranslationId = undefined;
		this.youtubeServerPollRetryAttempt = 0;
		this.youtubeFailedAudioSignalUrl = undefined;
	}

	private async prepareSourceAudioUpload(signal: AbortSignal): Promise<void> {
		if (
			this.videoHandler.site.host !== "youtube" ||
			this.audioDownloader.strategy !== WEB_MSE_PROXY_STRATEGY
		) {
			return;
		}

		const handlerVideo = this.videoHandler.video;
		if (!handlerVideo?.paused) {
			return;
		}

		const activeYouTubeVideo = Array.from(
			document.querySelectorAll<HTMLVideoElement>(
				"video.html5-main-video, .html5-video-container video, video",
			),
		)
			.filter((candidate) => {
				if (candidate.paused || candidate.ended) return false;
				if (candidate.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
					return false;
				const rect = candidate.getBoundingClientRect();
				return (
					rect.width > 80 &&
					rect.height > 80 &&
					rect.bottom > 0 &&
					rect.top < globalThis.innerHeight
				);
			})
			.sort((a, b) => {
				const ar = a.getBoundingClientRect();
				const br = b.getBoundingClientRect();
				return br.width * br.height - ar.width * ar.height;
			})[0];

		if (activeYouTubeVideo) {
			console.log(
				"[VOT][source-audio-upload] handler video is stale/paused; active YouTube video is playing",
				{
					videoId: this.videoHandler.videoData?.videoId,
					handlerCurrentTime: Number(handlerVideo.currentTime.toFixed(3)),
					activeCurrentTime: Number(activeYouTubeVideo.currentTime.toFixed(3)),
					activeReadyState: activeYouTubeVideo.readyState,
				},
			);
			return;
		}

		// Only ask the user to start playback when no currently-playing YouTube
		// media element can be found at all.
		console.log("[VOT][source-audio-upload] waiting for YouTube playback", {
			videoId: this.videoHandler.videoData?.videoId,
			currentTime: Number(handlerVideo.currentTime.toFixed(3)),
			readyState: handlerVideo.readyState,
		});

		await this.videoHandler.updateTranslationErrorMsg(
			new VOTLocalizedError("VOTStartVideoForTranslation"),
			signal,
		);
	}

	private shouldRetryPostAudioTranslateError(error: unknown): boolean {
		if (!this.handledAudioRequestKey) {
			return false;
		}

		if (
			this.videoHandler.site.host !== "youtube" &&
			this.videoHandler.videoData?.host !== "youtube"
		) {
			return false;
		}

		if (this.postAudioTranslateRetryCount >= MAX_POST_AUDIO_TRANSLATE_RETRIES) {
			return false;
		}

		return getErrorMessage(error) === "Failed to request video translation";
	}

	private shouldRetryYouTubeProcessingError(error: unknown): boolean {
		const message = getErrorMessage(error);
		const serverMessage = getServerErrorMessage(error) ?? "";
		const _combinedMessage = `${message} ${serverMessage}`.toLowerCase();

		// Only retry a transport/request failure here.
		// A server-side translation failure is terminal: stop the current task
		// instead of polling the same dead translationId again.
		return message === "Failed to request video translation";
	}

	private isYouTubeTranslationRequest(videoData?: VideoData): boolean {
		const siteHost = String(this.videoHandler.site.host || "").toLowerCase();
		const dataHost = String(videoData?.host || "").toLowerCase();
		const requestUrl = String(videoData?.url || "");

		if (siteHost === "youtube" || dataHost === "youtube") {
			return true;
		}

		if (/^https:\/\/youtu\.be\//i.test(requestUrl)) {
			return true;
		}

		if (/^https:\/\/(?:www\.|m\.|music\.)?youtube\.com\//i.test(requestUrl)) {
			return true;
		}

		const pageHost = String(globalThis.location?.hostname || "").toLowerCase();
		return (
			/(^|\.)youtube\.com$/i.test(pageHost) &&
			siteHost !== "googledrive" &&
			dataHost !== "googledrive"
		);
	}

	private rememberYouTubeServerPollState(
		response: VideoTranslationResponse,
		requestVideoData?: VideoData,
	): void {
		if (!this.isYouTubeTranslationRequest(requestVideoData)) {
			return;
		}

		if (
			response.status !== VideoTranslationStatus.WAITING &&
			response.status !== VideoTranslationStatus.LONG_WAITING
		) {
			return;
		}

		this.youtubeServerPollActive = true;
		this.youtubeServerPollErrorCount = 0;
		this.youtubeServerPollLastStatus = response.status;
		this.youtubeServerPollLastRemainingTime =
			typeof response.remainingTime === "number"
				? response.remainingTime
				: undefined;
		this.youtubeServerPollLastTranslationId =
			response.translationId === undefined || response.translationId === null
				? undefined
				: String(response.translationId);
	}

	private getYouTubeServerPollDelayMs(
		remainingTimeSeconds: number | null | undefined,
	): number {
		// Poll YouTube translation tasks at a fixed interval. The server ETA is
		// still used for the UI text, but it no longer delays readiness checks.
		void remainingTimeSeconds;
		return YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS;
	}

	private normalizeUrlForRequest(raw: string): string {
		try {
			return new URL(raw, globalThis.location.href).toString();
		} catch {
			return String(raw || "");
		}
	}

	private normalizeOdyseeDirectUrl(url: string): string {
		try {
			if (!url) {
				return url;
			}

			const m = url.match(
				/^https:\/\/player\.odycdn\.com\/api\/v3\/streams\/free\/[^/]+\/([a-f0-9]+)\/([^/?#]+\.mp4)(?:[?#].*)?$/i,
			);

			if (m) {
				const claimId = m[1];
				const fileName = m[2];
				return `https://player.odycdn.com/v6/streams/${claimId}/${fileName}`;
			}
		} catch {
			// ignore
		}

		return url;
	}

	private getCurrentMediaRequestUrl(videoData?: VideoData): string {
		return this.normalizeUrlForRequest(
			String(
				videoData?.url ||
					this.videoHandler.video?.currentSrc ||
					this.videoHandler.video?.src ||
					globalThis.location.href,
			),
		);
	}
	private isHlsManifestUrl(url: string): boolean {
		return /\.m3u8(?:[?#]|$)/i.test(String(url || ""));
	}

	private isCustomLinkUrl(url: string): boolean {
		if (!url) {
			return false;
		}

		try {
			return this.videoHandler.votClient.isCustomLink(url);
		} catch {
			return (
				/\.(m3u8|m4(?:a|v)|mpd)(?:[?#]|$)/i.test(url) ||
				/^https:\/\/cdn\.qstv\.on\.epicgames\.com/i.test(url)
			);
		}
	}

	private shouldUseCustomLinkWorkflow(videoData?: VideoData): boolean {
		if (!videoData) {
			return false;
		}

		if (
			this.videoHandler.site.host !== "custom" &&
			videoData.host !== "custom"
		) {
			return false;
		}

		return this.isCustomLinkUrl(this.getCurrentMediaRequestUrl(videoData));
	}

	private getM3u8ProxyEndpointUrl(): URL | null {
		const rawHost = String(this.videoHandler.data?.m3u8ProxyHost || "").trim();

		if (!rawHost) {
			return null;
		}

		const withScheme = /^[a-z][a-z\d+.-]*:/i.test(rawHost)
			? rawHost
			: `https://${rawHost}`;

		try {
			const parsed = new URL(withScheme);
			const normalizedPath =
				parsed.pathname && parsed.pathname !== "/"
					? parsed.pathname.replace(/\/+$/g, "")
					: "/v1/proxy/m3u8";

			return new URL(`${parsed.origin}${normalizedPath}`);
		} catch (error) {
			console.log("[VOT][upload] invalid m3u8 proxy host", {
				rawHost,
				error,
			});
			return null;
		}
	}

	private buildProxiedHlsUrl(rawUrl: string): string {
		const normalizedTargetUrl = this.normalizeUrlForRequest(rawUrl);
		const proxyEndpoint = this.getM3u8ProxyEndpointUrl();

		if (!proxyEndpoint) {
			return normalizedTargetUrl;
		}

		try {
			const target = new URL(normalizedTargetUrl, globalThis.location.href);
			const proxyUrl = new URL(proxyEndpoint.toString());
			proxyUrl.searchParams.set("format", "base64");
			proxyUrl.searchParams.set("force", "true");
			proxyUrl.searchParams.set("all", "1");
			proxyUrl.searchParams.set("url", btoa(target.toString()));

			if (target.origin && target.origin !== "null") {
				proxyUrl.searchParams.set("origin", target.origin);
				proxyUrl.searchParams.set("referer", target.origin);
			}

			// Keep the `.m3u8` marker in the URL so `@vot.js/core` routes it through
			// the VOT custom-link flow instead of the regular Yandex site flow.
			proxyUrl.hash = "playlist.m3u8";
			return proxyUrl.toString();
		} catch (error) {
			console.log("[VOT][upload] failed to build proxied hls url", {
				rawUrl,
				error,
			});
			return normalizedTargetUrl;
		}
	}

	private buildCustomLinkWorkflowVideoData(videoData: VideoData): VideoData {
		const currentUrl = this.getCurrentMediaRequestUrl(videoData);
		const requestUrl = this.isHlsManifestUrl(currentUrl)
			? this.buildProxiedHlsUrl(currentUrl)
			: currentUrl;
		const videoId =
			typeof videoData.videoId === "string" &&
			videoData.videoId.trim().length > 0
				? videoData.videoId
				: currentUrl;

		console.log("[VOT][upload] custom-link workflow input", {
			originalUrl: currentUrl,
			requestUrl,
			host: videoData.host,
			proxied: requestUrl !== currentUrl,
			proxyHost: this.videoHandler.data?.m3u8ProxyHost,
		});

		return {
			...videoData,
			url: requestUrl,
			videoId,
		};
	}

	private isDirectMediaUrlCandidate(url: string): boolean {
		if (!url) {
			return false;
		}

		if (this.isHlsManifestUrl(url)) {
			return false;
		}

		try {
			return this.videoHandler.votClient.isDirectMediaUrl(url);
		} catch {
			return false;
		}
	}

	private isCrossOriginMediaUrl(url: string): boolean {
		try {
			const parsed = new URL(url, globalThis.location.href);
			return parsed.hostname !== globalThis.location.hostname;
		} catch {
			return false;
		}
	}

	private shouldUseLocalFileWorkflow(videoData?: VideoData): boolean {
		if (!videoData) {
			return false;
		}

		const url = this.getCurrentMediaRequestUrl(videoData);
		if (!this.isDirectMediaUrlCandidate(url)) {
			return false;
		}
		if (
			this.videoHandler.site.host === "douyin" ||
			videoData.host === "douyin"
		) {
			return false;
		}

		if (
			this.videoHandler.site.host === "custom" ||
			videoData.host === "custom"
		) {
			return true;
		}

		return this.isCrossOriginMediaUrl(url);
	}

	private buildLocalFileWorkflowVideoData(videoData: VideoData): VideoData {
		let url = this.getCurrentMediaRequestUrl(videoData);

		if (
			this.videoHandler.site.host === "odysee" ||
			videoData.host === "odysee"
		) {
			url = this.normalizeUrlForRequest(this.normalizeOdyseeDirectUrl(url));
		}

		const videoId =
			typeof videoData.videoId === "string" &&
			videoData.videoId.trim().length > 0
				? videoData.videoId
				: url;

		return {
			...videoData,
			host: "custom",
			url,
			videoId,
		};
	}

	private updateAudioDownloaderStrategy(videoData?: VideoData): void {
		const url = videoData ? this.getCurrentMediaRequestUrl(videoData) : "";

		const isLocalFileCompatibleCustom =
			(this.videoHandler.site.host === "custom" ||
				videoData?.host === "custom") &&
			!this.isHlsManifestUrl(url) &&
			this.isDirectMediaUrlCandidate(url);

		const useLocalFileWorkflow =
			isLocalFileCompatibleCustom || this.shouldUseLocalFileWorkflow(videoData);

		const isVkCdnContext =
			this.videoHandler.site.host === "vk" ||
			this.videoHandler.site.host === "okru" ||
			/^player\.cdnvideohub\.com$/i.test(globalThis.location.hostname) ||
			/(?:^|\.)okcdn\.ru$/i.test(globalThis.location.hostname) ||
			/(?:^|\.)okcdn\.ru/i.test(url);

		const nextStrategy = useLocalFileWorkflow
			? "localFile"
			: isVkCdnContext
				? VK_AUDIO_STRATEGY
				: this.videoHandler.site.host === "yandexdisk"
					? "yandexDisk"
					: this.videoHandler.site.host === "douyin"
						? DOUYIN_AUDIO_STRATEGY
						: this.videoHandler.site.host === "youtube"
							? WEB_ABR_STRATEGY
							: YT_AUDIO_STRATEGY;

		if (this.audioDownloader.strategy === nextStrategy) {
			return;
		}

		this.audioDownloader.strategy = nextStrategy;
		console.log("[VOT][audio] switched downloader strategy", {
			siteHost: this.videoHandler.site.host,
			videoHost: videoData?.host,
			strategy: nextStrategy,
			url: videoData?.url,
		});
	}

	private isDirectResolvedUploadVideoData(
		data: VideoData | undefined,
	): data is VideoData {
		if (!data) {
			return false;
		}

		const rawUrl = String(data.url || "");
		if (!rawUrl.length || this.isYandexDiskDownloadUrl(rawUrl)) {
			return false;
		}

		if (data.host === "yandexdisk") {
			return true;
		}

		if (data.host === "custom") {
			try {
				return this.videoHandler.votClient.isDirectMediaUrl(rawUrl);
			} catch {
				return false;
			}
		}

		return false;
	}

	private parseYandexDiskUrl(rawUrl: string): {
		mode: "file" | "folderRoot" | "folderFile" | "unknown";
		origin: string;
		pathname: string;
		fileId?: string;
		folderId?: string;
	} {
		const fallback = String(rawUrl || globalThis.location.href || "");

		try {
			const parsed = new URL(fallback, globalThis.location.href);
			const pathname = parsed.pathname || "/";

			const fileMatch = pathname.match(/^\/i\/([^/]+)$/i);
			if (fileMatch) {
				return {
					mode: "file",
					origin: parsed.origin,
					pathname,
					fileId: fileMatch[1],
				};
			}

			const folderRootMatch = pathname.match(/^\/d\/([^/]+)\/?$/i);
			if (folderRootMatch) {
				return {
					mode: "folderRoot",
					origin: parsed.origin,
					pathname,
					folderId: folderRootMatch[1],
				};
			}

			const folderFileMatch = pathname.match(/^\/d\/([^/]+)\/.+$/i);
			if (folderFileMatch) {
				return {
					mode: "folderFile",
					origin: parsed.origin,
					pathname,
					folderId: folderFileMatch[1],
				};
			}

			return {
				mode: "unknown",
				origin: parsed.origin,
				pathname,
			};
		} catch {
			return {
				mode: "unknown",
				origin: globalThis.location.origin,
				pathname: fallback.split("?")[0].split("#")[0],
			};
		}
	}

	private normalizeYandexDiskPublicUrl(rawUrl: string): string {
		const parsed = this.parseYandexDiskUrl(rawUrl);

		if (parsed.mode === "file" && parsed.fileId) {
			return `${parsed.origin}/i/${parsed.fileId}`;
		}

		if (parsed.mode === "folderRoot" || parsed.mode === "folderFile") {
			return `${parsed.origin}${parsed.pathname}`;
		}

		return String(rawUrl || globalThis.location.href || "")
			.split("?")[0]
			.split("#")[0];
	}

	private extractYandexDiskPublicTarget(
		value: string,
	): YandexDiskResolvedTarget | null {
		try {
			const parsed = new URL(value, globalThis.location.href);
			const pathname = parsed.pathname || "/";
			const origin = "https://disk.yandex.com";

			const inlineMatch = pathname.match(/^\/i\/([^/?#]+)$/i);
			if (inlineMatch) {
				return {
					url: `${origin}/i/${inlineMatch[1]}`,
					videoId: `/i/${inlineMatch[1]}`,
				};
			}

			const publicFileMatch = pathname.match(/^\/d\/([^/?#]+)\/?$/i);
			if (publicFileMatch) {
				return {
					url: `${origin}/d/${publicFileMatch[1]}`,
					videoId: `/d/${publicFileMatch[1]}`,
				};
			}

			return null;
		} catch {
			return null;
		}
	}

	private extractYandexDiskPublicTargetFromMedia(): YandexDiskResolvedTarget | null {
		const tryValue = (value: string): YandexDiskResolvedTarget | null =>
			this.extractYandexDiskPublicTarget(String(value || ""));

		const href = String(globalThis.location.href || "");
		const locationParsed = this.parseYandexDiskUrl(href);

		if (locationParsed.mode === "file" && locationParsed.fileId) {
			return {
				url: `${locationParsed.origin}/i/${locationParsed.fileId}`,
				videoId: locationParsed.fileId,
			};
		}

		const videos = Array.from(document.querySelectorAll("video"));
		for (const video of videos) {
			const htmlVideo = video as HTMLVideoElement;
			const candidates = [
				htmlVideo.currentSrc || "",
				htmlVideo.src || "",
				htmlVideo.getAttribute("src") || "",
			];

			for (const candidate of candidates) {
				const target = tryValue(candidate);
				if (target) {
					return target;
				}
			}

			const sources = Array.from(video.querySelectorAll("source"));
			for (const source of sources) {
				const target = tryValue(source.getAttribute("src") || "");
				if (target) {
					return target;
				}
			}
		}

		return null;
	}

	private isYandexDiskFolderRootTarget(
		target: YandexDiskResolvedTarget,
		parsed: ReturnType<VOTTranslationHandler["parseYandexDiskUrl"]>,
	): boolean {
		if (!parsed.folderId) {
			return false;
		}

		const folderRootUrl = `${parsed.origin}/d/${parsed.folderId}`;
		return target.videoId === parsed.folderId || target.url === folderRootUrl;
	}

	private async gmGetJson(url: string): Promise<any> {
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method: "GET",
				url,
				headers: {
					Accept: "application/json",
				},
				onload: (res) => {
					try {
						console.log("[VOT][yandexdisk] GM response", {
							url,
							status: res.status,
							responseText: String(res.responseText || "").slice(0, 1000),
						});

						resolve(JSON.parse(res.responseText || "null"));
					} catch (error) {
						reject(error);
					}
				},
				onerror: (error) => reject(error),
				ontimeout: () => reject(new Error("Yandex Disk public API timeout")),
			});
		});
	}

	private getYandexDiskServiceVideoId(
		url: string,
		fallbackPath?: string,
	): string {
		try {
			const parsed = new URL(url, globalThis.location.href);
			const pathname = parsed.pathname || "";

			if (/^\/i\/[^/]+$/i.test(pathname)) {
				return pathname;
			}

			if (/^\/d\/.+$/i.test(pathname)) {
				return pathname;
			}
		} catch {
			// ignore
		}

		return fallbackPath || String(url || "");
	}

	private extractBridgeDirectMediaTarget(): YandexDiskResolvedTarget | null {
		try {
			const raw =
				(globalThis as Record<string, unknown>).__VOT_DIRECT_SOURCES__ ||
				JSON.parse(
					document?.documentElement?.dataset?.votDirectSources || "null",
				);

			if (!raw || typeof raw !== "object") {
				return null;
			}

			const bridgeData = raw as {
				hlsUrl?: string;
				dashUrl?: string;
				mpegLowUrl?: string;
				url?: string;
				unitedVideoId?: string;
				title?: string;
			};

			const candidates = [
				bridgeData.hlsUrl,
				bridgeData.dashUrl,
				bridgeData.mpegLowUrl,
				bridgeData.url,
			].filter((value): value is string => Boolean(value));

			for (const candidate of candidates) {
				const normalized = this.normalizeUrlForRequest(candidate);
				if (!normalized) {
					continue;
				}

				try {
					if (this.videoHandler.votClient.isDirectMediaUrl(normalized)) {
						return {
							url: normalized,
							videoId: String(bridgeData.unitedVideoId || normalized),
							host: "custom",
							title: bridgeData.title || "",
						};
					}
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}

		return null;
	}

	private extractDirectMediaTargetFromVideo(): YandexDiskResolvedTarget | null {
		const video = document.querySelector("video");

		if (!(video instanceof HTMLVideoElement)) {
			return null;
		}

		const candidates = [
			video.currentSrc || "",
			video.src || "",
			video.getAttribute("src") || "",
		];

		for (const candidate of candidates) {
			const normalized = this.normalizeUrlForRequest(candidate);
			if (!normalized) {
				continue;
			}

			try {
				if (this.videoHandler.votClient.isDirectMediaUrl(normalized)) {
					return {
						url: normalized,
						videoId: normalized,
						host: "custom",
					};
				}
			} catch {
				// ignore
			}
		}

		return null;
	}

	private extractOdyseeMetaMediaTarget(): YandexDiskResolvedTarget | null {
		try {
			if (!/odysee\.com$/i.test(location.hostname)) {
				return null;
			}

			const ldJsonNodes = Array.from(
				document.querySelectorAll('script[type="application/ld+json"]'),
			);

			for (const node of ldJsonNodes) {
				const text = node.textContent || "";
				if (!text.includes('"contentUrl"')) {
					continue;
				}

				const data = JSON.parse(text) as {
					contentUrl?: string;
					name?: string;
				};
				const contentUrl = data?.contentUrl;

				if (typeof contentUrl === "string" && contentUrl) {
					const normalized = this.normalizeUrlForRequest(contentUrl);
					return {
						url: normalized,
						videoId: normalized,
						host: "custom",
						title: data?.name || document.title || "",
					};
				}
			}
		} catch {
			// ignore
		}

		return null;
	}

	private async resolveYandexDiskFolderFileTargetViaApi(
		parsed: ReturnType<VOTTranslationHandler["parseYandexDiskUrl"]>,
	): Promise<YandexDiskResolvedTarget | null> {
		if (parsed.mode !== "folderFile" || !parsed.folderId) {
			return null;
		}

		const relativePathRaw = parsed.pathname.replace(/^\/d\/[^/]+/, "") || "/";

		let relativePath = relativePathRaw;
		try {
			relativePath = decodeURIComponent(relativePathRaw);
		} catch {
			relativePath = relativePathRaw;
		}

		const publicKey = `${parsed.origin}/d/${parsed.folderId}`;
		const apiUrl = new URL(
			"https://cloud-api.yandex.com/v1/disk/public/resources",
		);

		apiUrl.searchParams.set("public_key", publicKey);
		apiUrl.searchParams.set("path", relativePath);

		try {
			const payload = await this.gmGetJson(apiUrl.toString());

			console.log("[VOT][yandexdisk] public API payload", {
				relativePathRaw,
				relativePath,
				publicKey,
				type: payload?.type,
				path: payload?.path,
				name: payload?.name,
				public_url: payload?.public_url,
				short_url: payload?.short_url,
				file: payload?.file,
			});

			if (!payload || typeof payload !== "object") {
				return null;
			}

			if ("error" in payload && payload.error) {
				console.log("[VOT][yandexdisk] public API returned error", {
					error: payload.error,
					message: payload.message,
					description: payload.description,
				});
				return null;
			}

			const candidates = [payload.public_url, payload.short_url].filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			);

			for (const candidate of candidates) {
				const target = this.extractYandexDiskPublicTarget(candidate);
				if (!target) {
					continue;
				}

				if (this.isYandexDiskFolderRootTarget(target, parsed)) {
					console.log("[VOT][yandexdisk] skip folder-root target from API", {
						target,
						relativePath,
					});
					continue;
				}

				const serviceVideoId = this.getYandexDiskServiceVideoId(
					target.url,
					parsed.pathname,
				);

				console.log("[VOT][yandexdisk] public target from API", {
					target,
					candidate,
					relativePath,
					serviceVideoId,
				});

				return {
					url: target.url,
					videoId: serviceVideoId,
				};
			}

			if (
				payload.type === "file" &&
				typeof payload.file === "string" &&
				payload.file
			) {
				const directUrl = this.normalizeUrlForRequest(payload.file);

				console.log("[VOT][yandexdisk] use direct file url from API", {
					directUrl,
					relativePath,
				});

				return {
					url: directUrl,
					videoId: directUrl,
					host: "custom",
				};
			}

			if (payload.type === "file") {
				console.log(
					"[VOT][yandexdisk] API did not return usable public target, continue fallback chain",
					{
						public_url: payload.public_url,
						short_url: payload.short_url,
						file: payload.file,
						relativePath,
					},
				);

				return null;
			}
		} catch (error) {
			console.log("[VOT][yandexdisk] failed to resolve public target via API", {
				relativePathRaw,
				relativePath,
				publicKey,
				error,
			});
		}

		return null;
	}

	private isYandexDiskDownloadUrl(url: string): boolean {
		try {
			return (
				new URL(url, globalThis.location.href).hostname ===
				"downloader.disk.yandex.ru"
			);
		} catch {
			return false;
		}
	}

	private isYandexDiskStreamUrl(url: string): boolean {
		return /^https:\/\/streaming\.disk\.yandex\.net\/.+\.m3u8(?:[?#].*)?$/i.test(
			String(url || ""),
		);
	}

	private extractYandexDiskStreamTargetFromPlayerState(): YandexDiskResolvedTarget | null {
		const pick = (value: unknown): string | null => {
			if (typeof value !== "string") {
				return null;
			}

			const normalized = this.normalizeUrlForRequest(value);
			return this.isYandexDiskStreamUrl(normalized) ? normalized : null;
		};

		const visited = new WeakSet<object>();

		const scan = (value: unknown, depth: number): string | null => {
			if (depth < 0) {
				return null;
			}

			const direct = pick(value);
			if (direct) {
				return direct;
			}

			if (!value || typeof value !== "object") {
				return null;
			}

			const obj = value as Record<string, unknown>;

			if (visited.has(obj)) {
				return null;
			}
			visited.add(obj);

			const preferredKeys = [
				"streamUrl",
				"url",
				"stream",
				"streams",
				"source",
				"sources",
				"controller",
				"state",
				"playerState",
				"playerApiState",
				"internalInitialConfig",
				"config",
				"store",
				"redux",
			];

			for (const key of preferredKeys) {
				if (!(key in obj)) {
					continue;
				}

				const found = scan(obj[key], depth - 1);
				if (found) {
					return found;
				}
			}

			const values = Array.isArray(obj)
				? obj
				: Object.keys(obj)
						.slice(0, 50)
						.map((key) => obj[key]);

			for (const item of values) {
				const found = scan(item, depth - 1);
				if (found) {
					return found;
				}
			}

			return null;
		};

		const w = globalThis as Record<string, unknown>;

		for (const key of Object.keys(w)) {
			if (!/player|state|store|redux|disk|video|ya|vh/i.test(key)) {
				continue;
			}

			const found = scan(w[key], 6);
			if (found) {
				console.log("[VOT][yandexdisk] use stream url from deep player state", {
					key,
					url: found,
				});

				return {
					url: found,
					videoId: found,
					host: "yandexdisk",
				};
			}
		}

		return null;
	}

	private extractYandexDiskStreamTargetFromPerformance(): YandexDiskResolvedTarget | null {
		try {
			const entries = performance.getEntriesByType("resource");

			console.log("[VOT][yandexdisk] inspect performance resources", {
				count: entries.length,
			});

			for (let i = entries.length - 1; i >= 0; i -= 1) {
				const entry = entries[i];
				const raw = String((entry as PerformanceResourceTiming)?.name || "");
				const normalized = this.normalizeUrlForRequest(raw);

				if (!this.isYandexDiskStreamUrl(normalized)) {
					continue;
				}

				console.log("[VOT][yandexdisk] use stream url from performance", {
					url: normalized,
				});

				return {
					url: normalized,
					videoId: normalized,
					host: "yandexdisk",
				};
			}
		} catch (error) {
			console.log("[VOT][yandexdisk] failed to inspect performance resources", {
				error,
			});
		}

		return null;
	}

	private async buildYandexDiskVideoData(
		videoData: VideoData,
	): Promise<VideoData> {
		const bridgeTarget = this.extractBridgeDirectMediaTarget();
		if (bridgeTarget) {
			return {
				...videoData,
				...bridgeTarget,
				host: "custom",
			};
		}

		const odyseeTarget = this.extractOdyseeMetaMediaTarget();
		if (odyseeTarget) {
			return {
				...videoData,
				...odyseeTarget,
				host: "custom",
			};
		}

		const sourceUrl = this.getYandexDiskSourceUrl(videoData);
		const parsed = this.parseYandexDiskUrl(sourceUrl);

		console.log("[VOT][yandexdisk] build source", {
			pageUrl: globalThis.location.href,
			videoDataUrl: videoData.url,
			sourceUrl,
			parsedMode: parsed.mode,
			videoId: videoData.videoId,
		});

		if (parsed.mode === "file" && parsed.fileId) {
			const url = `${parsed.origin}/i/${parsed.fileId}`;
			return {
				...videoData,
				url,
				videoId: this.getYandexDiskServiceVideoId(url, parsed.pathname),
				host: "yandexdisk" as VideoData["host"],
			};
		}

		if (parsed.mode === "folderFile") {
			const target = await this.resolveYandexDiskFolderFileTargetViaApi(parsed);

			if (target) {
				const normalizedUrl = this.normalizeUrlForRequest(target.url);
				const serviceVideoId =
					target.host === "custom"
						? normalizedUrl
						: this.getYandexDiskServiceVideoId(normalizedUrl, parsed.pathname);

				console.log("[VOT][yandexdisk] resolved folder file target", {
					sourceUrl,
					resolvedUrl: normalizedUrl,
					videoId: serviceVideoId,
					host: target.host ?? "yandexdisk",
				});

				return {
					...videoData,
					url: normalizedUrl,
					videoId: serviceVideoId,
					host: target.host ?? ("yandexdisk" as VideoData["host"]),
				};
			}

			const streamTarget = this.extractYandexDiskStreamTargetFromPlayerState();
			if (streamTarget) {
				return {
					...videoData,
					url: streamTarget.url,
					videoId: streamTarget.videoId,
					host: "yandexdisk" as VideoData["host"],
				};
			}

			const performanceStreamTarget =
				this.extractYandexDiskStreamTargetFromPerformance();

			if (performanceStreamTarget) {
				return {
					...videoData,
					url: performanceStreamTarget.url,
					videoId: performanceStreamTarget.videoId,
					host: "yandexdisk" as VideoData["host"],
				};
			}
		}

		const directTarget = this.extractYandexDiskPublicTarget(sourceUrl);
		if (directTarget) {
			return {
				...videoData,
				url: directTarget.url,
				videoId: this.getYandexDiskServiceVideoId(
					directTarget.url,
					parsed.pathname,
				),
				host: "yandexdisk" as VideoData["host"],
			};
		}

		const mediaTarget = this.extractYandexDiskPublicTargetFromMedia();
		if (mediaTarget) {
			return {
				...videoData,
				url: mediaTarget.url,
				videoId: this.getYandexDiskServiceVideoId(
					mediaTarget.url,
					parsed.pathname,
				),
				host: "yandexdisk" as VideoData["host"],
			};
		}

		const directMediaTarget = this.extractDirectMediaTargetFromVideo();
		if (directMediaTarget) {
			return {
				...videoData,
				url: directMediaTarget.url,
				videoId: directMediaTarget.videoId,
				host: "custom",
			};
		}

		throw new Error("Failed to build Yandex Disk translation target");
	}

	private resetRepeatedAudioRequestRecovery(audioRequestKey: string): void {
		this.currentAudioRequestKey = audioRequestKey;
		this.cachedAudioUpload = undefined;
		this.repeatedAudioRequestCount = 0;
		this.samePayloadReplayDone = false;
		this.alternateTransportRetryDone = false;
		this.webAbrTransportStartIndex = 0;
	}

	private async replayCachedAudioUpload(
		audioRequestKey: string,
		signal: AbortSignal,
	): Promise<boolean> {
		const cached = this.cachedAudioUpload;
		if (!cached || cached.key !== audioRequestKey) {
			console.warn(
				"[VOT][source-audio-upload] no cached payload available for replay",
				{
					audioRequestKey,
				},
			);
			return false;
		}

		signal.throwIfAborted();
		console.warn(
			"[VOT][source-audio-upload] replaying the same audio payload",
			{
				translationId: cached.translationId,
				videoId: cached.videoId,
				kind: cached.kind,
				chunks: cached.kind === "partial" ? cached.chunks.length : 1,
			},
		);

		if (cached.kind === "full") {
			await this.retryAudioUpload(() =>
				this.videoHandler.votClient.requestVtransAudio(
					cached.videoUrl,
					cached.translationId,
					{
						audioFile: cached.audioData,
						fileId: cached.fileId,
					},
				),
			);
			return true;
		}

		for (const chunk of cached.chunks) {
			signal.throwIfAborted();
			await this.retryAudioUpload(() =>
				this.videoHandler.votClient.requestVtransAudio(
					cached.videoUrl,
					cached.translationId,
					{
						audioFile: chunk.audioData,
						chunkId: chunk.index,
					},
					{
						audioPartsLength: chunk.amount,
						fileId: cached.fileId,
						version: chunk.version,
					},
				),
			);
		}

		return true;
	}

	private static readonly AUDIO_UPLOAD_MAX_RETRIES = 15;
	private static readonly AUDIO_UPLOAD_RETRY_DELAY_MS = 1500;

	private async retryAudioUpload<T>(fn: () => Promise<T>): Promise<T> {
		const maxRetries = VOTTranslationHandler.AUDIO_UPLOAD_MAX_RETRIES;
		const delayMs = VOTTranslationHandler.AUDIO_UPLOAD_RETRY_DELAY_MS;
		let lastError: unknown;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;
				if (attempt === maxRetries) throw error;
				debug.log(
					`[AudioUpload] retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`,
				);
				await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
			}
		}

		throw lastError;
	}

	private readonly onDownloadedAudio = async (
		translationId: string,
		data: DownloadedAudioData,
	) => {
		debug.log("downloadedAudio", data);
		if (!this.downloading) {
			debug.log("skip downloadedAudio");
			return;
		}

		const { videoId, fileId, audioData } = data;
		const videoUrl = this.activeAudioUploadUrl || this.getCanonicalUrl(videoId);

		try {
			console.log("[VOT] Uploading full audio", {
				translationId,
				videoId,
				fileId,
				size: audioData.byteLength,
				videoUrl,
			});

			const uploadResponse = await this.retryAudioUpload(() =>
				this.videoHandler.votClient.requestVtransAudio(
					videoUrl,
					translationId,
					{
						audioFile: audioData,
						fileId,
					},
				),
			);
			console.log("[VOT] Upload full audio response", {
				translationId,
				videoId,
				fileId,
				videoUrl,
				status: uploadResponse?.status,
				remainingChunks: uploadResponse?.remainingChunks,
			});
			if (this.currentAudioRequestKey) {
				this.cachedAudioUpload = {
					key: this.currentAudioRequestKey,
					kind: "full",
					translationId,
					videoId,
					videoUrl,
					fileId,
					audioData: audioData.slice(),
				};
			}
		} catch (error) {
			debug.error("Failed to upload downloaded audio", error);
			console.log("[VOT] Upload full audio failed", {
				message: getErrorMessage(error),
				serverMessage: getServerErrorMessage(error),
				error: asVotClientErrorShape(error),
			});
			this.finishDownloadFailure(
				new Error("Audio downloader failed while uploading full audio"),
			);
			return;
		}

		this.finishDownloadSuccess();
	};

	private readonly onDownloadedPartialAudio = async (
		translationId: string,
		data: DownloadedPartialAudioData,
	) => {
		debug.log("downloadedPartialAudio", data);
		if (!this.downloading) {
			debug.log("skip downloadedPartialAudio");
			return;
		}

		const { audioData, fileId, videoId, amount, version, index } = data;
		const videoUrl = this.activeAudioUploadUrl || this.getCanonicalUrl(videoId);

		try {
			console.log("[VOT] Uploading audio chunk", {
				translationId,
				videoId,
				fileId,
				index,
				amount,
				size: audioData.byteLength,
				videoUrl,
			});

			const uploadResponse = await this.retryAudioUpload(() =>
				this.videoHandler.votClient.requestVtransAudio(
					videoUrl,
					translationId,
					{
						audioFile: audioData,
						chunkId: index,
					},
					{
						audioPartsLength: amount,
						fileId,
						version,
					},
				),
			);
			console.log("[VOT] Upload audio chunk response", {
				translationId,
				videoId,
				fileId,
				index,
				amount,
				videoUrl,
				status: uploadResponse?.status,
				remainingChunks: uploadResponse?.remainingChunks,
			});
			if (this.currentAudioRequestKey) {
				if (
					!this.cachedAudioUpload ||
					this.cachedAudioUpload.key !== this.currentAudioRequestKey ||
					this.cachedAudioUpload.kind !== "partial"
				) {
					this.cachedAudioUpload = {
						key: this.currentAudioRequestKey,
						kind: "partial",
						translationId,
						videoId,
						videoUrl,
						fileId,
						chunks: [],
					};
				}
				this.cachedAudioUpload.chunks.push({
					audioData: audioData.slice(),
					index,
					amount,
					version,
				});
			}
		} catch (error) {
			debug.error("Failed to upload downloaded audio chunk", error);
			console.log("[VOT] Upload audio chunk failed", {
				message: getErrorMessage(error),
				serverMessage: getServerErrorMessage(error),
				error: asVotClientErrorShape(error),
				index,
				amount,
				size: audioData.byteLength,
			});
			this.finishDownloadFailure(
				new Error("Audio downloader failed while uploading chunk"),
			);
			return;
		}

		if (index === amount - 1) {
			this.finishDownloadSuccess();
		}
	};

	private readonly onDownloadAudioError = async (
		translationId: string,
		videoId: string,
	) => {
		if (!this.downloading) {
			debug.log("skip downloadAudioError");
			return;
		}

		debug.log(`Failed to download audio ${videoId}`);

		const videoUrl = this.getCanonicalUrl(videoId);
		const canUseYouTubeFallback =
			this.videoHandler.site.host === "youtube" &&
			Boolean(this.videoHandler.data?.useAudioDownload);

		if (!canUseYouTubeFallback) {
			this.finishDownloadFailure(
				new VOTLocalizedError("VOTFailedDownloadAudio"),
			);
			return;
		}

		try {
			if (this.youtubeFailedAudioSignalUrl === videoUrl) {
				debug.log("fail-audio-js request already sent for this video");
			} else {
				debug.log("Sending fail-audio-js request");
				await this.videoHandler.votClient.requestVtransFailAudio(videoUrl);
				await this.videoHandler.votClient.requestVtransAudio(
					videoUrl,
					translationId,
					{
						audioFile: new Uint8Array(0),
						fileId: `fallback-empty-audio:video-translation:${videoId}`,
					},
				);
				this.youtubeFailedAudioSignalUrl = videoUrl;
			}

			this.finishDownloadSuccess();
		} catch (error) {
			debug.error("fail-audio-js request failed", error);
			this.finishDownloadFailure(
				new VOTLocalizedError("VOTFailedDownloadAudio"),
			);
		}
	};

	private finishDownloadSuccess() {
		this.downloading = false;
		this.downloadFailureError = undefined;
		this.resolveDownloadWaiters();
	}

	private finishDownloadFailure(error: Error) {
		this.downloading = false;
		this.downloadFailureError = error;
		this.rejectDownloadWaiters(error);
	}

	private getCanonicalUrl(videoId: string) {
		if (this.shouldUseLocalFileWorkflow(this.videoHandler.videoData)) {
			return (
				this.activeTranslationUrl ||
				this.getCurrentMediaRequestUrl(this.videoHandler.videoData)
			);
		}

		if (this.videoHandler.site.host === "youtube") {
			return (
				this.activeTranslationUrl ||
				this.videoHandler.videoData?.url ||
				`https://youtu.be/${videoId}`
			);
		}

		if (this.videoHandler.site.host === "yandexdisk") {
			return (
				this.activeTranslationUrl ||
				this.normalizeYandexDiskPublicUrl(
					this.videoHandler.videoData?.url || globalThis.location.href,
				)
			);
		}

		if (this.videoHandler.site.host === "custom") {
			return (
				this.activeTranslationUrl ||
				this.normalizeUrlForRequest(
					String(this.videoHandler.videoData?.url || globalThis.location.href),
				)
			);
		}

		return this.videoHandler.videoData?.url || globalThis.location.href;
	}

	private isLivelyVoiceUnavailableError(value: unknown): boolean {
		const msg = getErrorMessage(value);
		return !!msg && msg.toLowerCase().includes("обычная озвучка");
	}

	private scheduleRetry<T>(
		fn: () => Promise<T>,
		delayMs: number,
		signal: AbortSignal,
	): Promise<T> {
		console.log("[VOT][translate-retry] scheduled", {
			delayMs,
			host: this.videoHandler.site.host,
			videoId: this.videoHandler.videoData?.videoId,
			activeTranslationUrl: this.activeTranslationUrl,
			signalAborted: signal.aborted,
		});

		return new Promise<T>((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | null = null;

			const cleanup = () => {
				if (timeoutId !== null) {
					clearTimeout(timeoutId);
				}
				signal.removeEventListener("abort", onAbort);
			};

			const onAbort = () => {
				console.warn("[VOT][translate-retry] aborted", {
					delayMs,
					host: this.videoHandler.site.host,
					videoId: this.videoHandler.videoData?.videoId,
					activeTranslationUrl: this.activeTranslationUrl,
				});
				cleanup();
				reject(makeAbortError());
			};

			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) {
				onAbort();
				return;
			}

			timeoutId = setTimeout(async () => {
				if (signal.aborted) {
					onAbort();
					return;
				}

				cleanup();

				try {
					console.log("[VOT][translate-retry] fired", {
						delayMs,
						host: this.videoHandler.site.host,
						videoId: this.videoHandler.videoData?.videoId,
						activeTranslationUrl: this.activeTranslationUrl,
					});
					const result = await fn();
					resolve(result);
				} catch (error) {
					console.warn("[VOT][translate-retry] failed", {
						delayMs,
						host: this.videoHandler.site.host,
						videoId: this.videoHandler.videoData?.videoId,
						activeTranslationUrl: this.activeTranslationUrl,
						error: getErrorMessage(error),
					});
					reject(error);
				}
			}, delayMs);

			if (timeoutId !== null) {
				this.videoHandler.autoRetry = timeoutId;
			}
		});
	}

	async translateVideoYDImpl(
		videoData: VideoData,
		requestLang: RequestLang,
		responseLang: ResponseLang,
		translationHelp: TranslationHelp[] | null = null,
		signal = NEVER_ABORTED_SIGNAL,
		disableLivelyVoice = false,
	): Promise<
		(TranslatedVideoTranslationResponse & { usedLivelyVoice: boolean }) | null
	> {
		let normalizedVideoData: VideoData;
		this.updateAudioDownloaderStrategy(videoData);

		// ok.ru / m.ok.ru: Yandex can't access okcdn.ru videos from its servers
		// (IP-signed URLs). Force the upload workflow by treating it as a custom
		// host so Yandex returns AUDIO_REQUESTED and we upload via vkAudio strategy.
		if (
			(this.videoHandler.site.host === "okru" || videoData.host === "okru") &&
			videoData.host !== "custom"
		) {
			videoData = {
				...videoData,
				host: "custom" as VideoData["host"],
			};
		}

		const currentUrl = this.getCurrentMediaRequestUrl(videoData);
		const canUseLocalFileWorkflow =
			!this.isHlsManifestUrl(currentUrl) &&
			(this.videoHandler.site.host === "custom" ||
				videoData.host === "custom" ||
				this.shouldUseLocalFileWorkflow(videoData));
		const canUseCustomLinkWorkflow =
			!canUseLocalFileWorkflow && this.shouldUseCustomLinkWorkflow(videoData);

		if (canUseLocalFileWorkflow) {
			normalizedVideoData = this.buildLocalFileWorkflowVideoData(videoData);
		} else if (canUseCustomLinkWorkflow) {
			normalizedVideoData = this.buildCustomLinkWorkflowVideoData(videoData);
		} else {
			const cachedVideoData =
				this.activeYandexDiskResolvedVideoData &&
				this.isDirectResolvedUploadVideoData(
					this.activeYandexDiskResolvedVideoData,
				)
					? this.activeYandexDiskResolvedVideoData
					: undefined;

			const currentVideoData = this.isDirectResolvedUploadVideoData(videoData)
				? videoData
				: undefined;

			const resolvedVideoData =
				cachedVideoData ||
				currentVideoData ||
				(await this.buildYandexDiskVideoData(videoData));

			normalizedVideoData = {
				...resolvedVideoData,
				url: this.normalizeUrlForRequest(String(resolvedVideoData.url || "")),
			};
		}

		if (
			normalizedVideoData.host === "odysee" &&
			typeof normalizedVideoData.url === "string"
		) {
			const rewrittenUrl = this.normalizeOdyseeDirectUrl(
				normalizedVideoData.url,
			);

			normalizedVideoData =
				rewrittenUrl !== normalizedVideoData.url
					? {
							...normalizedVideoData,
							url: rewrittenUrl,
							host: "custom" as VideoData["host"],
						}
					: {
							...normalizedVideoData,
							url: this.normalizeUrlForRequest(normalizedVideoData.url),
						};
		}

		if (
			normalizedVideoData &&
			typeof normalizedVideoData.url === "string" &&
			normalizedVideoData.url &&
			!/\/frame\/?$/i.test(normalizedVideoData.url) &&
			!/blob:/i.test(normalizedVideoData.url)
		) {
			this.activeYandexDiskResolvedVideoData = normalizedVideoData;
		}

		this.activeTranslationUrl = normalizedVideoData.url;

		console.log("[VOT][upload] translateVideoYDImpl input", {
			host: normalizedVideoData.host,
			url: normalizedVideoData.url,
			videoId: normalizedVideoData.videoId,
		});

		try {
			throwIfAborted(signal);

			const useLivelyVoice =
				!disableLivelyVoice &&
				this.videoHandler.isLivelyVoiceAllowed(requestLang, responseLang) &&
				Boolean(this.videoHandler.data?.useLivelyVoice);

			const res = await this.videoHandler.votClient.translateVideo({
				videoData: normalizedVideoData,
				requestLang,
				responseLang,
				translationHelp,
				extraOpts: {
					useLivelyVoice,
					videoTitle: this.videoHandler.videoData?.title,
				},
				shouldSendFailedAudio: true,
			});

			if (!res) {
				throw new Error("Failed to get translation response");
			}

			console.log("[VOT][upload] translate response", {
				translated: res.translated,
				status: res.status,
				remainingTime: res.remainingTime,
				message: res.message,
			});

			if (isCompletedTranslationResponse(res)) {
				return { ...res, usedLivelyVoice: useLivelyVoice };
			}

			const message =
				res.message ?? localizationProvider.get("translationTakeFewMinutes");

			const displayRemainingTime = adjustTranslationEtaForDisplay(
				res.remainingTime,
				{
					optimisticLocalUpload: canUseLocalFileWorkflow,
				},
			);

			await this.videoHandler.updateTranslationErrorMsg(
				displayRemainingTime > 0
					? formatTranslationEta(displayRemainingTime, (key) =>
							localizationProvider.get(key),
						)
					: message,
				signal,
			);

			if (
				res.status === VideoTranslationStatus.AUDIO_REQUESTED &&
				this.videoHandler.canUploadAudioForCurrentSite()
			) {
				this.videoHandler.hadAsyncWait = true;
				this.downloadFailureError = undefined;
				this.downloading = true;

				await this.audioDownloader.runAudioDownload(
					normalizedVideoData.videoId,
					res.translationId,
					signal,
					this.videoHandler.video,
				);

				await this.waitForAudioDownloadCompletion(signal, 120000);

				return await this.translateVideoYDImpl(
					normalizedVideoData,
					requestLang,
					responseLang,
					translationHelp,
					signal,
					disableLivelyVoice || !useLivelyVoice,
				);
			}

			if (
				res.status === VideoTranslationStatus.WAITING ||
				res.status === VideoTranslationStatus.LONG_WAITING
			) {
				this.videoHandler.hadAsyncWait = true;

				const retryDelay = normalizedVideoData.host === "custom" ? 15000 : 5000;

				return this.scheduleRetry(
					() =>
						this.translateVideoYDImpl(
							normalizedVideoData,
							requestLang,
							responseLang,
							translationHelp,
							signal,
							disableLivelyVoice || !useLivelyVoice,
						),
					retryDelay,
					signal,
				);
			}

			throw new Error(
				typeof res.message === "string" && res.message
					? res.message
					: "Yandex couldn't translate video",
			);
		} catch (err) {
			if (isAbortError(err)) {
				return null;
			}

			const uiError = mapVotClientErrorForUi(err, this.videoHandler.site.host);

			await this.videoHandler.updateTranslationErrorMsg(
				getServerErrorMessage(uiError) ?? uiError,
				signal,
			);

			this.videoHandler.hadAsyncWait = notifyTranslationFailureIfNeeded({
				aborted: Boolean(
					this.videoHandler.actionsAbortController?.signal?.aborted,
				),
				translateApiErrorsEnabled: Boolean(
					this.videoHandler.data?.translateAPIErrors,
				),
				hadAsyncWait: this.videoHandler.hadAsyncWait,
				videoId: normalizedVideoData.videoId,
				error: err,
				notify: (params) =>
					this.videoHandler.notifier.translationFailed(params),
			});

			console.error("[VOT][upload]", err);
			this.resetTranslationRequestState("translateVideoYDImpl error");
			return null;
		}
	}

	async translateVideoImpl(
		videoData: VideoData,
		requestLang: RequestLang,
		responseLang: ResponseLang,
		translationHelp: TranslationHelp[] | null = null,
		shouldSendFailedAudio = false,
		signal = NEVER_ABORTED_SIGNAL,
		disableLivelyVoice = false,
	): Promise<
		(TranslatedVideoTranslationResponse & { usedLivelyVoice: boolean }) | null
	> {
		clearTimeout(this.videoHandler.autoRetry);
		this.finishDownloadSuccess();

		const requestLangForApi = this.videoHandler.getRequestLangForTranslation(
			requestLang,
			responseLang,
		);

		debug.log(
			videoData,
			`Translate video (requestLang: ${requestLang}, requestLangForApi: ${requestLangForApi}, responseLang: ${responseLang})`,
		);

		let livelyDisabled = disableLivelyVoice;
		const useLocalFileWorkflow = this.shouldUseLocalFileWorkflow(videoData);
		this.updateAudioDownloaderStrategy(videoData);

		if (
			this.videoHandler.site.host !== "douyin" &&
			(this.videoHandler.site.host === "yandexdisk" ||
				this.videoHandler.site.host === "custom" ||
				videoData.host === "custom" ||
				useLocalFileWorkflow)
		) {
			return await this.translateVideoYDImpl(
				videoData,
				requestLangForApi,
				responseLang,
				translationHelp,
				signal,
			);
		}

		let requestVideoData = videoData;
		if (this.videoHandler.site.host === "douyin") {
			const fresh = await this.videoHandler.site.getVideoData?.();

			if (fresh?.host === "douyin") {
				requestVideoData = fresh;
			} else if (requestVideoData.host !== "douyin") {
				return null;
			}
		}

		if (
			this.videoHandler.site.host === "odysee" &&
			typeof videoData.url === "string"
		) {
			const normalizedUrl = this.normalizeUrlForRequest(videoData.url);
			const rewrittenUrl = this.normalizeOdyseeDirectUrl(normalizedUrl);

			requestVideoData =
				rewrittenUrl !== normalizedUrl
					? {
							...videoData,
							url: rewrittenUrl,
							host: "custom" as VideoData["host"],
						}
					: {
							...videoData,
							url: normalizedUrl,
						};
		}

		// Keep the custom-link rewrite scoped to actual custom-host workflows.
		// Some normal sites (for example bilibili) expose direct media URLs, and
		// forcing them through the custom-link path breaks otherwise valid requests.
		if (this.shouldUseCustomLinkWorkflow(requestVideoData)) {
			requestVideoData =
				this.buildCustomLinkWorkflowVideoData(requestVideoData);
		}

		this.activeTranslationUrl =
			this.videoHandler.site.host === "odysee" ||
			this.isYouTubeTranslationRequest(requestVideoData)
				? requestVideoData.url
				: this.getCanonicalUrl(videoData.videoId);

		if (this.translationRequestStateUrl !== this.activeTranslationUrl) {
			this.resetTranslationRequestState("translation url changed");
			this.translationRequestStateUrl = this.activeTranslationUrl;
		}
		this.activeAudioUploadUrl = this.normalizeUrlForRequest(
			String(requestVideoData.url || this.activeTranslationUrl || ""),
		);

		try {
			throwIfAborted(signal);

			const livelyVoiceAllowed = this.videoHandler.isLivelyVoiceAllowed(
				requestLangForApi,
				responseLang,
			);

			if (
				!this.translationRequestStarted ||
				this.activeTranslationVoiceMode === undefined
			) {
				this.activeTranslationVoiceMode =
					!livelyDisabled &&
					livelyVoiceAllowed &&
					Boolean(this.videoHandler.data?.useLivelyVoice);
			}

			let useLivelyVoice =
				!livelyDisabled &&
				livelyVoiceAllowed &&
				Boolean(this.activeTranslationVoiceMode);

			let res: VideoTranslationResponse | undefined;

			const _isYouTubeTranslateRequest =
				this.isYouTubeTranslationRequest(requestVideoData);

			// Match the known-working userscript: no video_lang/cache preflight
			// in the main YouTube translation path.
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					const _isYouTubeRequestForCall =
						this.isYouTubeTranslationRequest(requestVideoData);
					const youtubeFailedAudioSignalUrl = String(
						requestVideoData.url || this.activeTranslationUrl || "",
					);
					const youtubeFailedAudioSignalAlreadySent =
						this.youtubeFailedAudioSignalUrl === youtubeFailedAudioSignalUrl;
					const allowFailedAudioSignal = shouldSendFailedAudio;
					// Keep the exact same full request shape on YouTube polling.
					// Only the firstRequest bit changes after the initial accepted request.
					const useMinimalYouTubePollingPayload = false;
					const extraOpts = {
						useLivelyVoice,
						videoTitle:
							requestVideoData.title ??
							this.videoHandler.videoData?.title ??
							"",
					};

					console.log("[VOT][youtube/request-snapshot]", {
						host: requestVideoData.host,
						url: requestVideoData.url,
						videoId: requestVideoData.videoId,
						duration: requestVideoData.duration,
						requestLang: requestLangForApi,
						responseLang,
						translationHelpCount: translationHelp?.length ?? 0,
						useLivelyVoice,
						allowFailedAudioSignal,
						youtubeFailedAudioSignalAlreadySent,
						useMinimalYouTubePollingPayload,
						videoTitle:
							requestVideoData.title ??
							this.videoHandler.videoData?.title ??
							"",
					});

					res = await this.videoHandler.votClient.translateVideo({
						videoData: requestVideoData,
						requestLang: requestLangForApi,
						responseLang,
						translationHelp,
						extraOpts,
						shouldSendFailedAudio: allowFailedAudioSignal,
					});
					this.translationRequestStarted = true;
					this.postAudioTranslateRetryCount = 0;

					console.log("[VOT][translate] translate response", {
						translated: res.translated,
						status: res.status,
						remainingTime: res.remainingTime,
						message: res.message,
						requestHost: requestVideoData.host,
						requestUrl: requestVideoData.url,
					});
				} catch (err) {
					if (useLivelyVoice && this.isLivelyVoiceUnavailableError(err)) {
						debug.log(
							"[translateVideoImpl] Lively voices are unavailable. Falling back to standard translation.",
							err,
						);
						livelyDisabled = true;
						useLivelyVoice = false;
						this.activeTranslationVoiceMode = false;
						continue;
					}
					throw err;
				}

				if (useLivelyVoice && this.isLivelyVoiceUnavailableError(res)) {
					debug.log(
						"[translateVideoImpl] Server responded that lively voices are unavailable. Falling back to standard translation.",
						res,
					);
					livelyDisabled = true;
					useLivelyVoice = false;
					this.activeTranslationVoiceMode = false;
					res = undefined;
					continue;
				}

				break;
			}

			if (!res) {
				throw new Error("Failed to get translation response");
			}

			debug.log("Translate video result", res);
			console.log("[VOT] host:", this.videoHandler.site.host);
			console.log("[VOT] status:", res.status);
			console.log("[VOT] translated:", res.translated);
			console.log("[VOT] remainingTime:", res.remainingTime);
			console.log("[VOT] translationId:", res.translationId);
			console.log(
				"[VOT] canUploadAudio:",
				this.videoHandler.canUploadAudioForCurrentSite(),
			);
			console.log("[VOT] downloader strategy:", this.audioDownloader.strategy);

			if (
				this.videoHandler.site.host === "vk" &&
				!res.translated &&
				res.status === VideoTranslationStatus.AUDIO_REQUESTED &&
				this.videoHandler.canUploadAudioForCurrentSite() &&
				res.translationId &&
				videoData.videoId
			) {
				debug.log("[VOT][VK subtitles] force audio upload", {
					videoId: videoData.videoId,
					translationId: res.translationId,
					strategy: this.audioDownloader.strategy,
				});
				try {
					this.downloadFailureError = undefined;
					this.downloading = true;

					void this.audioDownloader.runAudioDownload(
						videoData.videoId,
						String(res.translationId),
						signal,
						this.videoHandler.video,
					);
					await this.waitForAudioDownloadCompletion(signal, 20000);
				} catch (error) {
					debug.log(
						"[VOT][VK subtitles] force audio upload failed after successful translation",
						{
							videoId: videoData.videoId,
							translationId: res.translationId,
							message: getErrorMessage(error),
							serverMessage: getServerErrorMessage(error),
							error: asVotClientErrorShape(error),
						},
					);
				}
			}

			throwIfAborted(signal);

			if (isCompletedTranslationResponse(res)) {
				debug.log("Video translation finished with this data: ", res);
				this.resetTranslationRequestState("translation completed");
				return { ...res, usedLivelyVoice: useLivelyVoice };
			}

			const isYouTubeRequest =
				this.isYouTubeTranslationRequest(requestVideoData);
			const isYouTubeIntermediateStatus =
				isYouTubeRequest &&
				(res.status === VideoTranslationStatus.AUDIO_REQUESTED ||
					res.status === VideoTranslationStatus.WAITING ||
					res.status === VideoTranslationStatus.LONG_WAITING);
			if (isYouTubeIntermediateStatus) {
				this.rememberYouTubeServerPollState(res, requestVideoData);
			}
			const message = isYouTubeIntermediateStatus
				? localizationProvider.get("translationTakeFewMinutes")
				: (res.message ??
					localizationProvider.get("translationTakeFewMinutes"));
			const processingMessage =
				res.remainingTime > 0
					? formatTranslationEta(res.remainingTime, (key) =>
							localizationProvider.get(key),
						)
					: message;
			const updateProcessingUi = () => {
				void this.videoHandler
					.updateTranslationErrorMsg(processingMessage, signal)
					.catch((error) => {
						debug.log("[translateVideoImpl] updateTranslationErrorMsg failed", {
							message: getErrorMessage(error),
						});
					});
			};

			if (
				res.status === VideoTranslationStatus.WAITING ||
				res.status === VideoTranslationStatus.LONG_WAITING
			) {
				this.videoHandler.hadAsyncWait = true;
				updateProcessingUi();

				let retryDelayMs = 5000;

				if (isYouTubeRequest) {
					retryDelayMs = this.getYouTubeServerPollDelayMs(res.remainingTime);

					console.log(
						"[VOT][youtube/server-poll] accepted task; scheduling VOT-parity poll",
						{
							translationId: res.translationId,
							status: res.status,
							remainingTime: res.remainingTime,
							requestUrl: requestVideoData.url,
							retryAttempt: this.youtubeServerPollRetryAttempt,
							retryDelayMs,
						},
					);

					this.youtubeServerPollRetryAttempt += 1;
				}

				return this.scheduleRetry(
					() =>
						this.translateVideoImpl(
							videoData,
							requestLang,
							responseLang,
							translationHelp,
							shouldSendFailedAudio,
							signal,
							livelyDisabled,
						),
					retryDelayMs,
					signal,
				);
			}

			await this.videoHandler.updateTranslationErrorMsg(
				processingMessage,
				signal,
			);

			if (
				res.status === VideoTranslationStatus.AUDIO_REQUESTED &&
				this.videoHandler.canUploadAudioForCurrentSite()
			) {
				const translationId = String(res.translationId || "");
				const audioRequestKey = `${this.activeTranslationUrl ?? ""}:${translationId}`;

				if (!translationId) {
					throw new Error("Yandex requested audio without translationId");
				}

				if (this.handledAudioRequestKey === audioRequestKey) {
					this.repeatedAudioRequestCount += 1;
					console.warn("[VOT][source-audio-upload] repeated AUDIO_REQUESTED", {
						translationId,
						videoId: videoData.videoId,
						repeatedCount: this.repeatedAudioRequestCount,
						samePayloadReplayDone: this.samePayloadReplayDone,
						alternateTransportRetryDone: this.alternateTransportRetryDone,
					});

					this.videoHandler.hadAsyncWait = true;

					// The first repeated status can simply be a backend state propagation race.
					// Give Yandex one extra poll before sending the audio again.
					if (this.repeatedAudioRequestCount === 1) {
						return this.scheduleRetry(
							() =>
								this.translateVideoImpl(
									videoData,
									requestLang,
									responseLang,
									translationHelp,
									false,
									signal,
									livelyDisabled,
								),
							5000,
							signal,
						);
					}

					if (!this.samePayloadReplayDone) {
						this.samePayloadReplayDone = true;
						this.repeatedAudioRequestCount = 0;
						const replayed = await this.replayCachedAudioUpload(
							audioRequestKey,
							signal,
						);
						if (replayed) {
							return this.translateVideoImpl(
								videoData,
								requestLang,
								responseLang,
								translationHelp,
								false,
								signal,
								livelyDisabled,
							);
						}
					}

					// Do not redownload the same YouTube source audio after a successful
					// upload/replay. WEB_ABR already performs its own transport fallback,
					// and starting another download here only downloads the same media again.

					// After the initial upload and one exact replay, keep polling Yandex.
					// Do not start another WEB_ABR download for the same AUDIO_REQUESTED state.
					return this.scheduleRetry(
						() =>
							this.translateVideoImpl(
								videoData,
								requestLang,
								responseLang,
								translationHelp,
								false,
								signal,
								livelyDisabled,
							),
						5000,
						signal,
					);
				}

				this.resetRepeatedAudioRequestRecovery(audioRequestKey);
				this.videoHandler.hadAsyncWait = true;

				debug.log("Start audio download");
				this.downloadFailureError = undefined;
				this.downloading = true;

				await this.prepareSourceAudioUpload(signal);

				debug.log("[Translation] waiting for audio download completion", {
					videoId: videoData.videoId,
					translationId: res.translationId,
					timeoutMs: YOUTUBE_AUDIO_STREAM_TIMEOUT_MS,
				});

				await Promise.all([
					this.waitForAudioDownloadCompletion(
						signal,
						YOUTUBE_AUDIO_STREAM_TIMEOUT_MS,
					),
					this.audioDownloader.runAudioDownload(
						videoData.videoId,
						res.translationId,
						signal,
						this.videoHandler.video,
						this.webAbrTransportStartIndex,
					),
				]);

				this.handledAudioRequestKey = audioRequestKey;
				this.postAudioTranslateRetryCount = 0;

				// Real source audio has already been downloaded and uploaded successfully.
				// Do not enable the legacy failed-audio signal here: doing so can trigger
				// fail-audio-js / empty-audio handling after a valid web_abr upload.
				return await this.translateVideoImpl(
					videoData,
					requestLang,
					responseLang,
					translationHelp,
					false,
					signal,
					livelyDisabled,
				);
			}
		} catch (err) {
			if (isAbortError(err)) {
				debug.log("aborted video translation");
				return null;
			}

			if (
				this.youtubeServerPollActive &&
				this.isYouTubeTranslationRequest(videoData) &&
				this.shouldRetryYouTubeProcessingError(err) &&
				this.youtubeServerPollErrorCount < MAX_YOUTUBE_SERVER_POLL_ERROR_RETRIES
			) {
				this.youtubeServerPollErrorCount += 1;
				this.videoHandler.hadAsyncWait = true;

				console.warn(
					"[VOT][youtube/server-poll] transient poll failure; retrying without resetting translation state",
					{
						attempt: this.youtubeServerPollErrorCount,
						maxAttempts: MAX_YOUTUBE_SERVER_POLL_ERROR_RETRIES,
						retryDelayMs: YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS,
						videoId: videoData.videoId,
						activeTranslationUrl: this.activeTranslationUrl,
						lastStatus: this.youtubeServerPollLastStatus,
						lastRemainingTime: this.youtubeServerPollLastRemainingTime,
						lastTranslationId: this.youtubeServerPollLastTranslationId,
						error: getErrorMessage(err),
					},
				);

				await this.videoHandler.updateTranslationErrorMsg(
					typeof this.youtubeServerPollLastRemainingTime === "number" &&
						this.youtubeServerPollLastRemainingTime > 0
						? formatTranslationEta(
								this.youtubeServerPollLastRemainingTime,
								(key) => localizationProvider.get(key),
							)
						: localizationProvider.get("translationTakeFewMinutes"),
					signal,
				);

				return this.scheduleRetry(
					() =>
						this.translateVideoImpl(
							videoData,
							requestLang,
							responseLang,
							translationHelp,
							false,
							signal,
							livelyDisabled,
						),
					YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS,
					signal,
				);
			}

			if (this.shouldRetryPostAudioTranslateError(err)) {
				this.postAudioTranslateRetryCount += 1;
				this.videoHandler.hadAsyncWait = true;

				console.warn(
					"[VOT][source-audio-upload] post-audio translate failed; retrying",
					{
						attempt: this.postAudioTranslateRetryCount,
						maxAttempts: MAX_POST_AUDIO_TRANSLATE_RETRIES,
						retryDelayMs: POST_AUDIO_TRANSLATE_RETRY_DELAY_MS,
						videoId: videoData.videoId,
						activeTranslationUrl: this.activeTranslationUrl,
						error: getErrorMessage(err),
					},
				);

				await this.videoHandler.updateTranslationErrorMsg(
					localizationProvider.get("translationTakeFewMinutes"),
					signal,
				);

				return this.scheduleRetry(
					() =>
						this.translateVideoImpl(
							videoData,
							requestLang,
							responseLang,
							translationHelp,
							false,
							signal,
							livelyDisabled,
						),
					POST_AUDIO_TRANSLATE_RETRY_DELAY_MS,
					signal,
				);
			}

			const uiError = mapVotClientErrorForUi(err, this.videoHandler.site.host);

			await this.videoHandler.updateTranslationErrorMsg(
				getServerErrorMessage(uiError) ?? uiError,
				signal,
			);

			this.videoHandler.hadAsyncWait = notifyTranslationFailureIfNeeded({
				aborted: Boolean(
					this.videoHandler.actionsAbortController?.signal?.aborted,
				),
				translateApiErrorsEnabled: Boolean(
					this.videoHandler.data?.translateAPIErrors,
				),
				hadAsyncWait: this.videoHandler.hadAsyncWait,
				videoId: videoData.videoId,
				error: err,
				notify: (params) =>
					this.videoHandler.notifier.translationFailed(params),
			});

			console.error("[VOT]", err);
			this.resetTranslationRequestState("translateVideoImpl error");
			return null;
		}

		this.videoHandler.hadAsyncWait = true;

		return this.scheduleRetry(
			() =>
				this.translateVideoImpl(
					videoData,
					requestLang,
					responseLang,
					translationHelp,
					shouldSendFailedAudio,
					signal,
					livelyDisabled,
				),
			20000,
			signal,
		);
	}

	private getYandexDiskSourceUrl(videoData: VideoData): string {
		const currentUrl = String(videoData.url || "");

		if (currentUrl) {
			if (this.isYandexDiskStreamUrl(currentUrl)) {
				return currentUrl;
			}

			if (!this.isYandexDiskDownloadUrl(currentUrl)) {
				const parsedVideo = this.parseYandexDiskUrl(currentUrl);
				if (parsedVideo.mode !== "unknown") {
					return currentUrl;
				}
			}
		}

		const pageUrl = String(globalThis.location.href || "");
		const parsedPage = this.parseYandexDiskUrl(pageUrl);

		if (parsedPage.mode !== "unknown") {
			return pageUrl;
		}

		return currentUrl || pageUrl;
	}

	private waitForAudioDownloadCompletion(
		signal: AbortSignal,
		timeoutMs: number,
	): Promise<void> {
		if (!this.downloading) {
			if (this.downloadFailureError) {
				const error = this.downloadFailureError;
				this.downloadFailureError = undefined;
				return Promise.reject(error);
			}

			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			let entry!: DownloadWaiter;

			const onAbort = () => {
				cleanup();
				reject(makeAbortError());
			};

			const timeoutId = setTimeout(() => {
				cleanup();
				reject(new Error("Audio download wait timeout"));
			}, timeoutMs);

			const cleanup = () => {
				clearTimeout(timeoutId);
				signal.removeEventListener("abort", onAbort);
				this.downloadWaiters.delete(entry);
			};

			entry = {
				resolve: () => {
					cleanup();
					resolve();
				},
				reject: (error: Error) => {
					cleanup();
					reject(error);
				},
			};

			this.downloadWaiters.add(entry);

			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) {
				onAbort();
			}
		});
	}

	private resolveDownloadWaiters() {
		this.forEachDownloadWaiter((waiter) => waiter.resolve());
	}

	private rejectDownloadWaiters(error: Error) {
		this.forEachDownloadWaiter((waiter) => waiter.reject(error));
	}

	private forEachDownloadWaiter(handler: (waiter: DownloadWaiter) => void) {
		if (!this.downloadWaiters.size) {
			return;
		}

		const waiters = Array.from(this.downloadWaiters);
		this.downloadWaiters.clear();

		for (const waiter of waiters) {
			handler(waiter);
		}
	}
}
