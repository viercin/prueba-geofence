/**
 * Prueba de geofence para fichaje — banco de pruebas desechable.
 *
 * Existe para responder a cuatro preguntas de las que depende si el control por
 * ubicación entra o no en el módulo de fichajes:
 *
 *   1. En una PWA INSTALADA (standalone), ¿aparece el diálogo de permiso?
 *   2. ¿Se recuerda el permiso al cerrar y reabrir la app?
 *   3. ¿Qué precisión real da DENTRO de un local?
 *   4. ¿Cuánto tarda?
 *
 * TODO gira alrededor de una idea: una medición falsa es PEOR que no medir,
 * porque parece que sabes. De ahí las decisiones raras que hay aquí:
 *
 *  · El vigía NO cierra la medición. La primera versión resolvía «COLGADA» a
 *    los 20 s y descartaba la respuesta que llegara después. Pero el `timeout`
 *    de la API NO incluye lo que el usuario tarda en contestar al diálogo
 *    (así lo dice la especificación), así que los dos relojes se SUMAN: 6 s de
 *    persona + 15 s de la API buscando señal en un interior = 21 s, y el vigía
 *    disparaba en un móvil que se había comportado de manual. Peor aún:
 *    «COLGADA · 20000ms» por humano lento era indistinguible del fallo real de
 *    iOS. Ahora el vigía solo AVISA; los callbacks siguen vivos y una respuesta
 *    tardía corrige el veredicto con su tiempo real.
 *  · Se anota si la lectura llevaba diálogo por medio. Solo las lecturas SIN
 *    diálogo miden a la API; las otras miden a la persona.
 *  · Se anota si la app se fue a segundo plano durante la lectura: ahí el
 *    cronómetro no vale.
 *
 * Todo se queda en el móvil (localStorage). No hay servidor, no se envía nada.
 */
"use strict";

const BUILD = "2026-09-10.2"; // para no analizar sin querer una copia cacheada
const TIMEOUT_MS = 15000; // el de la propia API
const AVISO_MS = 20000; // solo avisa por pantalla: no cierra nada
const COLGADA_MS = 75000; // a partir de aquí sí se declara colgada
const PRECISION_ANCLA_M = 50; // calidad mínima para fijar el punto de trabajo
const CLAVE_CONF = "geofence.config";
const CLAVE_LOG = "geofence.log";

const $ = (id) => document.getElementById(id);
const metros = (n) => `${Math.round(n)} m`;

// ── Estado guardado ────────────────────────────────────────────────────────
function leer(clave, porDefecto) {
  try {
    const v = JSON.parse(localStorage.getItem(clave));
    return v === null || v === undefined ? porDefecto : v;
  } catch (e) {
    return porDefecto;
  }
}
/** Devuelve false si no pudo guardar (Safari privado), para no mentir al usuario. */
function escribir(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch (e) {
    return false;
  }
}

let config = leer(CLAVE_CONF, { lat: null, lng: null, radio: 150, regla: "estricta" });
let registro = leer(CLAVE_LOG, []);

// ── Distancia (haversine) ──────────────────────────────────────────────────
// A decenas de metros el error del modelo esférico es milimétrico: aquí manda
// el error del GPS, cuatro órdenes de magnitud mayor.
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── Contexto ───────────────────────────────────────────────────────────────
function esStandalone() {
  if (window.navigator.standalone === true) return true;
  const mm = window.matchMedia && window.matchMedia("(display-mode: standalone)");
  return !!(mm && mm.matches);
}
const esIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const esAndroid = () => /android/i.test(navigator.userAgent);
/** Navegador integrado de otra app (WhatsApp, Instagram…): no vale para probar. */
function esNavegadorDeApp() {
  const ua = navigator.userAgent;
  return (
    /\b(WAiOS|WA4A)\//i.test(ua) ||
    /Instagram|FBAN|FBAV/i.test(ua) ||
    /Android.*wv\)/i.test(ua) ||
    (/(iPhone|iPod|iPad)/i.test(ua) && !/Safari\//i.test(ua) && !esStandalone())
  );
}

