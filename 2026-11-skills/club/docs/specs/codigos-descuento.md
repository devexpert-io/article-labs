# Spec: códigos de descuento al reservar

- **id:** `codigos-descuento`
- **Estado:** pendiente de implementar

## Objetivo

El club quiere llenar las mañanas entre semana y dar la bienvenida a los socios nuevos con descuentos. El socio escribe un código al reservar y la reserva guarda cuánto costaba la franja, cuánto se le descuenta y cuánto paga.

## No-objetivos

- No cambiar los precios de las pistas ni lo que muestra la disponibilidad, que sigue enseñando el precio sin descuento.
- No crear ni editar códigos por la API: el catálogo es fijo y vive en el código.
- No aplicar descuentos a reservas que ya existen.

## Usuarios y permisos

- Cualquiera que puede reservar puede usar un código. No cambia quién puede reservar.

## Catálogo de códigos

| Código | Descuento | Condiciones |
|---|---|---|
| `BIENVENIDA` | 50 % | Solo en la primera reserva del socio: no puede tener ninguna reserva anterior, en ningún estado. Se puede usar en reservas hechas hasta el 31 de diciembre de 2026 incluido, según la hora del club. |
| `MANANAS` | 4,00 € | Solo en franjas de lunes a viernes que empiezan antes de las 12:00. Sin caducidad ni límite de usos. |
| `CLUB10` | 10 % | Cualquier franja. Cada socio puede tener como mucho 3 reservas con este código, contando las confirmadas y las no presentadas. Las canceladas no cuentan. |

## API

`POST /api/reservas` acepta un campo nuevo y opcional, `codigo`. Las reservas nuevas guardan tres importes en céntimos y el código usado:

- `importeBase`: el precio de la franja.
- `descuento`: lo que se descuenta.
- `importe`: lo que paga el socio, `importeBase - descuento`, nunca menos de 0.
- `codigo`: el código en mayúsculas, solo si se usó uno.

## Criterios de aceptación

1. **Sin código, todo igual.** Una reserva sin código se crea como antes, con `importeBase` igual a `importe`, `descuento` 0 y sin `codigo`.
2. **BIENVENIDA.** Descuenta el 50 % en la primera reserva del socio. Si el socio ya tiene alguna reserva, en cualquier estado, o la hora del club es posterior al 31 de diciembre de 2026, responde `409 CODIGO_NO_APLICABLE`.
3. **MANANAS.** Descuenta 4,00 € en franjas de lunes a viernes que empiezan antes de las 12:00. En cualquier otra franja responde `409 CODIGO_NO_APLICABLE`.
4. **CLUB10.** Descuenta el 10 %. Si el socio ya tiene 3 reservas con `CLUB10` entre confirmadas y no presentadas, responde `409 CODIGO_NO_APLICABLE`. Las canceladas no cuentan.
5. **Formato del código.** No importan las mayúsculas ni los espacios de alrededor (`"  club10 "` vale). Un código que no está en el catálogo responde `400 CODIGO_INVALIDO`. Si `codigo` no es un texto, responde `400 DATOS_INVALIDOS`.
6. **Un código por reserva.** Los descuentos no se acumulan. Solo se acepta un código por reserva.
7. **Importes guardados.** La reserva guarda `importeBase`, `descuento`, `importe` y `codigo` como se describe arriba. `GET /api/reservas/:id` y `GET /api/reservas` los devuelven.
8. **Las reglas del club van primero.** Si la reserva no se puede hacer (cuota, franja, pista, límite de reservas…), responde ese error, y el código no cuenta como usado.
9. **Penalización.** La penalización por cancelar fuera de plazo es el 100 % de lo que paga el socio, es decir, del importe con descuento.
10. **Disponibilidad sin cambios.** `GET /api/disponibilidad` sigue mostrando el precio sin descuento.
11. **Documentación.** El `README.md` explica el campo `codigo`, el catálogo con sus condiciones, los campos nuevos de la reserva y los errores nuevos.

## Plan de verificación

- Tests de la API para cada código, sus condiciones y sus errores, y para la penalización con descuento.
- `npm run check` en verde.

## Impacto en la documentación

- `README.md`: reglas del club (descuentos) y referencia de `POST /api/reservas`.
