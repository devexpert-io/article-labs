# Spec: partidos abiertos

- **id:** `partidos-abiertos`
- **Estado:** pendiente de implementar

## Objetivo

Muchos socios no tienen con quién jugar y lo buscan por grupos de mensajería. Con los partidos abiertos, un socio reserva una pista y deja las otras tres plazas abiertas para que se apunten otros socios, si quiere, solo de un rango de nivel. Cada jugador paga su parte, y si el partido no se llena a tiempo se cancela solo y la pista queda libre.

## No-objetivos

- No cambiar cómo se reservan y se cancelan las reservas normales, salvo que el límite de 3 reservas futuras cuenta también los partidos en los que se juega.
- No cobrar: el importe por jugador y las penalizaciones solo se anotan.
- No hacer partidos de un número de jugadores distinto de 4.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Fijar el nivel de un socio: el propio socio o un gestor.
- Crear un partido, unirse y salir: el socio que lo hace, identificado con `X-Socio`.
- Cancelar un partido: quien lo organiza o un gestor.
- Consultar partidos: cualquiera, sin identificarse.
- Sin `X-Socio` donde hace falta, `401 NO_IDENTIFICADO`. Con un socio que no tiene permiso, `403 SIN_PERMISO`.

## API

- `PATCH /api/socios/:id` con `{ nivel }`: fija el nivel de juego de un socio, o lo quita con `null`. Responde `{ socio }`.
- `POST /api/partidos` con `{ pistaId, inicio, nivelMin?, nivelMax? }`: crea un partido abierto organizado por quien llama. Responde `201 { partido }`.
- `GET /api/partidos[?fecha=AAAA-MM-DD][&nivel=<nivel>]`: los partidos con plazas libres. Responde `{ partidos }`.
- `GET /api/partidos/:id`: un partido. Responde `{ partido }`.
- `POST /api/partidos/:id/unirse`: quien llama se une al partido. Responde `{ partido }`.
- `POST /api/partidos/:id/salir` con `{ forzar? }`: quien llama sale del partido. Responde `{ partido }`.
- `POST /api/partidos/:id/cancelar` con `{ forzar? }`: cancela el partido. Responde `{ partido }`.

Los socios tienen `nivel`: un número entre 1 y 7 en pasos de 0,5 (por ejemplo, 3 o 4,5), o `null` si no lo han fijado. En la semilla, todos empiezan con `null`.

Un partido tiene `id`, `reservaId`, `pistaId`, `inicio`, `fin`, `organizador` (el id del socio), `jugadores` (los ids de los socios que juegan, empezando por el organizador y por orden de llegada), `plazasLibres`, `nivelMin` y `nivelMax` (o `null` los dos), `estado` (`abierto`, `completo` o `cancelado`), `importe` (el de la reserva), `importePorJugador`, `penalizaciones` (cada una con `socioId` e `importe`) y, si se cancela, `motivo` (`organizador` o `incompleto`).

## Criterios de aceptación

