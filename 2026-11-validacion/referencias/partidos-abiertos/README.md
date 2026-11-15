# Club de pádel

API HTTP de reservas de un club de pádel: pistas, socios, reservas, partidos abiertos y las reglas del club. El estado vive en memoria y sale de una semilla determinista, así que cada arranque parte de lo mismo.

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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional, salvo para fijar el nivel de un socio y para crear, unirse, salir y cancelar partidos abiertos: ahí, sin cabecera, la API responde `401 NO_IDENTIFICADO`, y con un socio que no tiene permiso, `403 SIN_PERMISO`. Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas. Cuentan sus reservas confirmadas que no han empezado (también las de los partidos que organiza) y los partidos abiertos o completos que no han empezado en los que juega sin ser el organizador. Con 3, reservar, crear un partido y unirse a uno responden `409 LIMITE_DE_RESERVAS`.
- No se reservan pistas cerradas ni franjas que ya han empezado.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

### Partidos abiertos

Un socio reserva una pista y deja las otras tres plazas abiertas para que se apunten otros socios, si quiere, solo de un rango de nivel. Los partidos son siempre de 4 jugadores, y no se cobra nada: el importe por jugador y las penalizaciones solo se anotan.

- **Nivel de juego:** cada socio tiene un `nivel` de 1 a 7 en pasos de 0,5 (por ejemplo, 3 o 4,5), o `null` si no lo ha fijado. En la semilla, todos empiezan con `null`. Lo fija el propio socio o un gestor.
- **Crear un partido** reserva la pista a nombre de quien lo crea, que es el organizador y su primer jugador. La reserva se hace con las comprobaciones y los errores de siempre (la pista, la franja, la cuota al día, la pista cerrada, la franja pasada u ocupada y el límite de reservas futuras), con el importe de siempre y con `partidoId`. Solo se puede si faltan más de 6 horas para la franja (si no, `409 DEMASIADO_TARDE`).
- **Rango de nivel:** `nivelMin` y `nivelMax` van los dos o ninguno, con `nivelMin` menor o igual que `nivelMax`. En un partido con rango, el organizador y quien se une tienen que tener nivel (`NIVEL_SIN_DEFINIR`) y estar dentro del rango, con los extremos incluidos (`NIVEL_FUERA_DE_RANGO`). En uno sin rango se puede unir cualquiera, tenga nivel o no.
- **Cómo se reparte el importe:** el partido cuesta lo que su reserva (`importe`), y a cada jugador le toca la cuarta parte, redondeada al céntimo hacia arriba (`importePorJugador`).
- **Unirse:** quien se une va al final de `jugadores` y ocupa una plaza libre. Con el cuarto jugador, el partido queda `completo`. No se puede unir nadie a un partido completo o cancelado, ni quien ya juega en él, ni quien no tiene la cuota al día o ya tiene 3 reservas futuras.
- **Salir** es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y quien sale paga su parte: queda en `penalizaciones`, con su `socioId` y el `importePorJugador`. Si el partido estaba completo, vuelve a `abierto`. No se puede salir de un partido cancelado ni de uno que ya ha empezado, y el organizador no puede salir de su partido: para dejarlo, lo cancela.
- **Cancelar un partido** lo puede quien lo organiza o un gestor. El partido queda `cancelado` con `motivo: "organizador"` y se cancela su reserva, así que la franja queda libre. Es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y la reserva lleva la penalización de siempre, el 100 % del importe.
- **Cancelación automática:** un partido que no está completo cuando faltan 6 horas o menos para que empiece se cancela solo, sin penalización para nadie. Desde ese momento sale `cancelado` con `motivo: "incompleto"`, su reserva sale cancelada y su franja, libre. Pasa lo mismo si deja de estar completo cuando ya faltan 6 horas o menos: quien sale paga su parte, como siempre con menos de 24 horas, y el partido se cancela solo.
- **La reserva va con su partido:** no se cancela con `POST /api/reservas/:id/cancelar` (`409 ES_UN_PARTIDO`), sino cancelando el partido.

## API

### Pistas

- `GET /api/pistas`: todas las pistas. Responde `{ pistas: Pista[] }`.
- `PATCH /api/pistas/:id` con `{ estado: "operativa" | "cerrada" }`: abre o cierra una pista. Responde `{ pista }`.

### Disponibilidad

- `GET /api/disponibilidad?fecha=AAAA-MM-DD[&pista=<id>]`: las franjas de ese día por pista, cada una con `inicio`, `fin`, `estado` (`libre`, `reservada` o `cerrada`) y `precio`.

### Socios

- `GET /api/socios?texto=<texto>`: busca socios por nombre (sin tener en cuenta acentos), email o id. Hasta 20 resultados.
- `PATCH /api/socios/:id` con `{ nivel }`: fija el nivel de juego de un socio (un número de 1 a 7 en pasos de 0,5) o lo quita con `null`. Solo el propio socio o un gestor. Responde `{ socio }`. Errores: `NO_IDENTIFICADO` (401), `SOCIO_NO_ENCONTRADO` (404), `SIN_PERMISO` (403) y `DATOS_INVALIDOS` (400: el nivel no vale).

