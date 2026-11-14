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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional, salvo para lo que solo puede hacer un gestor: eximir de la penalización al cancelar y consultar el informe de caja. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cualquiera puede cancelar una reserva que todavía no ha empezado. La penalización depende de la antelación:

  | Antelación | Penalización |
  |---|---|
  | 48 horas o más | ninguna |
  | 24 horas o más, y menos de 48 | 25 % del importe |
  | menos de 24 horas | 50 % del importe, y solo con `forzar: true` |

  La antelación se cuenta en horas reales de Madrid (Europe/Madrid), con el cambio de hora: del viernes 26 de marzo de 2027 a las 20:30 al domingo 28 a las 21:00 hay 47,5 horas, no 48,5, porque esa madrugada los relojes se adelantan una hora.
- Un gestor puede eximir de la penalización (`exento: true`) en cualquier momento antes del inicio, sin `forzar`, con un motivo de al menos 10 caracteres que queda guardado en `motivoCancelacion`.
- Al cancelar, la API informa del reembolso: lo que se devuelve al socio, el importe menos la penalización. Es un dato para la recepción, no mueve dinero.
- Las reservas que ya estaban canceladas conservan su penalización, también las de la política anterior.

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
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo?, exento? }`: cancela una reserva con la política de cancelación. Responde `{ reserva, reembolso }`: `reembolso` es lo que se devuelve al socio en céntimos, `importe - penalizacion` (el importe entero si no hay penalización). Con `exento: true` cancela sin penalización y sin `forzar`; hace falta la cabecera `X-Socio` de un gestor y un `motivo` de al menos 10 caracteres. Errores: `RESERVA_NO_ENCONTRADA` (404), `DATOS_INVALIDOS` (400: `forzar` o `exento` que no son `true` o `false`, o `exento` sin `motivo` o con uno más corto), `NO_IDENTIFICADO` (401: `exento` sin `X-Socio`), `SIN_PERMISO` (403: `exento` de quien no es gestor), `YA_CANCELADA`, `RESERVA_PASADA` (también con `exento`) y `FUERA_DE_PLAZO` (409: menos de 24 horas sin `forzar`).

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe` y `notas`. Si se canceló con penalización, tiene también `penalizacion`, y si se dio un motivo, `motivoCancelacion`.

### Informes

- `GET /api/informes/caja?mes=AAAA-MM`: el informe de caja del mes, solo para gestores. Cuenta las reservas por su fecha de inicio. Responde `{ mes, pistas, total }`. `pistas` tiene una entrada por cada pista del club, también las que no tienen movimientos, ordenadas por id, con `pistaId`, `reservas` (cuántas reservas confirmadas o no presentadas empiezan ese mes), `ingresos` (la suma de sus importes), `penalizaciones` (la suma de las penalizaciones de las reservas canceladas que empiezan ese mes) y `total` (ingresos más penalizaciones). `total` lleva `reservas`, `ingresos`, `penalizaciones` y `total` de todo el club. Errores: `NO_IDENTIFICADO` (401: sin `X-Socio`), `SIN_PERMISO` (403: quien llama no es gestor) y `DATOS_INVALIDOS` (400: `mes` falta o no tiene el formato `AAAA-MM`).

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
