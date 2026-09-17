(() => {
  if (window.__oncedmInjected) return;
  window.__oncedmInjected = true;

  const seen = new Set();
  const MEDIA_RE = /\.(jpe?g|png|gif|webp|mp4|webm|m4v|mov|heic)(\?|$)/i;

  function report(payload) {
    try {
      window.postMessage({ __oncedm: true, ...payload }, "*");
    } catch (_) {}
  }

  // ── 1. Hook URL.createObjectURL — view-once blobs appear here ──
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
      report({
        kind: "url",
        url,
        type: /\.(mp4|webm|m4v|mov)$/i.test(url) ? "video" : "image",
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // ── 4. DOM fallback ──
  function scanTags() {
    document
      .querySelectorAll("img[src], video[src], video source[src]")
      .forEach((el) => {
        const src = el.currentSrc || el.src;
        if (src && MEDIA_RE.test(src) && !seen.has(src)) {
          seen.add(src);
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
