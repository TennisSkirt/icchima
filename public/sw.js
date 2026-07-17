/* イッチマ Service Worker — オフラインキャッシュ + プッシュ通知 */

importScripts("./firebase-config.js");

const CACHE = "icchima-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/* --- FCM バックグラウンド通知（Firebase設定済みの場合のみ） --- */
const fbConfigured =
  typeof FIREBASE_CONFIG !== "undefined" &&
  FIREBASE_CONFIG.apiKey &&
  !FIREBASE_CONFIG.apiKey.includes("PASTE");

if (fbConfigured) {
  try {
    importScripts(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
    );
    firebase.initializeApp(FIREBASE_CONFIG);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const n = payload.notification || payload.data || {};
      self.registration.showNotification(n.title || "イッチマ", {
        body: n.body || "",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        data: { url: "./" },
      });
    });
  } catch (e) {
    // オフライン時などSDK読み込み失敗はキャッシュ機能に影響させない
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return clients.openWindow("./");
    })
  );
});

/* --- キャッシュ --- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 同一オリジン: stale-while-revalidate / ナビゲーション: index.html フォールバック */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === "navigate") return caches.match("./index.html");
          return cached;
        });
      return cached || fetched;
    })
  );
});