let ultimoPermiso = "—";
async function estadoPermiso() {
  // En iPhone este dato NO es fiable: WebKit devuelve siempre "prompt", esté
  // concedido o denegado. Se registra igualmente, marcándolo.
  try {
    const r = await navigator.permissions.query({ name: "geolocation" });
    return r.state;
  } catch (e) {
    return "no consultable";
  }
}

async function pintarContexto(motivo) {
  const inst = esStandalone();
  $("modo").innerHTML = `<span class="chip ${inst ? "verde" : "rojo"}">${inst ? "app instalada" : "navegador"}</span>`;
  ultimoPermiso = await estadoPermiso();
  $("permiso").innerHTML =
    `<span class="chip gris">${ultimoPermiso}</span>` +
    (esIos() ? '<div class="nota">En iPhone este dato no es fiable: siempre dice «prompt».</div>' : "");
  $("disp").textContent =
    (esIos() ? "iOS" : esAndroid() ? "Android" : "otro") + " · build " + BUILD;

  let aviso = "";
  if (esNavegadorDeApp()) {
    aviso = "⚠ Estás en el navegador integrado de otra app (WhatsApp o similar). Esto NO sirve para la prueba: ábrela en Chrome o Safari.";
  } else if (!inst) {
    aviso = "⚠ Estás en el navegador. Sirve como control, pero lo que hay que probar es la app INSTALADA en la pantalla de inicio.";
  } else {
    aviso = "✓ Estás en la app instalada. Esto es lo que hay que probar.";
  }
  $("avisoModo").textContent = aviso;
  $("avisoModo").className = "nota " + (inst && !esNavegadorDeApp() ? "bien" : "mal");

  // Deja rastro de cada apertura: así se puede contestar la pregunta 2
  // (¿se recuerda el permiso al cerrar y reabrir?).
  if (motivo) {
    apuntar(`${new Date().toLocaleString("es-ES")} · ${inst ? "instalada" : "navegador"} · ${motivo} · permiso=${ultimoPermiso}`);
  }
}

// ── Lectura de posición ────────────────────────────────────────────────────
/**
 * ESCALERA DE INTENTOS. Un solo intento no basta para diagnosticar.
 *
 * En la prueba de campo, un Android 10 con el permiso CONCEDIDO agotó los 15 s
 * ocho veces seguidas. Pedíamos posición de alta precisión y recién medida
 * (`enableHighAccuracy: true, maximumAge: 0`), que obliga a un fix de GPS real:
 * bajo techo, con la ubicación del sistema en modo «solo dispositivo», eso no
 * llega nunca. El iPhone contestaba en milisegundos porque sí usa wifi y red.
 *
 * Con un único intento, «no funciona en Android» y «no funciona pidiéndolo
 * así» son indistinguibles — y son cosas muy distintas para el producto. Por
 * eso ahora se prueban tres formas, de más exigente a menos, y se apunta CUÁL
 * respondió. Esa es la información que decide el diseño.
 */
const ESCALONES = [
  { nombre: "GPS preciso", opts: { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 } },
  { nombre: "red/wifi", opts: { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 } },
  { nombre: "última conocida", opts: { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 } },
  { nombre: "suscripción", suscripcion: 20000 },
];

/**
 * Cuarto escalón: `watchPosition` en vez de `getCurrentPosition`.
 *
 * No es un capricho. `getCurrentPosition` espera a que el proveedor que elija
 * el navegador entregue un fix y, si ese no cuaja, agota el tiempo sin más.
 * `watchPosition` se suscribe y entrega EN CUANTO cualquier proveedor reporta
 * algo, aunque sea malo — y se puede cancelar en cuanto llega el primero.
 *
 * Se añadió tras ver un Android donde los tres escalones normales agotaban el
 * tiempo incluso aceptando una posición cacheada de cinco minutos: el navegador
 * ni devolvía ni fallaba. Si este tampoco da nada, el problema no es cómo lo
 * pedimos.
 */
