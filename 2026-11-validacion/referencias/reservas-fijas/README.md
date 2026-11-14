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
- **Franjas:** de 90 minutos, que empiezan a las 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30 y 21:00.
- **Precios:** cada pista tiene precio de valle y de punta. Es punta a partir de las 18:00 y todo el fin de semana.
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional, salvo para las series de reservas fijas, que solo puede gestionar un gestor. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas. Solo cuentan las reservas normales: las de sus series de reservas fijas quedan fuera.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

### Reservas fijas

Para los grupos que juegan siempre el mismo día a la misma hora, la recepción crea de una vez una serie semanal para un socio. Solo un gestor crea, consulta y cancela series.

- Una serie tiene de 2 a 12 semanas seguidas, contando la primera. Crea una reserva confirmada cada 7 días, en la misma pista y a la misma hora local que la primera, también cuando entre medias cambia la hora (del martes 23 de marzo de 2027 a las 19:30, la segunda es el martes 30 a las 19:30).
- Si una semana la franja ya está reservada, esa semana se salta y queda en `saltadas` con su `inicio` y el código `FRANJA_NO_DISPONIBLE`. Las demás se reservan. Si no se puede reservar ninguna, `409 SERIE_VACIA` y no se crea nada.
- La cuota, la pista y la franja se comprueban para toda la serie: si el socio no tiene la cuota al día, la pista está cerrada o la primera franja no es válida o ya ha empezado, no se crea nada.
- Las reservas de una serie no cuentan para el límite de 3 reservas futuras: la serie se crea aunque el socio ya tenga 3, y no le impiden hacer reservas normales.
- **Descuento:** en una serie de 8 semanas o más, cada reserva cuesta un 10 % menos que su precio normal, redondeado al céntimo hacia abajo. Con menos de 8 semanas, cada reserva cuesta su precio normal.
- **Cancelar la serie** cancela sin penalización las reservas confirmadas de la serie a las que les faltan 24 horas o más. Las que empiezan en menos de 24 horas siguen confirmadas y quedan pendientes, salvo con `forzar: true`, que las cancela con la penalización de siempre (el 100 % del importe). Las que ya han empezado, las canceladas y las no presentadas no se tocan.
- Cada reserva de una serie también se puede cancelar sola, como cualquier otra reserva y con las mismas reglas. La serie sigue con las demás.

## API

### Pistas

- `GET /api/pistas`: todas las pistas. Responde `{ pistas: Pista[] }`.
- `PATCH /api/pistas/:id` con `{ estado: "operativa" | "cerrada" }`: abre o cierra una pista. Responde `{ pista }`.

### Disponibilidad

- `GET /api/disponibilidad?fecha=AAAA-MM-DD[&pista=<id>]`: las franjas de ese día por pista, cada una con `inicio`, `fin`, `estado` (`libre`, `reservada` o `cerrada`) y `precio`.

### Socios

- `GET /api/socios?texto=<texto>`: busca socios por nombre (sin tener en cuenta acentos), email o id. Hasta 20 resultados.

### Reservas

- `GET /api/reservas`: lista reservas con filtros opcionales `fecha`, `desde`, `hasta` (por día de inicio, ambos incluidos), `socio`, `pista` y `estado` (`confirmada`, `cancelada` o `no_presentada`), paginada con `limite` (1 a 100, 50 por defecto) y `pagina`. Responde `{ total, pagina, paginas, reservas }`.
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas? }`: crea una reserva. Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` y `LIMITE_DE_RESERVAS`.
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`. Las reservas de una serie llevan además `serieId`.

### Series (reservas fijas)

Solo para gestores: sin `X-Socio`, `401 NO_IDENTIFICADO`, y con un socio que no es gestor, `403 SIN_PERMISO`.

- `POST /api/series` con `{ socioId, pistaId, inicio, semanas }`: crea una serie. `inicio` es la primera reserva y `semanas` cuántas semanas seguidas, contando la primera (un entero de 2 a 12). Responde `201 { serie }`. Errores: `DATOS_INVALIDOS` (400: faltan datos o `semanas` no es un entero entre 2 y 12), `SOCIO_NO_ENCONTRADO` y `PISTA_NO_ENCONTRADA` (404), `FRANJA_INVALIDA` (400), `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA` y `SERIE_VACIA` (409: la franja está reservada todas las semanas).
- `GET /api/series/:id`: la serie, con sus reservas completas por orden de fecha. Responde `{ serie }`. Errores: `SERIE_NO_ENCONTRADA` (404).
- `POST /api/series/:id/cancelar` con `{ forzar? }`: cancela la serie. Responde `{ serie, canceladas, pendientes }`: `canceladas` son las reservas que se han cancelado y `pendientes`, las que siguen confirmadas porque empiezan en menos de 24 horas (con `forzar: true` se cancelan también, con la penalización del 100 % del importe, y van en `canceladas`). Errores: `SERIE_NO_ENCONTRADA` (404) y `DATOS_INVALIDOS` (400: `forzar` no es `true` ni `false`).

Una serie tiene `id`, `socioId`, `pistaId`, `inicio`, `semanas`, `reservas` (los ids de las reservas que se crearon, por orden de fecha; en `GET /api/series/:id`, las reservas completas) y `saltadas` (las semanas que no se pudieron reservar, cada una con `inicio` y `codigo`).

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
