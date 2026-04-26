// ==UserScript==
// @name         VOT Kodik Bridge
// @namespace    vot-bridge
// @version      1.1
// @match        *://kodikplayer.com/*
// @match        *://*.kodikplayer.com/*
// @match        *://player.cdnvideohub.com/*
// @match        *://*.okcdn.ru/*
// @match        *://*.solodcdn.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  function isSegmentUrl(url) {
    url = String(url || "").trim().toLowerCase();
    return (
      !url ||
      url.startsWith("blob:") ||
      /\.ts([?#]|$)/i.test(url) ||
      /\.m4s([?#]|$)/i.test(url) ||
      /\.aac([?#]|$)/i.test(url) ||
      /\.jpg([?#]|$)/i.test(url) ||
      /\.jpeg([?#]|$)/i.test(url) ||
      /\.png([?#]|$)/i.test(url) ||
      /\.webp([?#]|$)/i.test(url) ||
      /tiles\d+/i.test(url) ||
      /:hls:seg-\d+/i.test(url)
    );
  }

  function classifyUrl(url) {
    const clean = String(url || "").trim();

    if (!clean || isSegmentUrl(clean)) return null;

    if (/\.m3u8([?#]|$)/i.test(clean)) {
      return { kind: "hlsUrl", url: clean };
    }

    if (/\.mpd([?#]|$)/i.test(clean)) {
      return { kind: "dashUrl", url: clean };
    }

    // Только настоящий mp4, а не "...mp4:hls:seg-1.ts"
    if (/\.mp4([?#]|$)/i.test(clean)) {
      return { kind: "mpegLowUrl", url: clean };
    }

    return null;
  }

  function scoreUrl(url) {
    let score = 0;
    if (/\.m3u8([?#]|$)/i.test(url)) score += 100;
    if (/\.mpd([?#]|$)/i.test(url)) score += 90;
    if (/\.mp4([?#]|$)/i.test(url)) score += 80;
    if (/master/i.test(url)) score += 20;
    if (/manifest/i.test(url)) score += 20;
    return score;
  }

function setDirect(url, source = "unknown") {
  const classified = classifyUrl(url);
  if (!classified) return;

  const prev = w.__VOT_DIRECT_SOURCES__ || {};
  const nextBest = [classified.url, prev.hlsUrl, prev.dashUrl, prev.mpegLowUrl, prev.url]
    .filter(Boolean)
    .sort((a, b) => scoreUrl(b) - scoreUrl(a))[0] || classified.url;

  const payload = {
    ...prev,
    [classified.kind]: classified.url,
    url: nextBest,
    title: document.title || prev.title || "",
    unitedVideoId: prev.unitedVideoId || location.href,
    updatedAt: Date.now(),
    source,
  };

  w.__VOT_DIRECT_SOURCES__ = payload;

  try {
    document.documentElement.dataset.votDirectSources = JSON.stringify(payload);
  } catch {}

  console.log("[VOT bridge] direct:", payload);
}

  function detectFromVideo() {
    const video = document.querySelector("video");
    if (!video) return;

    const src = String(video.currentSrc || video.src || "").trim();
    setDirect(src, "video");
  }

  function detectFromPerformance() {
    try {
      const entries = performance.getEntriesByType("resource");
      const names = entries
        .map((e) => (typeof e.name === "string" ? e.name : ""))
        .filter(Boolean);

      const candidates = names.filter((url) => classifyUrl(url));

      if (!candidates.length) return;

      const best = candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a))[0];
      setDirect(best, "performance");
    } catch {}
  }

  function hookFetch() {
    const orig = w.fetch;
    if (!orig) return;

    w.fetch = async function (...args) {
      const res = await orig.apply(this, args);

      try {
        const reqUrl =
          typeof args[0] === "string"
            ? args[0]
            : args[0] && typeof args[0].url === "string"
              ? args[0].url
              : "";

        const finalUrl = res && res.url ? res.url : reqUrl;

        setDirect(reqUrl, "fetch:req");
        setDirect(finalUrl, "fetch:res");
      } catch {}

      return res;
    };
  }

  function hookXHR() {
    const open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        setDirect(String(url || ""), "xhr");
      } catch {}

      return open.call(this, method, url, ...rest);
    };
  }

  function hookMediaSource() {
    if (!w.MediaSource || !w.MediaSource.prototype) return;

    const origAddSourceBuffer = w.MediaSource.prototype.addSourceBuffer;
    w.MediaSource.prototype.addSourceBuffer = function (mimeType) {
      try {
        console.log("[VOT bridge] MediaSource mimeType:", mimeType);
      } catch {}
      return origAddSourceBuffer.call(this, mimeType);
    };
  }

  hookFetch();
  hookXHR();
  hookMediaSource();

  setInterval(() => {
    detectFromVideo();
    detectFromPerformance();
  }, 1000);
})();