function porSuscripcion(ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let id = null;
    let cerrado = false;
    const terminar = (r) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(reloj);
      if (id !== null && navigator.geolocation.clearWatch) {
        try {
          navigator.geolocation.clearWatch(id);
        } catch (e) {
          /* da igual */
        }
      }
      resolve(Object.assign({ ms: Date.now() - t0, seFueAlFondo: false }, r));
    };
    const reloj = setTimeout(
      () => terminar({ resultado: "error", codigo: 3, mensaje: "Se agotó el tiempo" }),
      ms,
    );
    try {
      id = navigator.geolocation.watchPosition(
        (pos) =>
          terminar({
            resultado: "ok",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            precision: pos.coords.accuracy,
          }),
        (err) =>
          terminar({
            resultado: "error",
            codigo: err.code,
            mensaje: err.code === 1 ? "Permiso denegado" : err.message || "Error",
          }),
        { enableHighAccuracy: true, timeout: ms, maximumAge: 600000 },
      );
    } catch (e) {
      terminar({ resultado: "error", mensaje: "watchPosition no disponible" });
    }
  });
}

/** Un intento suelto. Nunca lanza: siempre resuelve con un resultado. */
function unIntento(opts, alAvisar) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let cerrado = false;
    let seFueAlFondo = document.visibilityState !== "visible";
    const alOcultar = () => {
      if (document.visibilityState !== "visible") seFueAlFondo = true;
    };
    document.addEventListener("visibilitychange", alOcultar);

    const terminar = (r) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(tAviso);
      clearTimeout(tColgada);
      document.removeEventListener("visibilitychange", alOcultar);
      resolve(Object.assign({ ms: Date.now() - t0, seFueAlFondo }, r));
    };

    const tAviso = setTimeout(() => {
      if (!cerrado && alAvisar) alAvisar(AVISO_MS);
    }, AVISO_MS);
    // El vigía solo cierra si la API NO llamó a nada: ni éxito ni error. Es el
    // fallo de iOS que se venía a cazar, y por eso vive muy por encima del
    // timeout propio de la API.
    const tColgada = setTimeout(
      () =>
        terminar({
          resultado: "colgada",
          mensaje: `Sin respuesta en ${COLGADA_MS / 1000}s: la API no llamó ni al éxito ni al error`,
        }),
      COLGADA_MS,
    );

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        terminar({
          resultado: "ok",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: pos.coords.accuracy,
        }),
      (err) =>
        terminar({
          resultado: "error",
          codigo: err.code,
          mensaje:
            err.code === 1
              ? "Permiso denegado"
              : err.code === 2
                ? "Posición no disponible"
                : err.code === 3
                  ? "Se agotó el tiempo"
                  : err.message || "Error desconocido",
        }),
      opts,
    );
  });
}

async function leerPosicion(alAvisar) {
  if (!navigator.geolocation) {
    return { resultado: "error", mensaje: "El navegador no tiene geolocalización", ms: 0, via: "—" };
  }
  const fallos = [];
  let msTotal = 0;
  for (let i = 0; i < ESCALONES.length; i++) {
    const esc = ESCALONES[i];
    // Se avisa ANTES de empezar cada escalón: si tarda 50 s en total, el
    // probador tiene que ver que sigue trabajando y por dónde va.
    if (alAvisar) alAvisar(0, esc.nombre);
    const r = esc.suscripcion
      ? await porSuscripcion(esc.suscripcion)
      : await unIntento(esc.opts, (ms) => alAvisar && alAvisar(ms, esc.nombre));
    msTotal += r.ms;
    if (r.resultado === "ok") {
      return Object.assign({}, r, { via: esc.nombre, msTotal, intentosFallidos: fallos });
    }
    // Un permiso denegado no mejora bajando el listón: no se insiste.
    if (r.codigo === 1) {
      return Object.assign({}, r, { via: esc.nombre, msTotal, intentosFallidos: fallos });
    }
    fallos.push(`${esc.nombre}: ${r.mensaje} (${r.ms}ms)`);
  }
  return {
    resultado: "error",
    mensaje: "Ningún método dio posición · " + fallos.join(" · "),
    ms: msTotal,
    msTotal,
    via: "ninguna",
    intentosFallidos: fallos,
    seFueAlFondo: false,
  };
}

