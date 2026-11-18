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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. La lista de espera sí la exige: sin ella, `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso (`SIN_PERMISO`), 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

### Lista de espera

- Un socio se apunta a la lista de espera de una franja ocupada. Si la franja está libre, no hay lista: se reserva directamente. Valen las mismas comprobaciones que al reservar: la pista existe y está operativa, la franja es válida y no ha empezado, y el socio tiene la cuota al día.
- Nadie puede estar dos veces en la lista de la misma franja ni esperar una franja que ya tiene reservada. Cada socio puede tener como mucho 2 esperas activas.
- La posición es el orden de llegada entre las esperas activas de la franja, empezando por 1. Si alguien se retira, los que estaban detrás suben un puesto.
- Cuando se cancela una reserva, con o sin `forzar`, la franja se asigna al primero de la lista: se crea a su nombre una reserva confirmada, con el precio de la franja y la nota `Asignada desde la lista de espera`, y su espera pasa a `asignada`. Si al primero no le dejarían reservar (no tiene la cuota al día o ya tiene 3 reservas futuras), su espera pasa a `descartada` y se prueba con el siguiente. Si no queda nadie, la franja se queda libre.
- Cuando una franja empieza, sus esperas activas caducan: dejan de aparecer, no se asignan y no cuentan para el límite de 2.
- La lista de espera no cambia los plazos ni las penalizaciones de cancelar, y no avisa a nadie: la reserva asignada aparece a nombre del socio.

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
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva y asigna la franja al primero de su lista de espera que pueda jugar. Responde `{ reserva, asignadaA }`, donde `asignadaA` es el id de la reserva creada desde la lista de espera, o `null` si no se asignó a nadie. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`.

### Lista de espera

Todas necesitan la cabecera `X-Socio` (sin ella, `401 NO_IDENTIFICADO`). Cada socio gestiona sus propias esperas, y un gestor puede consultar y retirar las de cualquiera.

- `POST /api/esperas` con `{ pistaId, inicio }`: apunta a quien llama a la lista de espera de esa franja. Responde `201 { espera }`. Errores: `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_LIBRE` (409: la franja está libre y se puede reservar directamente), `YA_RESERVADA` (409: quien llama ya la tiene reservada), `YA_EN_ESPERA` (409: ya está en esa lista) y `LIMITE_DE_ESPERAS` (409: ya tiene 2 esperas activas).
- `GET /api/esperas[?socio=<id>]`: las esperas activas de quien llama, con su posición actual. Responde `{ esperas: Espera[] }`. Un gestor puede pedir las de otro socio con `socio`. Errores: `SIN_PERMISO` (403: pedir las de otro sin ser gestor) y `SOCIO_NO_ENCONTRADO`.
- `DELETE /api/esperas/:id`: retira la espera y los que estaban detrás suben un puesto. Responde `{ espera }` con estado `retirada`. Errores: `ESPERA_NO_ENCONTRADA` (404), `SIN_PERMISO` (403: no es su dueño ni un gestor) y `ESPERA_NO_ACTIVA` (409: ya estaba retirada, asignada, descartada o caducada).

Una espera tiene `id`, `socioId`, `pistaId`, `inicio`, `estado` (`activa`, `retirada`, `asignada` o `descartada`) y, mientras está activa, `posicion`.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