Un socio tiene `id`, `nombre`, `email`, `cuotaActiva`, `rol` y `nivel`.

### Reservas

- `GET /api/reservas`: lista reservas con filtros opcionales `fecha`, `desde`, `hasta` (por día de inicio, ambos incluidos), `socio`, `pista` y `estado` (`confirmada`, `cancelada` o `no_presentada`), paginada con `limite` (1 a 100, 50 por defecto) y `pagina`. Responde `{ total, pagina, paginas, reservas }`.
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas? }`: crea una reserva. Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` y `LIMITE_DE_RESERVAS`.
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `ES_UN_PARTIDO` (la reserva es la de un partido: se cancela con el partido), `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`. Las reservas de un partido llevan además `partidoId`.

### Partidos abiertos

Consultar no necesita identificarse. Crear, unirse, salir y cancelar necesitan `X-Socio` (si no, `401 NO_IDENTIFICADO`).

- `POST /api/partidos` con `{ pistaId, inicio, nivelMin?, nivelMax? }`: crea un partido abierto organizado por quien llama y reserva la pista a su nombre. Responde `201 { partido }`, con el partido `abierto`, el organizador como único jugador, 3 plazas libres y sin penalizaciones. Sin rango, `nivelMin` y `nivelMax` no se mandan (o van los dos a `null`). Errores: `DATOS_INVALIDOS` (400: faltan `pistaId` o `inicio`, o el rango no vale), los de `POST /api/reservas` (`PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` y `LIMITE_DE_RESERVAS`), `DEMASIADO_TARDE` (409: faltan 6 horas o menos para la franja), y `NIVEL_SIN_DEFINIR` y `NIVEL_FUERA_DE_RANGO` (409: con rango, el organizador no tiene nivel o no está dentro).
- `GET /api/partidos[?fecha=AAAA-MM-DD][&nivel=<nivel>]`: los partidos con plazas libres, es decir, los `abierto` que no han empezado, por orden de `inicio`. Con `fecha`, solo los de ese día, y con `nivel` (por ejemplo, `nivel=4.5`), solo los que admiten ese nivel: los que no tienen rango y los que tienen un rango que lo incluye. Responde `{ partidos }`. Errores: `DATOS_INVALIDOS` (400: la fecha o el nivel no valen).
- `GET /api/partidos/:id`: un partido. Responde `{ partido }`. Errores: `PARTIDO_NO_ENCONTRADO` (404).
- `POST /api/partidos/:id/unirse`: quien llama se une al partido. Responde `{ partido }`. Errores: `PARTIDO_NO_ENCONTRADO` (404), `PARTIDO_CANCELADO`, `PARTIDO_COMPLETO`, `YA_APUNTADO`, `CUOTA_INACTIVA`, `NIVEL_SIN_DEFINIR`, `NIVEL_FUERA_DE_RANGO` y `LIMITE_DE_RESERVAS` (409).
- `POST /api/partidos/:id/salir` con `{ forzar? }`: quien llama sale del partido. Responde `{ partido }`. Errores: `PARTIDO_NO_ENCONTRADO` (404), `DATOS_INVALIDOS` (400: `forzar` no es `true` ni `false`), `PARTIDO_CANCELADO`, `FRANJA_PASADA` (el partido ya ha empezado), `ORGANIZADOR_NO_PUEDE_SALIR`, `NO_APUNTADO` (quien llama no juega en el partido) y `FUERA_DE_PLAZO` (faltan menos de 24 horas y no lleva `forzar: true`), todos 409.
- `POST /api/partidos/:id/cancelar` con `{ forzar? }`: cancela el partido y su reserva. Solo quien lo organiza o un gestor. Responde `{ partido }`. Errores: `PARTIDO_NO_ENCONTRADO` (404), `SIN_PERMISO` (403), `DATOS_INVALIDOS` (400: `forzar` no es `true` ni `false`), `PARTIDO_CANCELADO`, `FRANJA_PASADA` (el partido ya ha empezado) y `FUERA_DE_PLAZO` (faltan menos de 24 horas y no lleva `forzar: true`), todos 409.

Un partido tiene `id`, `reservaId`, `pistaId`, `inicio`, `fin`, `organizador` (el id del socio), `jugadores` (los ids de los socios que juegan, empezando por el organizador y por orden de llegada), `plazasLibres`, `nivelMin` y `nivelMax` (o `null` los dos), `estado` (`abierto`, `completo` o `cancelado`), `importe` (el de la reserva), `importePorJugador`, `penalizaciones` (cada una con `socioId` e `importe`) y, si se cancela, `motivo` (`organizador` si lo cancela su organizador o un gestor, e `incompleto` si se cancela solo).

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club. Los partidos que con la nueva hora no están completos cuando faltan 6 horas o menos se cancelan solos en ese momento.
