/**
 * Service worker MÍNIMO — existe solo para que Android ofrezca «Instalar».
 *
 * NO cachea la página ni el código, a propósito. La primera versión hacía
 * «red primero, caché de respaldo» y aun así el iPhone acabó ejecutando una
 * versión vieja durante una prueba de campo: GitHub Pages manda
 * `Cache-Control: max-age=600`, así que la caché HTTP del propio navegador
 * servía el fichero antiguo y el service worker lo guardaba encima.
 *
 * En un banco de pruebas, medir una versión que no es la que crees es el peor
 * fallo posible: sacas conclusiones de un código que ya no existe. Aquí se
 * prefiere no funcionar sin conexión antes que funcionar con datos viejos.
 *
 * Solo se cachean los iconos y el manifest, que no cambian y hacen falta para
 * que la instalación siga siendo posible.
 */
const CACHE = "geofence-estaticos-v2";
const ESTATICOS = ["./icon-192.png", "./icon-512.png", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ESTATICOS)).catch(() => {}),
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
  const url = new URL(req.url);
  const esEstatico = ESTATICOS.some((e) => url.pathname.endsWith(e.replace("./", "")));

  if (esEstatico) {
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }

  // Todo lo demás (página y código): SIEMPRE de la red, saltándose incluso la
  // caché HTTP del navegador. `cache: "reload"` es lo que evita que
  // max-age=600 nos devuelva el fichero de hace diez minutos.
  event.respondWith(
    fetch(req, { cache: "reload" }).catch(() =>
      new Response(
        "<!doctype html><meta charset=utf-8><body style='font:16px system-ui;padding:24px'>" +
          "<h1>Sin conexión</h1><p>Este banco de pruebas necesita conexión a propósito: " +
          "así nunca mide una versión antigua del código.</p>",
        { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
      ),
    ),
  );
});
