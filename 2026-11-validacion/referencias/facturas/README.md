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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional, salvo para lo que solo puede hacer un gestor: generar y consultar facturas. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

### Facturación

La gestoría recibe una factura por socio y mes con lo que ha pagado por sus reservas y por las penalizaciones.

- **Qué se factura:** en la factura de un socio y un mes entran sus reservas que empiezan ese mes. Las confirmadas y las no presentadas, por su `importe`, con el concepto `Reserva`. Las canceladas con penalización, por su `penalizacion`, con el concepto `Penalización`. Las canceladas sin penalización no se facturan, y un socio que no tiene nada que facturar ese mes no tiene factura.
- **Mes cerrado:** solo se factura un mes que ya ha terminado según la hora del club, es decir, desde las 00:00 del día 1 del mes siguiente. Un mes cerrado ya no cambia, porque las reservas que han empezado no se pueden cancelar.
- **IVA:** los importes del club llevan el IVA (21 %) incluido. El `total` de una factura es la suma de sus líneas. La `base` se calcula sobre el total de la factura, no línea a línea: `total / 1,21` redondeado al céntimo más cercano, con medio céntimo hacia arriba. El `iva` es `total - base`. Por ejemplo, una factura con dos reservas de 18,00 € tiene un total de 36,00 €, una base de 29,75 € y un IVA de 6,25 €, aunque la base de cada reserva por separado redondearía a 14,88 €.
- **Numeración:** cada factura tiene un número `F<año>-<número de 4 cifras>`, por ejemplo `F2026-0001`, correlativo dentro del año del mes facturado (no del año en que se genera), sin huecos ni repetidos. Al generar un mes, sus facturas se numeran por orden de id de socio, a continuación de donde dejó la numeración el último mes generado de ese año. Cada año empieza en `0001`. Un mes sin nada que facturar no gasta números.
- **Generar dos veces:** volver a generar un mes ya generado devuelve las mismas facturas, con los mismos números, y no crea ninguna nueva.

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

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`.

### Facturas

Solo para gestores: sin `X-Socio`, `401 NO_IDENTIFICADO`, y con un socio que no es gestor, `403 SIN_PERMISO`. Qué se factura, el IVA y la numeración están en [Facturación](#facturación).

- `POST /api/facturas` con `{ mes: "AAAA-MM" }`: genera las facturas de un mes cerrado, una por cada socio con algo que facturar ese mes, ordenadas por id de socio. Responde `201 { facturas }` la primera vez y `200 { facturas }` las siguientes, con las mismas facturas y sin crear ninguna nueva. Errores: `NO_IDENTIFICADO` (401), `SIN_PERMISO` (403), `DATOS_INVALIDOS` (400: `mes` falta o no tiene el formato `AAAA-MM`) y `MES_ABIERTO` (409: el mes todavía no ha terminado según la hora del club).
- `GET /api/facturas?mes=AAAA-MM`: las facturas de un mes ya generado, ordenadas por id de socio. Responde `{ facturas }`, con una lista vacía si el mes no se ha generado. Errores: `NO_IDENTIFICADO` (401), `SIN_PERMISO` (403) y `DATOS_INVALIDOS` (400: `mes` falta o no tiene el formato `AAAA-MM`).
- `GET /api/facturas/:numero`: una factura por su número (`F2026-0001`). Responde `{ factura }`. Errores: `NO_IDENTIFICADO` (401), `SIN_PERMISO` (403) y `FACTURA_NO_ENCONTRADA` (404: no hay ninguna factura con ese número).

Una factura tiene `numero`, `mes` (`AAAA-MM`), `socioId`, `lineas`, `total`, `base` e `iva`. Cada línea tiene `reservaId`, `concepto` (`Reserva` o `Penalización`) e `importe`, y van ordenadas por el inicio de la reserva. Todos los importes van en céntimos, y el de las líneas y el `total` llevan el IVA incluido.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
