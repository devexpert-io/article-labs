# Spec: reservas de 60, 90 o 120 minutos

- **id:** `duraciones`
- **Estado:** pendiente de implementar

## Objetivo

Hoy todas las reservas duran 90 minutos y empiezan a horas fijas. Muchos socios quieren jugar una hora a mediodía o dos horas por la tarde, y la recepción acaba apuntando a mano reservas que no caben en el sistema. Esta feature permite reservas de 60, 90 o 120 minutos que empiezan en punto o y media, sin romper nada de lo que ya existe: las reservas de 90 minutos de siempre siguen funcionando y costando lo mismo.

## No-objetivos

- No cambiar las reglas de cancelación ni las penalizaciones.
- No cambiar el horario del club: abre a las 09:00 y la última reserva tiene que terminar como muy tarde a las 22:30.
- No migrar ni modificar las reservas que ya existen.
- No añadir dependencias nuevas.

## Usuarios y permisos

- No cambia quién puede reservar ni cancelar.

## API

- `POST /api/reservas` acepta un campo nuevo y opcional, `duracion`, en minutos: `60`, `90` o `120`. Si no viene, son 90.
- Todas las reservas, también las que ya existían, devuelven `duracion` en minutos.
- `GET /api/disponibilidad` sigue devolviendo las mismas `franjas` de 90 minutos y añade, en cada pista, `huecos`: los intervalos libres del día, cada uno con `inicio` y `fin`.

## Precio

El precio se calcula por minutos. Cada minuto vale el precio de la franja de 90 minutos de esa pista dividido entre 90. Los minutos de lunes a viernes antes de las 18:00 van a precio de valle. Los de las 18:00 en adelante, y todos los del sábado y el domingo, a precio de punta. El total se redondea al céntimo más cercano, y medio céntimo se redondea hacia arriba.

Por ejemplo, en la pista 1 (valle 1800, punta 2800), un martes de 17:30 a 19:00 son 30 minutos de valle y 60 de punta: 30 × 1800 / 90 + 60 × 2800 / 90 = 600 + 1866,67 = 2466,67, que se redondea a 2467 céntimos.

## Criterios de aceptación

1. **Duración.** `duracion` es opcional y vale `60`, `90` o `120`, con 90 por defecto. Cualquier otro valor responde `400 DURACION_INVALIDA`.
2. **Inicios válidos.** Una reserva empieza en punto o y media (`HH:00` o `HH:30`), no antes de las 09:00, y termina como muy tarde a las 22:30. Si no, `400 FRANJA_INVALIDA`.
3. **Fin.** `fin` es `inicio` más la duración.
4. **Sin solapes.** Una reserva no puede solaparse con ninguna reserva confirmada de la misma pista, tampoco con las de 90 minutos que ya existían. Que una termine justo cuando empieza otra no es solaparse. Las reservas canceladas no ocupan la pista. Si se solapa, `409 FRANJA_NO_DISPONIBLE`.
5. **Precio por minutos.** El importe sigue la regla de precio de arriba, con su redondeo, también cuando la reserva cruza las 18:00 y en fin de semana.
6. **Lo de siempre cuesta lo mismo.** Una reserva de 90 minutos que empieza a una de las horas de siempre (09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30 o 21:00) cuesta exactamente lo mismo que antes.
7. **Duración en todas las reservas.** Todas las reservas devuelven `duracion`, también las que ya existían, que son de 90 minutos.
8. **Franjas ocupadas.** En `GET /api/disponibilidad`, una franja de 90 minutos está `reservada` si cualquier reserva confirmada de esa pista se solapa con ella, aunque sea en parte.
9. **Huecos.** En `GET /api/disponibilidad`, cada pista trae `huecos`: los intervalos libres más largos posibles entre las 09:00 y las 22:30 de ese día, sin solaparse con ninguna reserva confirmada, ordenados por hora y sin tener en cuenta la hora actual. Una pista cerrada no tiene huecos.
10. **Las reglas del club siguen.** Para reservar hace falta la cuota al día, la pista no puede estar cerrada, la reserva no puede haber empezado y cada socio puede tener como mucho 3 reservas futuras, sea cual sea su duración.
11. **Cancelar no cambia.** La cancelación es gratis hasta 24 horas antes del inicio y después solo con `forzar`, con una penalización del 100 % del importe de la reserva, sea cual sea su duración.
12. **Documentación.** El `README.md` explica las duraciones, los inicios válidos, la regla de precio, el campo `huecos` y el error nuevo.

## Plan de verificación

- Tests de la API para cada criterio: duraciones válidas e inválidas, inicios, solapes con reservas nuevas y antiguas, precios que cruzan las 18:00 y de fin de semana, disponibilidad y huecos.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: convenciones (franjas y precios), reglas del club y referencia de reservas y disponibilidad.
