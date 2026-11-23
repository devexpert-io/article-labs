# Spec: reservas fijas semanales

- **id:** `reservas-fijas`
- **Estado:** pendiente de implementar

## Objetivo

Muchos grupos juegan siempre el mismo día a la misma hora, y la recepción les hace las reservas una a una cada semana. Con las reservas fijas, la recepción crea de una vez una serie semanal para un socio, con descuento si es larga, y la puede cancelar entera cuando el grupo lo deja.

## No-objetivos

- No cambiar cómo reservan y cancelan los socios sus reservas normales.
- No permitir que un socio cree series por su cuenta: las crea la recepción.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Solo un gestor (cabecera `X-Socio` de un socio con rol `gestor`) puede crear, consultar y cancelar series. Sin `X-Socio`, `401 NO_IDENTIFICADO`. Con un socio que no es gestor, `403 SIN_PERMISO`.

## API

- `POST /api/series` con `{ socioId, pistaId, inicio, semanas }`: crea la serie. `inicio` es la primera reserva y `semanas` cuántas semanas seguidas, contando la primera. Responde `201 { serie }`.
- `GET /api/series/:id`: la serie. Responde `{ serie }`.
- `POST /api/series/:id/cancelar` con `{ forzar? }`: cancela la serie. Responde `{ serie, canceladas, pendientes }`.

Una serie tiene `id`, `socioId`, `pistaId`, `inicio`, `semanas`, `reservas` (los ids de las reservas que se crearon, por orden de fecha) y `saltadas` (las semanas que no se pudieron reservar, cada una con `inicio` y `codigo`). En `GET /api/series/:id`, `reservas` trae las reservas completas en lugar de los ids. Cada reserva de una serie lleva `serieId`.

## Criterios de aceptación

1. **Permisos.** Solo un gestor crea, consulta y cancela series: sin `X-Socio`, `401 NO_IDENTIFICADO`, y con un socio que no es gestor, `403 SIN_PERMISO`.
2. **Datos.** `semanas` es un entero entre 2 y 12 (si no, `400 DATOS_INVALIDOS`). El socio y la pista tienen que existir (`404 SOCIO_NO_ENCONTRADO`, `404 PISTA_NO_ENCONTRADA`), e `inicio` tiene que ser una franja válida (`400 FRANJA_INVALIDA`) que no haya empezado (`409 FRANJA_PASADA`).
3. **Una reserva por semana.** La serie crea una reserva confirmada cada 7 días, en la misma pista y a la misma hora local que `inicio`, también cuando entre medias cambia la hora. Por ejemplo, una serie que empieza el martes 23 de marzo de 2027 a las 19:30 tiene la segunda reserva el martes 30 de marzo a las 19:30.
4. **Semanas ocupadas.** Si una semana la franja ya está reservada, esa semana se salta y queda en `saltadas` con su `inicio` y el código `FRANJA_NO_DISPONIBLE`. Las demás se reservan. Si no se puede reservar ninguna, `409 SERIE_VACIA` y no se crea nada.
5. **Comprobaciones de toda la serie.** Si el socio no tiene la cuota al día (`409 CUOTA_INACTIVA`) o la pista está cerrada (`409 PISTA_CERRADA`), no se crea nada.
6. **Fuera del límite de 3.** Las reservas de una serie no cuentan para el límite de 3 reservas futuras: la serie se crea aunque el socio ya tenga 3 reservas futuras, y las reservas de la serie no le impiden hacer reservas normales.
7. **Descuento.** En una serie de 8 semanas o más, cada reserva cuesta un 10 % menos que su precio normal, redondeado al céntimo hacia abajo. Con menos de 8 semanas, cada reserva cuesta su precio normal.
8. **Respuesta.** `POST /api/series` responde `201` con la serie, sus `reservas` y sus `saltadas`, y cada reserva creada lleva `serieId`.
9. **Consultar.** `GET /api/series/:id` devuelve la serie con sus reservas completas, por orden de fecha. Si no existe, `404 SERIE_NO_ENCONTRADA`.
10. **Cancelar la serie.** `POST /api/series/:id/cancelar` cancela, sin penalización, las reservas confirmadas de la serie a las que les faltan 24 horas o más, y las devuelve en `canceladas`. Las que empiezan en menos de 24 horas siguen confirmadas y se devuelven en `pendientes`, salvo con `forzar: true`, que las cancela con la penalización de siempre (el 100 % del importe). Las que ya han empezado, las canceladas y las no presentadas no se tocan.
11. **Reservas sueltas.** Una reserva de una serie se puede cancelar sola por `POST /api/reservas/:id/cancelar`, con las reglas de siempre, y la serie sigue con las demás.
12. **Lo demás no cambia.** Reservar y cancelar reservas normales funciona igual que antes, incluido el límite de 3 reservas futuras, que solo cuenta las reservas normales.
13. **Documentación.** El `README.md` documenta las series: quién las crea, los endpoints, el descuento, las semanas saltadas, la cancelación y los errores nuevos.

## Plan de verificación

- Tests de la API para cada criterio, incluido el cambio de hora (con `POST /_reloj`).
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (reservas fijas) y referencia de la API.
