# Spec: penalizaciones escalonadas e informe de caja

- **id:** `reembolsos`
- **Estado:** pendiente de implementar

## Objetivo

Hoy cancelar es gratis hasta 24 horas antes y, después, se pierde el 100 %. A los socios les parece injusto y la recepción acaba perdonando penalizaciones a mano, sin dejar rastro. La nueva política escalona la penalización, deja que un gestor exima con un motivo y da a la recepción un informe de caja del mes con lo cobrado por reservas y por penalizaciones.

## No-objetivos

- No cambiar cómo se crean las reservas ni sus precios.
- No recalcular las reservas que ya estaban canceladas: conservan su penalización.
- No mover dinero: el reembolso es un dato informativo para la recepción.
- No añadir dependencias nuevas.

## Usuarios y permisos

- Cualquiera puede cancelar como hasta ahora, con la política nueva.
- Solo un gestor (cabecera `X-Socio` de un socio con rol `gestor`) puede eximir de la penalización y consultar el informe de caja.

## Política de cancelación

| Antelación | Penalización |
|---|---|
| 48 horas o más | ninguna |
| 24 horas o más, y menos de 48 | 25 % del importe |
| menos de 24 horas | 50 % del importe, y solo con `forzar: true` |

Las horas son reales en Madrid (Europe/Madrid), contando el cambio de hora. Por ejemplo, del viernes 26 de marzo de 2027 a las 20:30 al domingo 28 a las 21:00 hay 47,5 horas, no 48,5, porque esa madrugada los relojes se adelantan una hora.

## API

- `POST /api/reservas/:id/cancelar` con `{ forzar?, motivo?, exento? }` responde `{ reserva, reembolso }`. `reembolso` es lo que se devuelve al socio: `importe - penalizacion`, en céntimos.
- `GET /api/informes/caja?mes=AAAA-MM`: el informe de caja del mes, por fecha de inicio de las reservas.

## Criterios de aceptación

1. **Tramos.** Con 48 horas o más de antelación no hay penalización. Con 24 horas o más, y menos de 48, la penalización es el 25 % del importe. Con menos de 24 horas solo se cancela con `forzar: true` (sin él, `409 FUERA_DE_PLAZO`) y la penalización es el 50 %.
2. **Límites exactos.** A 48 horas justas no hay penalización. A 24 horas justas se aplica el 25 % y no hace falta `forzar`.
3. **Cambio de hora.** La antelación se cuenta en horas reales de Madrid, con el cambio de hora, como en el ejemplo de la política.
4. **Reembolso.** La respuesta de cancelar incluye `reembolso`, igual a `importe - penalizacion` (o al importe entero si no hay penalización).
5. **Exención.** Un gestor puede cancelar sin penalización en cualquier momento antes del inicio con `exento: true` y un `motivo` de al menos 10 caracteres, sin necesidad de `forzar`. El motivo se guarda en `motivoCancelacion`. Si falta el motivo o es más corto, `400 DATOS_INVALIDOS`. Si quien lo pide no es gestor, `403 SIN_PERMISO`, y si no se sabe quién es, `401 NO_IDENTIFICADO`.
6. **Reservas pasadas.** Una reserva que ya ha empezado no se cancela (`409 RESERVA_PASADA`), tampoco con `exento`.
7. **Informe de caja.** `GET /api/informes/caja?mes=AAAA-MM` es solo para gestores (`401 NO_IDENTIFICADO` sin `X-Socio`, `403 SIN_PERMISO` si no es gestor). Responde `{ mes, pistas, total }`. `pistas` tiene una entrada por cada pista del club, también las que no tienen movimientos, ordenadas por id, con `pistaId`, `reservas` (cuántas reservas confirmadas o no presentadas empiezan ese mes), `ingresos` (la suma de sus importes), `penalizaciones` (la suma de las penalizaciones de las reservas canceladas que empiezan ese mes) y `total` (ingresos más penalizaciones). `total` tiene los mismos cuatro campos para todo el club. Con un `mes` que no tiene el formato `AAAA-MM`, `400 DATOS_INVALIDOS`.
8. **Lo demás no cambia.** Crear reservas funciona igual, y las reservas que ya estaban canceladas conservan su penalización.
9. **Documentación.** El `README.md` explica la política nueva en las reglas del club y documenta los cambios de la API: `exento`, `reembolso`, el informe de caja y sus errores.

## Plan de verificación

- Tests de la API para cada tramo y sus límites, el cambio de hora (con `POST /_reloj`), la exención y el informe de caja.
- Actualizar los tests que comprueban la política anterior.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (cancelación) y referencia de la API.