/** Sufijo con las salvedades que hacen que un tiempo NO sea comparable. */
function salvedades(p, huboDialogo) {
  const s = [];
  // En iPhone `permissions.query` devuelve siempre "prompt", aunque el permiso
  // esté concedido, así que ahí «hubo diálogo» sería siempre cierto y el aviso
  // dejaría de informar. Se matiza en vez de mentir.
  if (huboDialogo && esIos()) s.push("iOS no deja saber si hubo diálogo; si lo hubo, el tiempo no mide la API");
  else if (huboDialogo) s.push("incluye el diálogo de permiso: el tiempo NO mide la API");
  if (p.seFueAlFondo) s.push("la app pasó a segundo plano: el tiempo no vale");
  if (p.intentosFallidos && p.intentosFallidos.length) {
    s.push("hubo que bajar el listón — " + p.intentosFallidos.join(" · "));
  }
  return s.length ? " · ⚠ " + s.join(" · ") : "";
}

// ── Registro ───────────────────────────────────────────────────────────────
function apuntar(linea) {
  registro.unshift(linea);
  registro = registro.slice(0, 80);
  if (!escribir(CLAVE_LOG, registro)) {
    registro[0] += " · (no se pudo guardar: almacenamiento bloqueado)";
  }
  pintarRegistro();
}
function pintarRegistro() {
  $("log").textContent = registro.length ? registro.join("\n") : "(sin intentos todavía)";
}

// ── Configuración ──────────────────────────────────────────────────────────
/**
 * Escribe en los campos. Se llama SOLO al arrancar y cuando el botón fija la
 * posición — NUNCA mientras el usuario teclea.
 *
 * Antes se llamaba en cada `change`, así que al salir del campo te reescribía
 * lo escrito con lo que hubiera guardado: si aún no cuadraba, te lo borraba.
 * Desde fuera parecía «no me deja escribir las coordenadas».
 */
function pintarCampos() {
  $("lat").value = config.lat === null ? "" : config.lat;
  $("lng").value = config.lng === null ? "" : config.lng;
  $("radio").value = String(config.radio);
  $("regla").value = config.regla;
}

function pintarResumen() {
  $("resumenConf").textContent =
    config.lat === null
      ? "Sin configurar: no se puede fichar todavía."
      : `Trabajo en ${config.lat}, ${config.lng} · radio ${config.radio} m · regla ${config.regla === "duda" ? "con margen" : "estricta"}`;
}

/**
 * Convierte texto a número aceptando lo que de verdad escribe la gente:
 * coma decimal española, espacios, signo, y el punto como separador.
 */
function aNumero(txt) {
  const limpio = String(txt).trim().replace(/\s+/g, "").replace(",", ".");
  if (limpio === "" || !/^-?\d*\.?\d+$/.test(limpio)) return NaN;
  return parseFloat(limpio);
}

