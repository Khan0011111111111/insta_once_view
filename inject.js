(() => {
  if (window.__oncedmInjected) {
    console.log("[OnceDM] inject.js already running, skipping");
    return;
  }
  window.__oncedmInjected = true;
  console.log("[OnceDM] inject.js LOADED — hooks installing");

  const seen = new Set();

  function report(payload) {
    try {
      console.log("[OnceDM] >>> REPORTING:", payload.type, payload.kind, payload.mime || payload.url || "");
      window.postMessage({ __oncedm: true, ...payload }, "*");
    } catch (_) {}
  }

  // ── 1. Hook URL.createObjectURL — log EVERYTHING ──
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreate.call(this, obj);
    try {
      console.log("[OnceDM] createObjectURL called. Type:", obj?.type, "Size:", obj?.size);
      if (obj instanceof Blob && !seen.has(url)) {
        seen.add(url);
        const reader = new FileReader();
        reader.onload = () =>
          report({
            kind: "blob",
            dataUrl: reader.result,
            mime: obj.type || "application/octet-stream",
            size: obj.size,
            type: (obj.type || "").startsWith("video/") ? "video" : "image",
          });
        reader.readAsDataURL(obj);
      }
    } catch (_) {}
    return url;
  };

  // ── 2. Hook fetch — log all cdn requests ──
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const url = typeof input === "string" ? input : input?.url;
    if (url && /cdninstagram|fbcdn|\.jpg|\.jpeg|\.png|\.webp|\.mp4|\.webm/i.test(url)) {
      console.log("[OnceDM] fetch:", url);
      if (!seen.has(url)) {
        seen.add(url);
        report({
          kind: "url",
          url,
          type: /\.(mp4|webm|m4v|mov)/i.test(url) ? "video" : "image",
        });
      }
    }
    return origFetch.apply(this, args);
  };

  // ── 3. Hook XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === "string" && /cdninstagram|fbcdn|\.jpg|\.jpeg|\.png|\.webp|\.mp4|\.webm/i.test(url)) {
      console.log("[OnceDM] XHR:", url);
      if (!seen.has(url)) {
        seen.add(url);
        report({
          kind: "url",
          url,
          type: /\.(mp4|webm|m4v|mov)/i.test(url) ? "video" : "image",
        });
      }
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // ── 4. Log every image/video that enters the DOM ──
  function scanTags() {
    document.querySelectorAll("img, video").forEach((el) => {
      const src = el.currentSrc || el.src;
      if (!src || seen.has(src)) return;
      seen.add(src);
      console.log("[OnceDM] DOM", el.tagName, "src:", src.slice(0, 120));
      report({
        kind: "url",
        url: src,
        type: el.tagName === "VIDEO" ? "video" : "image",
      });
    });
  }
  setInterval(scanTags, 1500);
  scanTags();
  console.log("[OnceDM] All hooks installed. Waiting for media...");
})();
