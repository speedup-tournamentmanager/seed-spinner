/* Pickleball Draw Wheel -- minimal offline service worker, plus
 * enforcement of the app's 30-day-from-first-open trial.
 *
 * Only does anything once the app is served over HTTPS (or localhost);
 * it is ignored when the HTML file is opened directly from disk.
 *
 * Bump CACHE_NAME every time you ship a new build of
 * index.html so installed copies pick up the change.
 */
var CACHE_NAME = "pb-draw-wheel-shell-v5";
var CORE = ["./", "./index.html", "./assets/speedup-logo.png"];

// Must match the constants in index.html -- this is the
// cross-context "when was this first opened" record, shared with this
// worker via IndexedDB and Cache Storage (both same-origin, both
// reachable from a service worker; localStorage/cookies are not).
var TRIAL_DAYS = 30;
var DAY_MS = 86400000;
var TRIAL_MS = TRIAL_DAYS * DAY_MS;
var FIRST_OPEN_DB = "pb-draw-wheel-trial-db";
var FIRST_OPEN_CACHE = "pb-draw-wheel-trial-v1";
var FIRST_OPEN_URL = "/__pb_draw_wheel_first_open__";

function idbReadFirstOpen() {
  return new Promise(function (resolve) {
    try {
      var req = indexedDB.open(FIRST_OPEN_DB, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("flags");
      };
      req.onsuccess = function () {
        try {
          var getReq = req.result
            .transaction("flags", "readonly")
            .objectStore("flags")
            .get("firstOpen");
          getReq.onsuccess = function () {
            var v = getReq.result;
            resolve(typeof v === "number" && isFinite(v) ? v : null);
          };
          getReq.onerror = function () {
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      };
      req.onerror = function () {
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
}

function cacheReadFirstOpen() {
  return caches
    .open(FIRST_OPEN_CACHE)
    .then(function (c) {
      return c.match(FIRST_OPEN_URL);
    })
    .then(function (r) {
      return r
        ? r.text().then(function (t) {
            var v = parseInt(t, 10);
            return isFinite(v) ? v : null;
          })
        : null;
    })
    .catch(function () {
      return null;
    });
}

function trialExpiredResponse() {
  var html =
    "<!doctype html><meta charset='utf-8'><title>Pickleball Draw Wheel</title>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1' />" +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    "padding:24px;background:#f5f7fb;color:#29314d;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif\">" +
    '<div style="max-width:420px;background:#fff;border:1px solid #e7eaf3;border-radius:14px;' +
    'box-shadow:0 16px 40px rgba(23,32,63,.14);padding:28px;text-align:center">' +
    "<div style='font-size:2rem;line-height:1;margin-bottom:12px'>&#9202;</div>" +
    "<h1 style='font-size:1.25rem;margin:0 0 8px'>This draw wheel's trial has ended</h1>" +
    "<p style='margin:0;color:#8a94a6;font-size:.95rem'>" +
    "It ran for its " +
    TRIAL_DAYS +
    "-day trial. " +
    "Ask the tournament organiser for a fresh copy.</p>" +
    "</div></body>";
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            // Keep the trial-flag cache around across upgrades; only
            // prune old app-shell caches.
            if (key !== CACHE_NAME && key !== FIRST_OPEN_CACHE)
              return caches.delete(key);
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  // Page navigations (including the installed PWA's launch/offline
  // path) are gated on the trial first.
  if (req.mode === "navigate") {
    event.respondWith(
      Promise.all([idbReadFirstOpen(), cacheReadFirstOpen()]).then(
        function (results) {
          var known = results.filter(function (v) {
            return typeof v === "number" && isFinite(v);
          });
          var earliest = known.length ? Math.min.apply(Math, known) : null;
          if (earliest !== null && Date.now() > earliest + TRIAL_MS) {
            return trialExpiredResponse();
          }
          return caches.match(req).then(function (cached) {
            return (
              cached ||
              fetch(req)
                .then(function (res) {
                  cacheCopy(req, res.clone());
                  return res;
                })
                .catch(function () {
                  return caches.match("./index.html");
                })
            );
          });
        },
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req)
        .then(function (res) {
          cacheCopy(req, res.clone());
          return res;
        })
        .catch(function () {});
    }),
  );
});

function cacheCopy(req, res) {
  if (res && res.status === 200 && res.type === "basic") {
    caches.open(CACHE_NAME).then(function (cache) {
      cache.put(req, res);
    });
  }
}
