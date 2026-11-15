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
- **Identidad:** la cabecera `X-Socio` lleva el id del socio que hace la petición. Es opcional, salvo para gestionar torneos e inscribirse en ellos (ver [Torneos](#torneos)). Si lleva un id que no existe, la API responde `401 NO_IDENTIFICADO`. Los socios tienen rol `socio` o `gestor`. En la semilla, el único gestor es `socio-040` (la recepción del club).
- **Errores:** `{"error": {"codigo": "…", "mensaje": "…"}}` con su código HTTP: 400 si los datos no valen, 401 si no se sabe quién llama, 403 si no tiene permiso, 404 si algo no existe y 409 si lo impide una regla del club. Algunos errores traen más datos junto a `codigo` y `mensaje`, como los `conflictos` de `FRANJAS_OCUPADAS`.

## Reglas del club

- Para reservar hay que tener la cuota al día (`cuotaActiva`).
- Cada socio puede tener como máximo 3 reservas futuras confirmadas. Los partidos de los torneos no son reservas y no cuentan.
- No se reservan pistas cerradas, franjas que ya han empezado ni franjas que bloquea un torneo.
- Cancelar es gratis hasta 24 horas antes. Después, solo con `forzar: true`, y se cobra una penalización del 100 % del importe.

### Torneos

Torneos de parejas por eliminación directa (sin consolación, fases de grupos ni ligas).

- **Quién hace qué:** solo un gestor crea, cierra y cancela torneos y apunta resultados. Inscribe a una pareja, o la da de baja, uno de sus dos socios o un gestor. Para todo eso hay que identificarse: sin `X-Socio`, `401 NO_IDENTIFICADO`, y con un socio sin permiso, `403 SIN_PERMISO`. Consultar torneos no necesita identificarse.
- **Estados:** `inscripcion` al crearlo, `en_juego` al cerrar la inscripción, `terminado` al apuntar el resultado de la final y `cancelado` si se cancela (también en juego). Un torneo terminado o cancelado ya no se cancela.
- **Franjas bloqueadas:** al crearlo, el torneo bloquea cada una de sus franjas en cada una de sus pistas, que tienen que estar abiertas y sin reservas confirmadas ni otro torneo. Mientras el torneo no esté cancelado, esas franjas salen en la disponibilidad con `estado: "torneo"` y su `torneoId`, y no se pueden reservar (`FRANJA_NO_DISPONIBLE`). Al cerrar la inscripción, las combinaciones de franja y pista que no le tocan a ningún partido quedan libres, y al cancelarlo, todas.
- **Inscripción:** cada pareja son dos socios distintos con la cuota al día, que no estén ya en otra inscripción `inscrita` del mismo torneo. Caben tantas parejas `inscrita` como `plazas` (de 4 a 16). La inscripción anota la cuota del torneo en `importe`, pero no se cobra nada. Una baja deja la inscripción en el torneo, en estado `baja`, libera su plaza y sus socios se pueden volver a inscribir.
- **Plazo de inscripción:** inscribirse y darse de baja solo se puede con el torneo en `inscripcion` y mientras falten 48 horas o más para su primera franja (horas reales de Madrid, contando el cambio de hora). A 48 horas justas todavía se puede. El gestor puede cerrar la inscripción antes, en cuanto haya 2 parejas inscritas.
- **Cuadro:** al cerrar, juegan las inscripciones `inscrita`, numeradas por su orden de inscripción (la primera es la 1). El cuadro tiene T plazas, la menor potencia de 2 que llega al número de parejas. La primera ronda tiene T/2 partidos, y el partido i lo juegan la pareja i y la T+1−i, en ese orden. Si la pareja T+1−i no existe, el partido es un descanso: la pareja i pasa sin jugar. Cada ronda siguiente tiene la mitad de partidos, hasta la final: si la anterior tiene M, el partido j lo juegan la ganadora del partido j y la del M+1−j. Al cerrar se crean todos los partidos de todas las rondas, con `null` en las parejas que aún no se saben, y las parejas de los descansos ya ocupan su sitio en la segunda ronda. Por ejemplo, con 5 parejas, T es 8: la primera ronda es 1, 2 y 3 contra nadie y 4 contra 5, y la segunda, 1 contra la ganadora de 4 y 5, y 2 contra 3.
- **Calendario:** al cerrar, cada partido que no es un descanso recibe una franja del torneo que no haya empezado y una de sus pistas. Se asignan por orden de ronda y, dentro de cada ronda, por número: a cada partido le toca la primera combinación libre (la franja más temprana y, en la misma franja, la pista que va antes en `pistas`) cuya franja empiece a la hora en que terminan, o después, los partidos de la ronda anterior de los que salen sus parejas. Los descansos no cuentan. Si no hay combinaciones para todos los partidos, el torneo se queda en inscripción (`FRANJAS_INSUFICIENTES`).
- **Resultados:** un gestor apunta qué pareja gana cada partido, con un marcador opcional en texto libre, desde que el partido empieza y con el torneo en juego. La ganadora pasa a su sitio en el partido de la ronda siguiente. Un resultado se puede corregir, y con él la pareja que pasó de ronda, mientras el partido siguiente no se haya jugado (`RESULTADO_CERRADO`). El resultado de la final termina el torneo y su ganadora es la `campeona`. Con 2 parejas, el único partido es la final. Con el torneo terminado ya no se apunta ni se corrige ningún resultado, tampoco el de la final.
- Los partidos no son reservas: no salen en `GET /api/reservas` ni cuentan para el límite de 3 reservas futuras.

## API

### Pistas

- `GET /api/pistas`: todas las pistas. Responde `{ pistas: Pista[] }`.
- `PATCH /api/pistas/:id` con `{ estado: "operativa" | "cerrada" }`: abre o cierra una pista. Responde `{ pista }`.

### Disponibilidad

- `GET /api/disponibilidad?fecha=AAAA-MM-DD[&pista=<id>]`: las franjas de ese día por pista, cada una con `inicio`, `fin`, `estado` (`libre`, `reservada`, `cerrada` o `torneo`) y `precio`. Las que bloquea un torneo salen con `estado: "torneo"` y traen además el `torneoId`.

### Socios

- `GET /api/socios?texto=<texto>`: busca socios por nombre (sin tener en cuenta acentos), email o id. Hasta 20 resultados.

### Reservas

- `GET /api/reservas`: lista reservas con filtros opcionales `fecha`, `desde`, `hasta` (por día de inicio, ambos incluidos), `socio`, `pista` y `estado` (`confirmada`, `cancelada` o `no_presentada`), paginada con `limite` (1 a 100, 50 por defecto) y `pagina`. Responde `{ total, pagina, paginas, reservas }`.
- `GET /api/reservas/:id`: una reserva. Responde `{ reserva }`.
- `POST /api/reservas` con `{ socioId, pistaId, inicio, notas? }`: crea una reserva. Responde `201 { reserva }`. Errores: `SOCIO_NO_ENCONTRADO`, `PISTA_NO_ENCONTRADA`, `FRANJA_INVALIDA`, `CUOTA_INACTIVA`, `PISTA_CERRADA`, `FRANJA_PASADA`, `FRANJA_NO_DISPONIBLE` (la franja está reservada o la bloquea un torneo) y `LIMITE_DE_RESERVAS`.
- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo? }`: cancela una reserva. Responde `{ reserva }`. Errores: `RESERVA_NO_ENCONTRADA`, `YA_CANCELADA`, `RESERVA_PASADA` y `FUERA_DE_PLAZO`.

Una reserva tiene `id`, `socioId`, `pistaId`, `inicio`, `fin`, `estado`, `importe`, `notas` y, si se canceló, `penalizacion` y `motivoCancelacion`.

### Torneos

Si el torneo no existe, todos estos endpoints responden `404 TORNEO_NO_ENCONTRADO`. Los que necesitan `X-Socio` responden `401 NO_IDENTIFICADO` sin ella y `403 SIN_PERMISO` si quien llama no tiene permiso.

- `POST /api/torneos` con `{ nombre, pistas, franjas, plazas, cuota }` (solo gestores): crea un torneo en `inscripcion`, sin inscripciones ni partidos. `pistas` son los ids de las pistas que usa, y `franjas`, los inicios de las franjas que usa en todas ellas. `plazas` es el número máximo de parejas (de 4 a 16) y `cuota`, lo que paga cada pareja, en céntimos (0 o más). Responde `201 { torneo }`. Errores: `DATOS_INVALIDOS` (400: `nombre` vacío, `pistas` o `franjas` vacías o con repetidos, `plazas` o `cuota` fuera de rango o no enteras), `PISTA_NO_ENCONTRADA` (404), `FRANJA_INVALIDA` (400), `FRANJA_PASADA`, `PISTA_CERRADA` y `FRANJAS_OCUPADAS` (409). `FRANJAS_OCUPADAS` trae en el error `conflictos`: cada choque con su `pistaId`, su `inicio` y el `reservaId` de la reserva confirmada o el `torneoId` del torneo que bloquea esa franja, por orden de franja y de pista. Si falla, no se crea nada.
- `GET /api/torneos[?estado=<estado>]`: todos los torneos, también los cancelados, por orden de su primera franja. Cada uno trae `id`, `nombre`, `estado`, `plazas`, `cuota` e `inscritas` (cuántas inscripciones están `inscrita`). Con `estado` (`inscripcion`, `en_juego`, `terminado` o `cancelado`), solo los de ese estado. Responde `{ torneos }`. Errores: `DATOS_INVALIDOS` (400: el estado no existe).
- `GET /api/torneos/:id`: un torneo, con sus inscripciones y sus partidos. Responde `{ torneo }`.
- `POST /api/torneos/:id/inscripciones` con `{ socios: [id, id] }` (uno de los dos socios o un gestor): inscribe a una pareja al final de las inscripciones. Responde `201 { inscripcion }`. Errores: `DATOS_INVALIDOS` (400: `socios` no son dos ids distintos), `SOCIO_NO_ENCONTRADO` (404), `INSCRIPCION_CERRADA`, `CUOTA_INACTIVA`, `YA_INSCRITO` y `TORNEO_COMPLETO` (409).
- `POST /api/torneos/:id/inscripciones/:inscripcionId/baja` (uno de los dos socios o un gestor): da de baja a una pareja. Responde `{ inscripcion }`. Errores: `INSCRIPCION_NO_ENCONTRADA` (404: no existe en ese torneo), `YA_DE_BAJA` e `INSCRIPCION_CERRADA` (409).
- `POST /api/torneos/:id/cerrar` (solo gestores): cierra la inscripción, genera el cuadro y el calendario y pasa el torneo a `en_juego`. Se puede cerrar antes de que acabe el plazo de inscripción. Responde `{ torneo }`. Errores: `TORNEO_NO_EN_INSCRIPCION`, `PAREJAS_INSUFICIENTES` (menos de 2 inscritas) y `FRANJAS_INSUFICIENTES` (409; en los tres, el torneo se queda como estaba).
- `POST /api/torneos/:id/partidos/:partidoId/resultado` con `{ ganadora, marcador? }` (solo gestores): apunta, o corrige, el resultado de un partido. `ganadora` es el id de la inscripción que gana y `marcador`, un texto libre (por ejemplo, `"6-4 6-3"`), o `null` si no se da. Responde `{ partido }`. Errores: `TORNEO_NO_EN_JUEGO` (409), `PARTIDO_NO_ENCONTRADO` (404: no existe en ese torneo), `PARTIDO_NO_LISTO` (409: es un descanso o todavía no se saben sus dos parejas), `DATOS_INVALIDOS` (400: `ganadora` no es una de las dos parejas del partido o `marcador` no es un texto), `PARTIDO_NO_EMPEZADO` y `RESULTADO_CERRADO` (409: el partido de la ronda siguiente ya se jugó).
- `POST /api/torneos/:id/cancelar` (solo gestores): cancela el torneo, también si está en juego, y libera todas sus franjas. Responde `{ torneo }`. Errores: `TORNEO_TERMINADO` y `YA_CANCELADO` (409).

Un torneo tiene `id`, `nombre`, `pistas`, `franjas` (en orden cronológico), `plazas`, `cuota`, `estado` (`inscripcion`, `en_juego`, `terminado` o `cancelado`), `inscripciones` (por orden de inscripción), `partidos` (por ronda y número) y `campeona` (el id de la inscripción que gana el torneo, o `null`).

Una inscripción tiene `id`, `socios` (los dos ids), `estado` (`inscrita` o `baja`) e `importe` (la cuota del torneo).

Un partido tiene `id`, `ronda` (la primera es la 1), `numero` (su orden dentro de la ronda, desde 1), `parejas` (los ids de las dos inscripciones que lo juegan, con `null` mientras no se sepa cuál es), `estado` (`pendiente`, `jugado` o `descanso`), `ganadora`, `marcador`, `pistaId` e `inicio`. Mientras no tienen valor, `ganadora`, `marcador`, `pistaId` e `inicio` son `null`. Los descansos no tienen ni pista ni hora, y su `ganadora` es la pareja que pasa sin jugar.

### Solo para pruebas

- `GET /_estado`: el estado completo del club.
- `POST /_reloj` con `{ ahora: "AAAA-MM-DDTHH:MM" }`: mueve la hora del club.
