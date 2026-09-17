(() => {
  if (window.__oncedmInjected) return;
  window.__oncedmInjected = true;

  const seen = new Set();
  const MEDIA_RE = /\.(jpe?g|png|gif|webp|mp4|webm|m4v|mov|heic)(\?|$)/i;
  const MSE_SEGMENTS = new Map(); // Stores media segments for MediaSource streams

  function report(payload) {
    try {
      window.postMessage({ __oncedm: true, ...payload }, "*");
    } catch (_) {}
  }

  // ── 1. Hook URL.createObjectURL — view-once blobs (mainly images) appear here ──
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreate.call(this, obj);
    try {
      if (
        obj instanceof Blob &&
        (obj.type.startsWith("image/") || obj.type.startsWith("video/")) &&
        !seen.has(url)
      ) {
        seen.add(url);
        console.log("[OnceDM] Captured Blob URL:", obj.type, obj.size, "bytes");
        const reader = new FileReader();
        reader.onload = () =>
          report({
            kind: "blob",
            dataUrl: reader.result,
            mime: obj.type,
            size: obj.size,
            type: obj.type.startsWith("video/") ? "video" : "image",
          });
        reader.readAsDataURL(obj);
      }
    } catch (_) {}
    return url;
  };

  // ── 2. Hook fetch ──
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const url = typeof input === "string" ? input : input?.url;
    if (url && MEDIA_RE.test(url) && !seen.has(url)) {
      seen.add(url);
      console.log("[OnceDM] Captured via fetch:", url);
      report({
        kind: "url",
        url,
        type: /\.(mp4|webm|m4v|mov)$/i.test(url) ? "video" : "image",
      });
    }
    return origFetch.apply(this, args);
  };

  // ── 3. Hook XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === "string" && MEDIA_RE.test(url) && !seen.has(url)) {
      seen.add(url);
      console.log("[OnceDM] Captured via XHR:", url);
      report({
        kind: "url",
        url,
        type: /\.(mp4|webm|m4v|mov)$/i.test(url) ? "video" : "image",
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // ── 4. Hook MediaSource for streaming video (THE CRITICAL FIX) ──
  const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (...args) {
    const sourceBuffer = origAddSourceBuffer.apply(this, args);
    const mimeType = args[0] || "unknown";

    console.log("[OnceDM] MediaSource.addSourceBuffer called with:", mimeType);

    // Store the media segments appended to this buffer
    const bufferId = Math.random().toString(36).slice(2);
    MSE_SEGMENTS.set(bufferId, []);

    const origAppendBuffer = sourceBuffer.appendBuffer;
    sourceBuffer.appendBuffer = function (data) {
      try {
        if (data instanceof ArrayBuffer) {
          MSE_SEGMENTS.get(bufferId).push(new Uint8Array(data));
          // console.log('[OnceDM] Appended segment:', data.byteLength, 'bytes'); // Uncomment for verbose logging
        } else if (data instanceof Uint8Array) {
          MSE_SEGMENTS.get(bufferId).push(new Uint8Array(data));
        }
      } catch (_) {}
      return origAppendBuffer.call(this, data);
    };

    // When the source buffer is done, build a blob and report it
    sourceBuffer.addEventListener("updateend", () => {
      // This is a simplification. A real-world implementation would need
      // to handle fragmented MP4 muxing. For now, we concatenate the segments
      // and hope for the best, which works for some non-fragmented streams.
      const segments = MSE_SEGMENTS.get(bufferId);
      if (segments && segments.length > 0) {
        // Only trigger once per buffer to avoid spamming the extension
        if (!segments.__reported) {
          segments.__reported = true;

          // Simple concatenation. THIS IS NOT A PROPER MUXER.
          // It may produce a playable file for some simple streams.
          const totalLength = segments.reduce((acc, seg) => acc + seg.length, 0);
          const concatenated = new Uint8Array(totalLength);
          let offset = 0;
          for (const seg of segments) {
            concatenated.set(seg, offset);
            offset += seg.length;
          }

          console.log("[OnceDM] MediaSource stream complete. Total size:", concatenated.length, "bytes");

          const blob = new Blob([concatenated], { type: mimeType.split(';')[0] });
          const reader = new FileReader();
          reader.onload = () => {
            report({
              kind: "blob",
              dataUrl: reader.result,
              mime: mimeType.split(';')[0],
              size: blob.size,
              type: "video",
            });
          };
          reader.readAsDataURL(blob);
        }
      }
    });

    return sourceBuffer;
  };

  // ── 5. DOM fallback — catches already-rendered media ──
  function scanTags() {
    document
      .querySelectorAll("img[src], video[src], video source[src]")
      .forEach((el) => {
        const src = el.currentSrc || el.src;
        if (src && MEDIA_RE.test(src) && !seen.has(src)) {
          seen.add(src);
          console.log("[OnceDM] Captured from DOM:", src);
          report({
            kind: "url",
            url: src,
            type: el.tagName === "VIDEO" ? "video" : "image",
          });
        }
      });
  }
  setInterval(scanTags, 1500);
  scanTags();
})();
