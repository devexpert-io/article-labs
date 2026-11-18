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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional, salvo para exportar las reservas, que es solo para gestores. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. La lista de espera sí la exige: sin ella, `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso (`SIN_PERMISO`), 404 si algo no existe y 409 si lo impide una regla del club.

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

- `GET /api/disponibilidad?fecha=AAAA-MM-DD[&pista=<id>]`: las franjas de ese día por pista, cada una con `inicio`, `fin`, `estado` (`libre`, `reservada` o `cerrada`) y `precio` (el de la franja, sin descuentos).

### Socios

- `GET /api/socios?texto=<texto>`: busca socios por nombre (sin tener en cuenta acentos), email o id. Hasta 20 resultados.

### Reservas

- `GET /api/reservas`: lista reservas con filtros opcionales `fecha`, `desde`, `hasta` (por día de inicio, ambos incluidos), `socio`, `pista` y `estado` (`confirmada`, `cancelada` o `no_presentada`), paginada con `limite` (1 a 100, 50 por defecto) y `pagina`. Responde `{ total, pagina, paginas, reservas }`.
- `GET /api/reservas/exportar?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&estado=<estado>]`: exporta a CSV, para una hoja de cálculo, las reservas que empiezan entre `desde` y `hasta` (los dos días incluidos), en cualquier estado o solo en el de `estado` (`confirmada`, `cancelada` o `no_presentada`). Las dos fechas son obligatorias y el periodo puede abarcar como mucho 92 días, contando los dos extremos. Solo para gestores. Responde `200` con el CSV en el cuerpo (no en JSON), `content-type: text/csv; charset=utf-8` y `content-disposition: attachment; filename="reservas-<desde>-<hasta>.csv"`. Errores: `NO_IDENTIFICADO` (401, sin `X-Socio`), `SIN_PERMISO` (403, si quien llama no es gestor), `DATOS_INVALIDOS` (400, si falta una fecha, no tiene el formato `AAAA-MM-DD`, `desde` es posterior a `hasta` o `estado` no es uno de los tres) y `RANGO_DEMASIADO_GRANDE` (400, si el periodo abarca más de 92 días).

  El CSV sigue el RFC 4180. La primera línea es la cabecera `id,fecha,hora,pista,socio,email,estado,importe,penalizacion,notas` y después va una fila por reserva, ordenadas por inicio y, si empiezan a la vez, por id de pista. `fecha` y `hora` son el día (`AAAA-MM-DD`) y la hora (`HH:MM`) de inicio, `pista` es el nombre de la pista (`Pista 1`), `socio` y `email` son el nombre y el email del socio, e `importe` y `penalizacion` van en euros con dos decimales y punto decimal (`18.00`). Si la reserva no tiene penalización, `penalizacion` va vacía. Un campo con comas, comillas dobles o saltos de línea va entre comillas dobles, con las comillas de dentro duplicadas, y el resto va sin comillas. Cada línea, también la cabecera y la última, termina en CRLF (`\r\n`).
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas?, codigo? }`: crea una reserva. `codigo` es opcional: un código de descuento del catálogo (ver Códigos de descuento). Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE`, `LIMITE_DE_RESERVAS` y, si se manda `codigo`, `DATOS_INVALIDOS` (no es un texto), `CODIGO_INVALIDO` (400) y `CODIGO_NO_APLICABLE` (409).
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas? }`: crea una reserva. Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` y `LIMITE_DE_RESERVAS`.
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva y asigna la franja al primero de su lista de espera que pueda jugar. Responde `{ reserva, asignadaA }`, donde `asignadaA` es el id de la reserva creada desde la lista de espera, o `null` si no se asignó a nadie. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`. Las reservas creadas por la API guardan además sus importes en céntimos: `importeBase` (el precio de la franja), `descuento` (lo que se descuenta, 0 sin código) e `importe` (lo que paga el socio, `importeBase - descuento`, nunca menos de 0). Si se usó un código, lo guardan en `codigo`, en mayúsculas. Las reservas de la semilla solo tienen `importe`.

### Lista de espera

Todas necesitan la cabecera `X-Socio` (sin ella, `401 NO_IDENTIFICADO`). Cada socio gestiona sus propias esperas, y un gestor puede consultar y retirar las de cualquiera.

- `POST /api/esperas` con `{ pistaId, inicio }`: apunta a quien llama a la lista de espera de esa franja. Responde `201 { espera }`. Errores: `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_LIBRE` (409: la franja está libre y se puede reservar directamente), `YA_RESERVADA` (409: quien llama ya la tiene reservada), `YA_EN_ESPERA` (409: ya está en esa lista) y `LIMITE_DE_ESPERAS` (409: ya tiene 2 esperas activas).
- `GET /api/esperas[?socio=<id>]`: las esperas activas de quien llama, con su posición actual. Responde `{ esperas: Espera[] }`. Un gestor puede pedir las de otro socio con `socio`. Errores: `SIN_PERMISO` (403: pedir las de otro sin ser gestor) y `SOCIO_NO_ENCONTRADO`.
- `DELETE /api/esperas/:id`: retira la espera y los que estaban detrás suben un puesto. Responde `{ espera }` con estado `retirada`. Errores: `ESPERA_NO_ENCONTRADA` (404), `SIN_PERMISO` (403: no es su dueño ni un gestor) y `ESPERA_NO_ACTIVA` (409: ya estaba retirada, asignada, descartada o caducada).

Una espera tiene `id`, `socioId`, `pistaId`, `inicio`, `estado` (`activa`, `retirada`, `asignada` o `descartada`) y, mientras está activa, `posicion`.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
