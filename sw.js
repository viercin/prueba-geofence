/**
 * Service worker MÍNIMO — existe solo para que Android ofrezca «Instalar».
 *
 * Estrategia: red primero, caché solo como red de seguridad sin conexión. En un
 * banco de pruebas, una caché agresiva es peligrosa: te haría medir una versión
 * vieja de la página y sacar conclusiones equivocadas. Por eso `skipWaiting` y
 * `clients.claim`: cada despliegue entra de inmediato, sin esperar a que se
 * cierren las pestañas.
 */
const CACHE = "geofence-v1";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Solo se guarda lo propio y correcto; nada de respuestas opacas.
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});
