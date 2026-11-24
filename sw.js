/* ============================================================
 * Service Worker — ทำให้แอปใช้งานออฟไลน์ได้ 100%
 *
 * กลยุทธ์: "แคชก่อน แล้วอัปเดตเบื้องหลัง" (stale-while-revalidate)
 *  1) ตอนติดตั้ง: ดาวน์โหลดไฟล์ทั้งหมดของแอปเก็บไว้ในแคช
 *  2) ตอนเปิดแอป: ตอบจากแคชทันที (เร็วและไม่ต้องใช้เน็ต)
 *     ถ้าออนไลน์อยู่ จะดึงไฟล์ใหม่มาเก็บไว้ใช้ครั้งถัดไป
 *
 * ถ้าแก้ไขไฟล์ของแอป ให้เปลี่ยนเลข VERSION ด้านล่าง เพื่อให้แคชเก่าถูกล้าง
 * ============================================================ */
const VERSION = 'v2';
const CACHE = `pomodoro-london-${VERSION}`;

// ใช้ path แบบ relative เพื่อให้ทำงานได้แม้โฮสต์ในโฟลเดอร์ย่อย (เช่น GitHub Pages)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' = ข้าม HTTP cache ของเบราว์เซอร์ เพื่อให้ได้ไฟล์ล่าสุดจริง ๆ
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // จัดการเฉพาะ GET ของโดเมนเดียวกัน (แอปนี้ไม่เรียกโดเมนอื่นอยู่แล้ว)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    const refresh = fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(refresh);   // อัปเดตแคชเบื้องหลัง
      return cached;
    }

    const res = await refresh;
    if (res) return res;

    // ออฟไลน์และไม่มีในแคช: ถ้าเป็นการเปิดหน้าเว็บ ให้ตอบหน้าหลักแทน
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('ออฟไลน์', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