1. **Permisos.** Crear un partido, unirse y salir necesitan `X-Socio` (si no, `401 NO_IDENTIFICADO`). Cancelar un partido lo puede hacer quien lo organiza o un gestor, y fijar el nivel de un socio, el propio socio o un gestor (si no, `403 SIN_PERMISO`). Consultar no necesita identificarse.
2. **Nivel de los socios.** `PATCH /api/socios/:id` fija `nivel`, un número entre 1 y 7 en pasos de 0,5, o lo quita con `null` (si no, `400 DATOS_INVALIDOS`), y responde con el socio. Si el socio no existe, `404 SOCIO_NO_ENCONTRADO`. Los socios traen su `nivel` también en `GET /api/socios`.
3. **Crear: las reglas de siempre.** Crear un partido reserva la pista con las mismas comprobaciones y los mismos errores que `POST /api/reservas` hace para el organizador: la pista, la franja, la cuota al día, la pista cerrada, la franja pasada u ocupada y el límite de reservas futuras.
4. **Crear: rango de nivel.** `nivelMin` y `nivelMax` van los dos o ninguno, con niveles válidos y con `nivelMin` menor o igual que `nivelMax` (si no, `400 DATOS_INVALIDOS`). Con rango, el organizador tiene que tener nivel (`409 NIVEL_SIN_DEFINIR`) y estar dentro del rango (`409 NIVEL_FUERA_DE_RANGO`).
5. **La reserva del partido.** El partido crea una reserva confirmada a nombre del organizador, con el importe de siempre y con `partidoId`, que sale en `GET /api/reservas`, y su franja sale `reservada` en la disponibilidad. El `reservaId` del partido es el de esa reserva.
6. **Respuesta y consulta.** `POST /api/partidos` responde `201` con el partido `abierto`, con el organizador como único jugador, 3 plazas libres y sin penalizaciones. `GET /api/partidos/:id` devuelve el partido. Si no existe, `404 PARTIDO_NO_ENCONTRADO`, en este endpoint y al unirse, salir y cancelar.
7. **Precio por jugador.** `importePorJugador` es la cuarta parte del importe de la reserva, redondeada al céntimo hacia arriba.
8. **Unirse.** `POST /api/partidos/:id/unirse` añade a quien llama al final de `jugadores` y le quita una plaza libre al partido. Con el cuarto jugador, el partido pasa a `completo`.
9. **Quién se puede unir.** No se puede unir nadie a un partido completo (`409 PARTIDO_COMPLETO`) o cancelado (`409 PARTIDO_CANCELADO`), ni quien ya juega en él (`409 YA_APUNTADO`) o no tiene la cuota al día (`409 CUOTA_INACTIVA`).
10. **Nivel al unirse.** En un partido con rango, quien se une tiene que tener nivel (`409 NIVEL_SIN_DEFINIR`) y estar dentro del rango, con los extremos incluidos (`409 NIVEL_FUERA_DE_RANGO`). En un partido sin rango se puede unir cualquiera, tenga nivel o no.
11. **El límite de 3 cuenta los partidos.** Para el límite de 3 reservas futuras de un socio cuentan sus reservas confirmadas que no han empezado, como hasta ahora, y además los partidos abiertos o completos que no han empezado en los que juega sin ser el organizador. Unirse a un partido cuando ya se tienen 3 responde `409 LIMITE_DE_RESERVAS`, y reservar o crear un partido, también.
12. **Salir.** `POST /api/partidos/:id/salir` quita a quien llama de `jugadores` y deja libre su plaza. Si el partido estaba completo, vuelve a `abierto`. Si quien llama no juega en el partido, `409 NO_APUNTADO`. De un partido cancelado o que ya ha empezado no se puede salir (`409 PARTIDO_CANCELADO` y `409 FRANJA_PASADA`).
13. **Salir tarde.** Si faltan menos de 24 horas para el partido, salir solo se puede con `forzar: true` (si no, `409 FUERA_DE_PLAZO`), y quien sale paga su parte: se añade a `penalizaciones` con su `socioId` y el `importePorJugador`.
14. **El organizador no sale.** El organizador no puede salir de su partido (`409 ORGANIZADOR_NO_PUEDE_SALIR`): para dejarlo, lo cancela.
15. **Cancelar.** `POST /api/partidos/:id/cancelar` deja el partido `cancelado` con `motivo: "organizador"` y cancela su reserva, así que la franja queda libre. Si faltan menos de 24 horas, solo se puede con `forzar: true` (si no, `409 FUERA_DE_PLAZO`), y la reserva lleva la penalización de siempre, el 100 % del importe. Un partido cancelado o que ya ha empezado no se puede cancelar (`409 PARTIDO_CANCELADO` y `409 FRANJA_PASADA`).
16. **Se cancela solo.** Un partido que no está completo cuando faltan 6 horas o menos para que empiece se cancela solo, sin penalización para nadie: desde ese momento sale `cancelado` con `motivo: "incompleto"`, su reserva sale cancelada y su franja, libre. Pasa lo mismo si deja de estar completo cuando ya faltan 6 horas o menos. Por eso, un partido solo se puede crear si faltan más de 6 horas para su franja (si no, `409 DEMASIADO_TARDE`). La hora del club se mueve con `POST /_reloj`.
17. **La reserva va con su partido.** La reserva de un partido no se cancela con `POST /api/reservas/:id/cancelar` (`409 ES_UN_PARTIDO`): se cancela con el partido.
18. **Partidos con plazas.** `GET /api/partidos` devuelve los partidos `abierto` que no han empezado, por orden de `inicio`. Los completos y los cancelados no salen.
19. **Filtros.** Con `fecha`, solo salen los de ese día, y con `nivel`, solo los que admiten ese nivel: los que no tienen rango y los que tienen un rango que lo incluye. Con una fecha o un nivel que no valen, `400 DATOS_INVALIDOS`.
20. **Lo demás no cambia.** Reservar y cancelar reservas normales funciona igual que antes, con la única diferencia del límite de 3 (criterio 11).
21. **Documentación.** El `README.md` documenta los partidos abiertos: el nivel de los socios, los endpoints, cómo se reparte el importe, la salida y la cancelación, la cancelación automática y los errores nuevos.

## Plan de verificación

- Tests de la API para cada criterio, moviendo la hora del club con `POST /_reloj` para los plazos y la cancelación automática.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (partidos abiertos) y referencia de la API.