/** Lee los campos y actualiza `config`. Devuelve null si hay error. */
function tomarCoordenadas() {
  const lat = aNumero($("lat").value);
  const lng = aNumero($("lng").value);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Acepta un par pegado tal cual sale de Google Maps o de donde sea:
 *   "41.3874, 2.1686"   "41,3874 2,1686"   "41.3874;2.1686"
 * Existe porque algunos teclados de móvil en modo decimal no ofrecen ni coma
 * ni punto, y entonces es literalmente imposible teclear la coordenada.
 */
function tomarPegado(txt) {
  const nums = String(txt).match(/-?\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = aNumero(nums[0]);
  const lng = aNumero(nums[1]);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Guarda radio y regla. NO toca las coordenadas. */
function guardarAjustes() {
  config.radio = +$("radio").value;
  config.regla = $("regla").value;
  const ok = escribir(CLAVE_CONF, config);
  pintarResumen();
  return ok;
}

/** Guarda lo que hay en los CAMPOS. Solo desde el `change` de los campos. */
function guardarDesdeCampos() {
  const c = tomarCoordenadas();
  if (c) {
    config.lat = c.lat;
    config.lng = c.lng;
  }
  return guardarAjustes();
}

/**
 * Fija el punto de trabajo desde código (botón de posición, probar-fuera,
 * pegado) y refleja el cambio en los campos.
 *
 * Existe separado por un fallo real: antes, tras poner las coordenadas nuevas
 * se llamaba a una única función de guardado que RELEÍA los campos de texto —
 * que todavía tenían el valor viejo — y machacaba lo recién puesto. Resultado:
 * «usar mi posición» y «probar fuera» no cambiaban nada, y la distancia se
 * quedaba clavada. Lo detectó una prueba de campo en la que fijar el trabajo
 * donde estabas seguía dando 386 m.
 */
function fijarPunto(lat, lng) {
  config.lat = lat;
  config.lng = lng;
  const ok = guardarAjustes();
  pintarCampos();
  return ok;
}

$("usarAqui").addEventListener("click", async () => {
  const b = $("usarAqui");
  const txt = b.textContent;
  b.disabled = true;
  b.textContent = "Leyendo tu posición…";
  const p = await leerPosicion(() => {
    b.textContent = "Sigo esperando…";
  });
  b.disabled = false;
  b.textContent = txt;
  const sello = new Date().toLocaleString("es-ES");

  if (p.resultado !== "ok") {
    apuntar(`${sello} · ANCLA · ${p.resultado.toUpperCase()} · ${p.mensaje} · ${p.ms}ms${salvedades(p, ultimoPermiso !== "granted")}`);
    alert(`No se pudo leer la posición.\n\n${p.mensaje}`);
    return;
  }
  // Un ancla mala envenena TODAS las medidas posteriores: si la lectura es
  // mala, se avisa y se pide confirmación explícita.
  if (p.precision > PRECISION_ANCLA_M) {
    const seguir = confirm(
      `Lectura poco precisa: ±${Math.round(p.precision)} m.\n\n` +
        `Fijar el trabajo con esta lectura falsearía todas las pruebas. ` +
        `Sal a la calle o espera unos segundos y repite.\n\n¿Fijarlo igualmente?`,
    );
    if (!seguir) {
      apuntar(`${sello} · ANCLA · DESCARTADA por precisión ±${Math.round(p.precision)}m`);
      return;
    }
  }
  fijarPunto(+p.lat.toFixed(6), +p.lng.toFixed(6));
  apuntar(`${sello} · ANCLA · fijada · precisión ±${Math.round(p.precision)}m · ${p.ms}ms${salvedades(p, ultimoPermiso !== "granted")}`);
  alert(`Trabajo fijado aquí.\nPrecisión de esta lectura: ±${Math.round(p.precision)} m.`);
});

$("guardar").addEventListener("click", () => {
  if (!tomarCoordenadas()) {
    alert("Latitud o longitud no válidas.");
    return;
  }
  alert(guardarDesdeCampos() ? "Configuración guardada." : "Guardada solo para esta sesión: el móvil no deja almacenar (¿modo privado?).");
});

// Radio y regla se aplican al vuelo; las coordenadas también, para que FICHAR
// nunca mida contra algo distinto de lo que se ve en pantalla.
["radio", "regla"].forEach((id) => $(id).addEventListener("change", guardarAjustes));
["lat", "lng"].forEach((id) => $(id).addEventListener("change", guardarDesdeCampos));

$("pegar").addEventListener("click", () => {
  const c = tomarPegado($("pegado").value);
  if (!c) {
    alert(
      "No he sabido leer eso." +
        "\n\n" +
        "Pega las dos cifras juntas, por ejemplo:" +
        "\n" +
        "41.3874, 2.1686",
    );
    return;
  }
  fijarPunto(c.lat, c.lng);
  $("pegado").value = "";
  alert(`Trabajo fijado en ${c.lat}, ${c.lng}.`);
});

$("probarFuera").addEventListener("click", () => {
  if (config.lat === null) {
    alert("Primero fija dónde está el trabajo.");
    return;
  }
  // Mueve el ancla 1 km al norte: sirve para comprobar que el bloqueo funciona
  // sin tener que caminar. 1 km está fuera de cualquier radio de la lista.
  fijarPunto(+(config.lat + 1000 / 111320).toFixed(6), config.lng);
  apuntar(`${new Date().toLocaleString("es-ES")} · ANCLA · movida 1 km al norte para probar el caso FUERA`);
  alert("Trabajo movido 1 km al norte.\n\nAhora pulsa FICHAR: debe salir FUERA.\nDespués vuelve a pulsar «usar mi posición» para dejarlo bien.");
});

// ── Fichar ─────────────────────────────────────────────────────────────────
$("fichar").addEventListener("click", async () => {
  if (config.lat === null || config.lng === null) {
    alert("Primero configura dónde está el trabajo (apartado 2).");
    return;
  }
  const b = $("fichar");
  const v = $("veredicto");
  b.disabled = true;
  b.textContent = "COMPROBANDO…";
  v.style.display = "none";
  $("detalle").style.display = "none";

  // Si el permiso ya estaba concedido no habrá diálogo, y solo entonces el
  // tiempo medido es el de la API. Se apunta para poder separarlo luego.
  const permisoAntes = await estadoPermiso();
  const huboDialogo = permisoAntes !== "granted";

  const p = await leerPosicion((ms, escalon) => {
    b.textContent = `PROBANDO ${escalon.toUpperCase()}…`;
  });
  b.disabled = false;
  b.textContent = "FICHAR";

  const sello = new Date().toLocaleString("es-ES");
  const ctx = esStandalone() ? "instalada" : "navegador";
  const extra = salvedades(p, huboDialogo);

  if (p.resultado !== "ok") {
    v.style.display = "block";
    v.style.color = "#fff";
    v.style.background = "var(--mal)";
    const pista =
      p.via === "ninguna" && esAndroid()
        ? "<br><br>Ningún método ha dado posición. Mira en Ajustes → Ubicación " +
          "que esté encendida y en modo de <b>alta precisión</b> (no «solo dispositivo»)."
        : "";
    v.innerHTML = `NO TE DEJARÍA FICHAR<small>${p.mensaje}${pista}</small>`;
    apuntar(`${sello} · ${ctx} · ${p.resultado.toUpperCase()} · ${p.mensaje} · ${p.ms}ms${extra}`);
    return;
  }

  const dist = distanciaMetros(config.lat, config.lng, p.lat, p.lng);
  const dentroEstricta = dist <= config.radio;
  const dentroDuda = dist - p.precision <= config.radio;
  const dentro = config.regla === "duda" ? dentroDuda : dentroEstricta;
  // No se puede decidir si el error de la lectura es mayor que el propio radio:
  // el umbral relativo importa más que cualquier cifra absoluta.
  const indecidible = p.precision > config.radio;

  v.style.display = "block";
  if (indecidible) {
    v.style.background = "var(--aviso)";
    v.style.color = "#241a06";
    v.innerHTML =
      `NO SE PUEDE DECIDIR<small>Precisión de ±${Math.round(p.precision)} m frente a un radio de ${config.radio} m. ` +
      `Con este dato, cualquier veredicto sería inventado.</small>`;
  } else {
    v.style.color = "#fff";
    v.style.background = dentro ? "var(--ok)" : "var(--mal)";
    v.innerHTML = dentro
      ? `DENTRO — te dejaría fichar<small>A ${metros(dist)} del trabajo, dentro de los ${config.radio} m</small>`
      : `FUERA — no te dejaría fichar<small>A ${metros(dist)} del trabajo, fuera de los ${config.radio} m</small>`;
  }

  $("detalle").style.display = "";
  $("dDist").textContent = metros(dist);
  $("dPrec").textContent = `± ${Math.round(p.precision)} m`;
  $("dVia").textContent = p.via;
  $("dMs").textContent = `${p.ms} ms${huboDialogo ? " (incluye el diálogo)" : ""}`;
  $("dOtra").textContent =
    config.regla === "duda"
      ? `estricta: ${dentroEstricta ? "dentro" : "fuera"}`
      : `con margen: ${dentroDuda ? "dentro" : "fuera"}`;

  apuntar(
    `${sello} · ${ctx} · ${indecidible ? "INDECIDIBLE" : dentro ? "DENTRO" : "FUERA"} · ` +
      `dist ${Math.round(dist)}m · prec ±${Math.round(p.precision)}m · radio ${config.radio}m · ` +
      `via ${p.via} · pos ${p.lat.toFixed(5)},${p.lng.toFixed(5)} · ${p.ms}ms${extra}`,
  );
});

// ── Registro: copiar / limpiar ─────────────────────────────────────────────
$("copiar").addEventListener("click", () => {
  // Sin `await` antes de escribir en el portapapeles: Safari exige que la
  // llamada salga del gesto del usuario, y un await intermedio lo pierde.
  const texto =
    `Prueba de geofence · build ${BUILD}\n` +
    `${navigator.userAgent}\n` +
    `modo: ${esStandalone() ? "app instalada" : "navegador"} · permiso: ${ultimoPermiso}\n` +
    `trabajo: ${config.lat}, ${config.lng} · radio ${config.radio}m · regla ${config.regla}\n\n` +
    registro.join("\n");
  const fin = (ok) =>
    alert(ok ? "Registro copiado. Pégalo en el chat." : "No se pudo copiar: selecciona el texto del registro a mano.");
  try {
    navigator.clipboard.writeText(texto).then(() => fin(true), () => fin(false));
  } catch (e) {
    fin(false);
  }
});

$("actualizar").addEventListener("click", async () => {
  // Salida de emergencia: en una PWA de iPhone no hay barra de direcciones ni
  // botón de recargar, así que sin esto la única forma de actualizar era
  // borrar el icono y volver a instalarla.
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const n = await caches.keys();
      await Promise.all(n.map((k) => caches.delete(k)));
    }
  } catch (e) {
    /* da igual: lo que importa es la recarga de abajo */
  }
  location.replace(location.pathname + "?recarga=" + Date.now());
});

$("limpiar").addEventListener("click", () => {
  if (!confirm("¿Borrar el registro de intentos?")) return;
  registro = [];
  escribir(CLAVE_LOG, registro);
  pintarRegistro();
});

// ── Arranque ───────────────────────────────────────────────────────────────
$("build").textContent = "build " + BUILD;
pintarCampos();
pintarResumen();
pintarRegistro();
pintarContexto("APERTURA");
// Al volver a la app se vuelve a mirar el permiso: es como se contesta la
// pregunta 2 (¿lo recuerda entre arranques?).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pintarContexto("VUELTA A LA APP");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => {
      apuntar(`${new Date().toLocaleString("es-ES")} · SW no registrado: ${e && e.message ? e.message : e}`);
    });
  });
}
