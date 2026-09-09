# Prueba de geofence — banco de pruebas desechable

Sirve para decidir **una sola cosa**: si el control por ubicación aguanta en una
PWA instalada, y por tanto si entra o no en el módulo de fichajes de la
plataforma.

**No es el fichaje real.** No registra ninguna jornada, no envía nada a ningún
servidor y todo se queda en el móvil (`localStorage`).

## Qué mide

1. En una PWA **instalada** (standalone), ¿aparece el diálogo de permiso?
2. ¿Se recuerda el permiso al cerrar y reabrir la app?
3. ¿Qué precisión real da **dentro** de un local?
4. ¿Cuánto tarda?

## Por qué el vigía no cierra la medición

La primera versión declaraba «COLGADA» a los 20 s y descartaba la respuesta que
llegara después. Estaba mal: el `timeout` de la API **no incluye** lo que el
usuario tarda en contestar al diálogo, así que los dos relojes se suman (6 s de
persona + 15 s de la API buscando señal en interior = 21 s) y se registraba un
cuelgue en un móvil que se había comportado de manual. Peor: era indistinguible
del fallo real de iOS que veníamos a detectar.

Ahora el vigía solo **avisa** por pantalla; los callbacks siguen vivos y una
respuesta tardía gana. Solo se declara colgada tras 75 s.

Por lo mismo se anota, en cada lectura, si hubo diálogo por medio y si la app
pasó a segundo plano: en esos casos el tiempo medido no es el de la API.

## Cuando termine la prueba

Borrar el repositorio entero. No debe quedar nada.
