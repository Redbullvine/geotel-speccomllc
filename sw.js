/**
 * SpecCom Service Worker
 * Phase 1: Offline asset caching + offline fallback shell
 * Does NOT use Background Sync API - manual sync handled by app
 */

const CACHE_VERSION = "v22";
const CACHE_NAME = `speccom-${CACHE_VERSION}`;

// Assets that are critical for offline operation
const CRITICAL_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css?v=20260702-mobile-ui-stabilization",
  "/supabaseClient.js",
  "/services/offlinePhotoQueue.js",
  "/js/earth-export.js",
  "/env.generated.js",
];

// Asset patterns to cache (CSS, JS, images, fonts)
const CACHE_PATTERNS = [
  /\.css$/,
  /\.js$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.woff$/,
  /\.woff2$/,
  /\.ttf$/,
  /\.eot$/,
];

function shouldCache(url) {
  try {
    const urlObj = new URL(url);
    // Only cache same-origin
    if (urlObj.origin !== self.location.origin) {
      return false;
    }
    // Don't cache API calls or dynamic content
    if (urlObj.pathname.includes("/rest/") || urlObj.pathname.includes("/api/") || urlObj.pathname.includes("/.netlify/functions/")) {
      return false;
    }
    // Check patterns
    return CACHE_PATTERNS.some((pattern) => pattern.test(urlObj.pathname));
  } catch {
    return false;
  }
}

/**
 * Install event - cache critical assets
 */
self.addEventListener("install", (event) => {
  console.log("[SW] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching critical assets");
      return Promise.all(
        CRITICAL_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache ${url}:`, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

/**
 * Activate event - clean old caches
 */
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

/**
 * Fetch event - network-first with cache fallback
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url;

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Skip external resources
  try {
    const urlObj = new URL(url);
    if (urlObj.origin !== self.location.origin) {
      return;
    }
  } catch {
    return;
  }

  // Skip API/REST calls - let them fail in offline
  if (url.includes("/rest/") || url.includes("/api/") || url.includes("/.netlify/functions/")) {
    return;
  }

  // Network-first strategy
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses if cacheable
        if (shouldCache(url) && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(async () => {
        // Network failed, try cache
        const cached = await caches.match(request);
        if (cached) {
          console.log(`[SW] Serving from cache: ${url}`);
          return cached;
        }

        // Not in cache - return offline fallback
        console.log(`[SW] No cache for: ${url}`);
        
        // For HTML requests, return offline page
        if (request.destination === "document" || request.mode === "navigate") {
          const offlinePage = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>SpecCom - Offline</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                  background: #0f1720;
                  color: #d8e4ee;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  padding: 20px;
                }
                .offline-box {
                  text-align: center;
                  max-width: 400px;
                }
                .offline-icon { font-size: 48px; margin-bottom: 16px; }
                h1 { font-size: 24px; margin-bottom: 8px; }
                p { color: #8ea6b8; font-size: 14px; line-height: 1.5; }
                .spinner {
                  width: 40px;
                  height: 40px;
                  border: 2px solid rgba(55, 138, 221, 0.2);
                  border-top: 2px solid #378ADD;
                  border-radius: 50%;
                  animation: spin 1s linear infinite;
                  margin: 20px auto;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
              </style>
            </head>
            <body>
              <div class="offline-box">
                <div class="offline-icon">📡</div>
                <h1>Offline Mode</h1>
                <p>You're offline. SpecCom is cached and will resume when connection returns.</p>
                <div class="spinner"></div>
                <p style="margin-top: 16px; font-size: 12px; color: rgba(200, 200, 200, 0.6);">Photos you capture will be queued and uploaded automatically when online.</p>
              </div>
            </body>
            </html>
          `;
          return new Response(offlinePage, {
            headers: { "Content-Type": "text/html" },
          });
        }

        // For other requests, return generic error response
        return new Response("Offline - Resource not available", {
          status: 503,
          statusText: "Service Unavailable",
        });
      })
  );
});

/**
 * Message handler - communication with app
 */
self.addEventListener("message", (event) => {
  const { type, data } = event.data;

  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "CLEAR_CACHE") {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  } else if (type === "CACHE_ASSETS") {
    caches.open(CACHE_NAME).then((cache) => {
      Promise.all(data.urls.map((url) => cache.add(url)))
        .then(() => {
          event.ports[0].postMessage({ success: true });
        })
        .catch((err) => {
          event.ports[0].postMessage({ success: false, error: err.message });
        });
    });
  }
});

console.log("[SW] Service Worker initialized");
