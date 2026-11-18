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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe, que es lo que paga el socio (con el descuento, si reservó con un código).
- Al reservar se puede usar un código de descuento (ver abajo).

## Códigos de descuento

Quien reserva puede mandar un código en el campo `codigo` de `POST /api/reservas`. El catálogo es fijo y vive en `src/nucleo.ts`: no se crean ni se editan códigos por la API.

| Código | Descuento | Condiciones |
|---|---|---|
| `BIENVENIDA` | 50 % | Solo en la primera reserva del socio: no puede tener ninguna reserva anterior, en ningún estado. Vale en reservas hechas hasta el 31 de diciembre de 2026 incluido, según la hora del club. |
| `MANANAS` | 4,00 € | Solo en franjas de lunes a viernes que empiezan antes de las 12:00. Sin caducidad ni límite de usos. |
| `CLUB10` | 10 % | Cualquier franja. Cada socio puede tener como mucho 3 reservas con este código, contando las confirmadas y las no presentadas. Las canceladas no cuentan. |

- No importan las mayúsculas ni los espacios de alrededor: `"  club10 "` vale y se guarda como `CLUB10`.
- Un código por reserva. Los descuentos no se acumulan.
- Las reglas del club van primero: si la reserva no se puede hacer (cuota, pista, franja, límite de reservas…), se responde ese error y el código no cuenta como usado.
- Errores: `400 DATOS_INVALIDOS` si `codigo` no es un texto, `400 CODIGO_INVALIDO` si no está en el catálogo y `409 CODIGO_NO_APLICABLE` si no cumple sus condiciones.
- La disponibilidad y los precios de las pistas no cambian: muestran el precio sin descuento.

## API

### Pistas

- `GET /api/pistas`: todas las pistas. Responde `{ pistas: Pista[] }`.
- `PATCH /api/pistas/:id` con `{ estado: "operativa" | "cerrada" }`: abre o cierra una pista. Responde `{ pista }`.

### Disponibilidad

- `GET /api/disponibilidad?fecha=AAAA-MM-DD[&pista=<id>]`: las franjas de ese día por pista, cada una con `inicio`, `fin`, `estado` (`libre`, `reservada` o `cerrada`) y `precio` (el de la franja, sin descuentos).

### Socios

- `GET /api/socios?texto=<texto>`: busca socios por nombre (sin tener en cuenta acentos), email o id. Hasta 20 resultados.

### Reservas

- `GET /api/reservas`: lista reservas con filtros opcionales `fecha`, `desde`, `hasta` (por día de inicio, ambos incluidos), `socio`, `pista` y `estado` (`confirmada`, `cancelada` o `no_presentada`), paginada con `limite` (1 a 100, 50 por defecto) y `pagina`. Responde `{ total, pagina, paginas, reservas }`.
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas?, codigo? }`: crea una reserva. `codigo` es opcional: un código de descuento del catálogo (ver Códigos de descuento). Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE`, `LIMITE_DE_RESERVAS` y, si se manda `codigo`, `DATOS_INVALIDOS` (no es un texto), `CODIGO_INVALIDO` (400) y `CODIGO_NO_APLICABLE` (409).
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`. Las reservas creadas por la API guardan además sus importes en céntimos: `importeBase` (el precio de la franja), `descuento` (lo que se descuenta, 0 sin código) e `importe` (lo que paga el socio, `importeBase - descuento`, nunca menos de 0). Si se usó un código, lo guardan en `codigo`, en mayúsculas. Las reservas de la semilla solo tienen `importe`.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
