# Spec: lista de espera de franjas

- **id:** `lista-espera`
- **Estado:** pendiente de implementar

## Objetivo

Las franjas de punta se llenan pronto y, cuando alguien cancela, la pista suele quedarse vacía porque nadie se entera. Con la lista de espera, un socio se apunta a una franja ocupada y, si se cancela la reserva, el club se la asigna automáticamente al primero de la lista que puede jugar.

## No-objetivos

- No avisar a nadie por email ni por otro canal: basta con que la reserva aparezca a su nombre.
- No cambiar las reglas de reservar ni de cancelar, ni sus penalizaciones.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Cada socio gestiona sus propias esperas: se identifica con la cabecera `X-Socio`. Sin ella, `401 NO_IDENTIFICADO`.
- Un gestor puede consultar y retirar las esperas de cualquier socio. Si un socio intenta retirar una espera de otro, `403 SIN_PERMISO`.

## API

Una espera tiene `id`, `socioId`, `pistaId`, `inicio`, `estado` (`activa`, `retirada`, `asignada` o `descartada`) y, mientras está activa, `posicion`.

- `POST /api/esperas` con `{ pistaId, inicio }`: apunta a quien llama a la lista de esa franja. Responde `201 { espera }`.
- `GET /api/esperas[?socio=<id>]`: las esperas activas de quien llama, con su posición actual. Un gestor puede pedir las de otro socio con `socio`.
- `DELETE /api/esperas/:id`: retira la espera. Responde `200 { espera }` con estado `retirada`.
- `POST /api/reservas/:id/cancelar` responde además `asignadaA`: el id de la reserva creada desde la lista de espera, o `null` si no se asignó a nadie.

## Criterios de aceptación

1. **Apuntarse.** `POST /api/esperas` con `X-Socio` y `{ pistaId, inicio }` responde `201` con la espera activa y su posición. Sin `X-Socio`, `401 NO_IDENTIFICADO`.
2. **Solo franjas que se pueden esperar.** Si la franja está libre, `409 FRANJA_LIBRE`, porque se puede reservar directamente. Valen las mismas comprobaciones que al reservar: la pista existe (`404 PISTA_NO_ENCONTRADA`) y está operativa (`409 PISTA_CERRADA`), la franja es válida (`400 FRANJA_INVALIDA`) y no ha empezado (`409 FRANJA_PASADA`), y el socio tiene la cuota al día (`409 CUOTA_INACTIVA`).
3. **Sin duplicados y con límite.** Un socio no puede estar dos veces en la lista de la misma franja (`409 YA_EN_ESPERA`) ni esperar una franja que ya tiene reservada él (`409 YA_RESERVADA`). Cada socio puede tener como mucho 2 esperas activas (`409 LIMITE_DE_ESPERAS`).
4. **Posición.** La posición es el orden de llegada entre las esperas activas de esa franja, empezando por 1. `GET /api/esperas` devuelve las esperas activas de quien llama con su posición actual, y un gestor puede pedir las de otro socio con `?socio=<id>`.
5. **Retirarse.** `DELETE /api/esperas/:id` deja la espera en `retirada`, y los que estaban detrás suben un puesto. Solo puede hacerlo su dueño o un gestor (`403 SIN_PERMISO`). Si la espera no existe, `404 ESPERA_NO_ENCONTRADA`.
6. **Asignación automática.** Cuando se cancela una reserva confirmada, con o sin `forzar`, la franja se asigna al primero de la lista: se crea una reserva confirmada a su nombre, con el precio de la franja y la nota `Asignada desde la lista de espera`, y su espera pasa a `asignada`. La respuesta de cancelar incluye `asignadaA` con el id de esa reserva, o `null` si no había nadie.
7. **Saltar a quien ya no puede.** Si al primero de la lista no le dejarían reservar (no tiene la cuota al día o ya tiene 3 reservas futuras), su espera pasa a `descartada` y se prueba con el siguiente.
8. **Caducidad.** Cuando una franja empieza, sus esperas activas caducan: no aparecen en `GET /api/esperas`, no se asignan y no cuentan para el límite de 2.
9. **Lo demás no cambia.** Reservar y cancelar siguen con sus reglas y sus penalizaciones. Cancelar una franja sin lista de espera responde como antes, más `asignadaA: null`.
10. **Documentación.** El `README.md` documenta la lista de espera: sus reglas, los endpoints, el campo `asignadaA` y los errores nuevos.

## Plan de verificación

- Tests de la API para cada criterio: apuntarse, errores, posiciones, retirarse, asignación, salto y caducidad (con `POST /_reloj`).
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (lista de espera) y referencia de la API.
