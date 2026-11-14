# Club de pádel

API HTTP de reservas de un club de pádel: pistas, socios, reservas y las reglas del club. El estado vive en memoria y sale de una semilla determinista, así que cada arranque parte de lo mismo.

```sh
npm install
npm run check   # tipos y tests
npm start       # arranca la API (PORT=0 elige un puerto libre y lo imprime como PUERTO=<n>)
```

En el club siempre es miércoles 18 de noviembre de 2026 a las 10:00, salvo que se arranque con `AHORA=AAAA-MM-DDTHH:MM`.

## Convenciones

- **Importes:** en céntimos de euro, como enteros.
- **Fechas y horas:** las locales del club (Europe/Madrid), como texto: `AAAA-MM-DD` y `AAAA-MM-DDTHH:MM`.
- **Horario:** el club abre a las 09:00 y la última reserva tiene que terminar como muy tarde a las 22:30.
- **Franjas:** de 90 minutos, que empiezan a las 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30 y 21:00. Son las que enseña la disponibilidad.
- **Duraciones:** una reserva dura 60, 90 o 120 minutos (90 si no se dice) y empieza en punto o y media (`HH:00` o `HH:30`), no antes de las 09:00, y termina como muy tarde a las 22:30. No tiene que coincidir con una franja: de 11:00 a 12:00 o de 17:30 a 19:30 también valen.
- **Precios:** cada pista tiene precio de valle y de punta por franja de 90 minutos. Es punta a partir de las 18:00 y todo el fin de semana. Una reserva se cobra por minutos: cada minuto vale el precio de la franja de esa pista entre 90, de valle los de lunes a viernes antes de las 18:00 y de punta los de las 18:00 en adelante y todos los del sábado y el domingo. El total se redondea al céntimo más cercano, y medio céntimo, hacia arriba. Por ejemplo, en la pista 1 (valle 1800, punta 2800), un martes de 17:30 a 19:00 son 30 minutos de valle y 60 de punta: 30 × 1800 / 90 + 60 × 2800 / 90 = 2466,67, que se cobran como 2467 céntimos. Una reserva de 90 minutos que empieza a una de las horas de las franjas cuesta lo mismo que su franja.
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas.
- No se reservan pistas cerradas ni reservas que ya han empezado.
- Una reserva no puede solaparse con ninguna reserva confirmada de la misma pista, sea cual sea su duración. Que una termine justo cuando empieza otra no es solaparse, y las canceladas no ocupan la pista.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

## API

### Pistas

- `GET /api/pistas`: todas las pistas. Responde `{ pistas: Pista[] }`.
- `PATCH /api/pistas/:id` con `{ estado: "operativa" | "cerrada" }`: abre o cierra una pista. Responde `{ pista }`.

### Disponibilidad

- `GET /api/disponibilidad?fecha=AAAA-MM-DD[&pista=<id>]`: ese día, por pista:
  - `franjas`: las franjas de 90 minutos, cada una con `inicio`, `fin`, `estado` (`libre`, `reservada` o `cerrada`) y `precio`. Una franja está `reservada` si cualquier reserva confirmada de esa pista se solapa con ella, aunque sea en parte.
  - `huecos`: los intervalos libres del día, cada uno con `inicio` y `fin` (`AAAA-MM-DDTHH:MM`): los más largos posibles entre las 09:00 y las 22:30 sin solaparse con ninguna reserva confirmada, ordenados por hora. No tienen en cuenta la hora actual, y una pista cerrada no tiene huecos (`[]`).

### Socios

- `GET /api/socios?texto=<texto>`: busca socios por nombre (sin tener en cuenta acentos), email o id. Hasta 20 resultados.

### Reservas

- `GET /api/reservas`: lista reservas con filtros opcionales `fecha`, `desde`, `hasta` (por día de inicio, ambos incluidos), `socio`, `pista` y `estado` (`confirmada`, `cancelada` o `no_presentada`), paginada con `limite` (1 a 100, 50 por defecto) y `pagina`. Responde `{ total, pagina, paginas, reservas }`.
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, duracion?, notas? }`: crea una reserva. `duracion` va en minutos: `60`, `90` o `120`, y si no viene son 90. Responde `201 { reserva }`. Errores: `DURACION_INVALIDA` (400: `duracion` no es `60`, `90` ni `120`), `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA` (400: no empieza en punto o y media, empieza antes de las 09:00 o termina después de las 22:30), `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` (409: se solapa con una reserva confirmada de la pista) y `LIMITE_DE_RESERVAS`.
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `duracion` (minutos; las que ya existían antes de las duraciones son de 90), `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
