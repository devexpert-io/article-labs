# Club de pádel

API HTTP de reservas de un club de pádel, en TypeScript sobre Node 26 (Node ejecuta los `.ts` directamente, sin compilar). El estado vive en memoria y sale de una semilla determinista.

## Mapa

- `src/servidor.ts`: rutas HTTP, identidad de quien llama (`X-Socio`) y ayudas de prueba (`/_estado`, `/_reloj`).
- `src/nucleo.ts`: las operaciones y las reglas del club.
- `src/semilla.ts`: datos de ejemplo, franjas y precios.
- `src/tipos.ts`: tipos del dominio.
- `test/`: tests de la API con `node:test`. `test/ayuda.ts` arranca la API en un puerto libre.
- `README.md`: convenciones, reglas del club y referencia de la API.
- `docs/specs/`: una spec por feature, con sus criterios de aceptación.

## Comandos

- `npm run check`: tipos y tests. Tiene que pasar antes de dar nada por terminado.
- `npm start`: arranca la API.

## Convenciones

- Importes en céntimos de euro, como enteros.
- Fechas y horas locales del club (Europe/Madrid), como texto: `AAAA-MM-DD` y `AAAA-MM-DDTHH:MM`.
- La hora actual es `estado.ahora` (2026-11-18T10:00 por defecto, se cambia con `AHORA` o con `POST /_reloj`). No uses nunca la hora del sistema.
- Errores con `ErrorDelClub`: `{"error": {"codigo", "mensaje"}}` y su código HTTP (400, 401, 403, 404 o 409, ver el README).

## Cómo se trabaja una feature

Con la skill `implementar-feature`, que tiene el procedimiento del proyecto.
