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

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

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
- `GET /api/reservas/exportar?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&estado=<estado>]`: exporta a CSV, para una hoja de cálculo, las reservas que empiezan entre `desde` y `hasta` (los dos días incluidos), en cualquier estado o solo en el de `estado` (`confirmada`, `cancelada` o `no_presentada`). Las dos fechas son obligatorias y el periodo puede abarcar como mucho 92 días, contando los dos extremos. Solo para gestores. Responde `200` con el CSV en el cuerpo (no en JSON), `content-type: text/csv; charset=utf-8` y `content-disposition: attachment; filename="reservas-<desde>-<hasta>.csv"`. Errores: `NO_IDENTIFICADO` (401, sin `X-Socio`), `SIN_PERMISO` (403, si quien llama no es gestor), `DATOS_INVALIDOS` (400, si falta una fecha, no tiene el formato `AAAA-MM-DD`, `desde` es posterior a `hasta` o `estado` no es uno de los tres) y `RANGO_DEMASIADO_GRANDE` (400, si el periodo abarca más de 92 días).

  El CSV sigue el RFC 4180. La primera línea es la cabecera `id,fecha,hora,pista,socio,email,estado,importe,penalizacion,notas` y después va una fila por reserva, ordenadas por inicio y, si empiezan a la vez, por id de pista. `fecha` y `hora` son el día (`AAAA-MM-DD`) y la hora (`HH:MM`) de inicio, `pista` es el nombre de la pista (`Pista 1`), `socio` y `email` son el nombre y el email del socio, e `importe` y `penalizacion` van en euros con dos decimales y punto decimal (`18.00`). Si la reserva no tiene penalización, `penalizacion` va vacía. Un campo con comas, comillas dobles o saltos de línea va entre comillas dobles, con las comillas de dentro duplicadas, y el resto va sin comillas. Cada línea, también la cabecera y la última, termina en CRLF (`\r\n`).
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas? }`: crea una reserva. Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` y `LIMITE_DE_RESERVAS`.
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
