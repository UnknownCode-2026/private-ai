const CACHE = "thaiban-ai-v1.3-logo-v4";
const ASSETS = [
  "/icon.svg?v=4",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== CACHE &&
                (key.startsWith("private-ai-") ||
                  key.startsWith("thaiban-ai-")),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
// Never cache private pages, API responses, chat content, or Next.js RSC responses.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !ASSETS.includes(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || Response.error()),
    ),
  );
});
