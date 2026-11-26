# Reglas de facturación de la gestoría

La gestoría del club (Asesoría Prieto) recibe una factura por socio y mes. Estas son sus reglas. No están en el código ni en las specs: si una factura no las cumple, la devuelven.

## Qué entra en la factura de un socio y un mes

Las reservas del socio que **empiezan** ese mes:

| Estado de la reserva | Se factura | Importe de la línea | Concepto |
|---|---|---|---|
| `confirmada` | sí | `importe` | `Reserva` |
| `no_presentada` | sí | `importe` | `Reserva` |
| `cancelada` con `penalizacion` mayor que 0 | sí | `penalizacion` | `Penalización` (con tilde) |
| `cancelada` sin penalización | no | | |

Los importes del club ya llevan el IVA (21 %) incluido. Un socio sin nada que facturar ese mes no lleva factura.

## Base e IVA

- `total` es la suma de las líneas.
- La `base` se calcula **sobre el total de la factura, no línea a línea**: `total / 1,21`, redondeado al céntimo más cercano, con medio céntimo hacia arriba. Con importes enteros en céntimos: `Math.round(total * 100 / 121)`.
- `iva` es `total - base`. Así `base + iva` cuadra siempre con el total.

Ejemplo: tres líneas de 1.800, 1.800 y 2.800 céntimos dan un total de 6.400, una base de 5.289 y un IVA de 1.111. Calculado línea a línea saldría una base de 5.290, y la gestoría la devuelve.

## Numeración

- Formato `F<año>-<número de 4 cifras>`: `F2026-0001`, `F2026-0002`…
- El año es el **del mes facturado**, no el del día en que se genera: diciembre de 2026 generado en enero de 2027 sigue la serie de 2026.
- Una sola serie por año, correlativa, sin huecos ni repetidos. Cada año empieza en `0001`.
- Dentro de un mes, los números se asignan por orden de id de socio.
- Un mes que se genera después sigue donde lo dejó el último mes generado de ese año, aunque se generen fuera de orden. Un mes sin facturas no gasta números.
- Generar otra vez un mes ya generado no gasta números: devuelve las mismas facturas.

## Antes de dar las facturas por buenas

1. Comprueba con un test el ejemplo de 6.400 céntimos (base 5.289, IVA 1.111).
2. Comprueba con un test que una cancelación con penalización entra con el concepto `Penalización` y una sin penalización no entra.
3. Comprueba con un test la numeración de diciembre generado en enero (`POST /_reloj`).
