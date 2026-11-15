# Resumen de completo

## Encargos: normal

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 8 | 8 | 8 | 0/0 | 3.84 $ | — | —/— | — |
| sol | 8 | 8 | 8 | 0/0 | 1.12 $ | — | —/— | — |
| haiku | 8 | 8 | 8 | 0/0 | 0.56 $ | 8 | 0/0 | 3.99 $ |
| luna | 8 | 8 | 8 | 0/0 | 0.13 $ | 8 | 0/0 | 2.33 $ |
| deepseek | 8 | 8 | 8 | 0/0 | 0.39 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 3.84 $ | 71 % | 9 | — | no | 0/8 | 0 | 0 |
| sol | B | 1.12 $ | 105 % | 13 | — | no | 0/8 | 0 | 0 |
| haiku | B | 0.56 $ | 141 % | 40 | — | no | 6/8 | 9 | 0 |
| haiku | C | 3.99 $ | 1012 % | 11 | — | no | 1/8 | 1 | 0 |
| luna | B | 0.13 $ | 166 % | 25 | — | no | 5/8 | 9 | 0 |
| luna | C | 2.33 $ | 2880 % | 51 | — | no | 7/8 | 9 | 0 |
| deepseek | B | 0.39 $ | 191 % | 56 | — | no | 1/8 | 1 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 0 | 0 | 0 | 0 |
| opus | B | 0 | 0 | 0 | 0 |
| sol | D | 0 | 0 | 3 | 0 |
| sol | B | 0 | 0 | 0 | 0 |
| haiku | D | 0 | 0 | 2 | 0 |
| haiku | B | 0 | 0 | 3 | 0 |
| haiku | C | 0 | 0 | 0 | 0 |
| luna | D | 0 | 0 | 4 | 0 |
| luna | B | 0 | 0 | 5 | 0 |
| luna | C | 0 | 0 | 15 | 0 |
| deepseek | D | 0 | 0 | 0 | 0 |
| deepseek | B | 0 | 0 | 1 | 0 |

La misma sesión (D, solo detecta):

| Config | Coste | Cambios pedidos en trabajo completo |
|---|---|---|
| opus | 2.34 $ | 0/8 |
| sol | 0.80 $ | 2/8 |
| haiku | 0.46 $ | 2/8 |
| luna | 0.04 $ | 4/8 |
| deepseek | 0.21 $ | 0/8 |

## Encargos: dificil

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 9 | 8 | 8 | 0/0 | 6.49 $ | — | —/— | — |
| sol | 9 | 9 | 9 | 0/0 | 1.94 $ | — | —/— | — |
| haiku | 9 | 9 | 9 | 0/0 | 0.60 $ | 9 | 0/0 | 6.05 $ |
| luna | 9 | 6 | 6 | 0/0 | 0.14 $ | 9 | 3/0 | 3.10 $ |
| deepseek | 9 | 9 | 9 | 0/0 | 0.55 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 6.49 $ | 86 % | 16 | — | no | 2/8 | 3 | 1 |
| sol | B | 1.94 $ | 152 % | 26 | — | no | 3/9 | 3 | 0 |
| haiku | B | 0.60 $ | 75 % | 44 | — | no | 8/9 | 9 | 0 |
| haiku | C | 6.05 $ | 763 % | 19 | — | no | 4/9 | 4 | 1 |
| luna | B | 0.14 $ | 180 % | 25 | — | no | 4/6 | 6 | 0 |
| luna | C | 3.10 $ | 3932 % | 68 | 1.03 $ | sí | 6/6 | 8 | 0 |
| deepseek | B | 0.55 $ | 186 % | 76 | — | no | 4/9 | 5 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 1 | 0 | 2 | 0 |
| opus | B | 1 | 0 | 2 | 1 |
| sol | D | 0 | 0 | 5 | 0 |
| sol | B | 0 | 0 | 4 | 0 |
| haiku | D | 0 | 0 | 9 | 0 |
| haiku | B | 0 | 0 | 8 | 0 |
| haiku | C | 0 | 0 | 4 | 0 |
| luna | D | 4 | 1 | 7 | 0 |
| luna | B | 4 | 1 | 10 | 0 |
| luna | C | 4 | 4 | 12 | 0 |
| deepseek | D | 0 | 0 | 2 | 0 |
| deepseek | B | 0 | 0 | 5 | 0 |

La misma sesión (D, solo detecta):

| Config | Coste | Cambios pedidos en trabajo completo |
|---|---|---|
| opus | 2.92 $ | 1/8 |
| sol | 1.24 $ | 4/9 |
| haiku | 0.92 $ | 8/9 |
| luna | 0.04 $ | 3/6 |
| deepseek | 0.30 $ | 2/9 |

## Encargos: todas

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 17 | 16 | 16 | 0/0 | 10.33 $ | — | —/— | — |
| sol | 17 | 17 | 17 | 0/0 | 3.06 $ | — | —/— | — |
| haiku | 17 | 17 | 17 | 0/0 | 1.15 $ | 17 | 0/0 | 10.04 $ |
| luna | 17 | 14 | 14 | 0/0 | 0.28 $ | 17 | 3/0 | 5.43 $ |
| deepseek | 17 | 17 | 17 | 0/0 | 0.94 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 10.33 $ | 80 % | 25 | — | no | 2/16 | 3 | 1 |
| sol | B | 3.06 $ | 130 % | 39 | — | no | 3/17 | 3 | 0 |
| haiku | B | 1.15 $ | 97 % | 83 | — | no | 14/17 | 18 | 0 |
| haiku | C | 10.04 $ | 846 % | 29 | — | no | 5/17 | 5 | 1 |
| luna | B | 0.28 $ | 173 % | 50 | — | no | 9/14 | 15 | 0 |
| luna | C | 5.43 $ | 3399 % | 118 | 1.81 $ | sí | 13/14 | 17 | 0 |
| deepseek | B | 0.94 $ | 188 % | 132 | — | no | 5/17 | 6 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 1 | 0 | 2 | 0 |
| opus | B | 1 | 0 | 2 | 1 |
| sol | D | 0 | 0 | 8 | 0 |
| sol | B | 0 | 0 | 4 | 0 |
| haiku | D | 0 | 0 | 11 | 0 |
| haiku | B | 0 | 0 | 11 | 0 |
| haiku | C | 0 | 0 | 4 | 0 |
| luna | D | 4 | 1 | 11 | 0 |
| luna | B | 4 | 1 | 15 | 0 |
| luna | C | 4 | 4 | 27 | 0 |
| deepseek | D | 0 | 0 | 2 | 0 |
| deepseek | B | 0 | 0 | 6 | 0 |

La misma sesión (D, solo detecta):

| Config | Coste | Cambios pedidos en trabajo completo |
|---|---|---|
| opus | 5.25 $ | 1/16 |
| sol | 2.05 $ | 6/17 |
| haiku | 1.38 $ | 10/17 |
| luna | 0.08 $ | 7/14 |
| deepseek | 0.51 $ | 2/17 |

## Cadenas

| Cadena | A | B | C | D |
|---|---|---|---|---|
| codigos-descuento-deepseek-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| codigos-descuento-deepseek-r2 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| codigos-descuento-haiku-r1 | 11/11 | 11 (accept, 0 rep.) | 11 (accept, 1 rep.) | revise (0/0) |
| codigos-descuento-haiku-r2 | 11/11 | 11 (accept, 1 rep.) | 11 (accept, 0 rep.) | accept (0/0) |
| codigos-descuento-luna-r1 | 11/11 (gate ✗) | 11 (revise, 2 rep.) | 11 (accept, 1 rep.) | revise (0/0) |
| codigos-descuento-luna-r2 | 11/11 | 11 (accept, 1 rep.) | 11 (accept, 1 rep.) | revise (0/0) |
| codigos-descuento-opus-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| codigos-descuento-opus-r2 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| codigos-descuento-sol-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| codigos-descuento-sol-r2 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-deepseek-r1 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-deepseek-r2 | 12/12 | 12 (accept, 2 rep.) | — | accept (0/0) |
| duraciones-deepseek-r3 | 12/12 | 12 (accept, 1 rep.) | — | accept (0/0) |
| duraciones-haiku-r1 | 12/12 | 12 (accept, 2 rep.) | 12 (accept, 1 rep.) | revise (0/0) |
| duraciones-haiku-r2 | 12/12 | 12 (accept, 1 rep.) | 12 (accept, 1 rep.) | revise (0/0) |
| duraciones-haiku-r3 | 12/12 | 12 (accept, 1 rep.) | 12 (accept, 1 rep.) | revise (0/0) |
| duraciones-luna-r1 | 12/12 | 12 (accept, 1 rep.) | 12 (accept, 1 rep.) | accept (0/0) |
| duraciones-luna-r2 | 12/12 | 12 (accept, 0 rep.) | 12 (accept, 1 rep.) | accept (0/0) |
| duraciones-luna-r3 | 12/12 | 12 (accept, 2 rep.) | 12 (accept, 2 rep.) | revise (0/0) |
| duraciones-opus-r1 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-opus-r2 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-opus-r3 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-sol-r1 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-sol-r2 | 12/12 | 12 (accept, 0 rep.) | — | revise (0/0) |
| duraciones-sol-r3 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-deepseek-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-deepseek-r2 | 11/11 | 11 (accept, 1 rep.) | — | accept (0/0) |
| exportar-csv-haiku-r1 | 11/11 | 11 (accept, 2 rep.) | 11 (accept, 0 rep.) | accept (0/0) |
| exportar-csv-haiku-r2 | 11/11 | 11 (accept, 1 rep.) | 11 (accept, 0 rep.) | accept (0/0) |
| exportar-csv-luna-r1 | 11/11 | 11 (accept, 0 rep.) | 11 (accept, 0 rep.) | accept (0/0) |
| exportar-csv-luna-r2 | 11/11 | 11 (accept, 0 rep.) | 11 (accept, 2 rep.) | accept (0/0) |
| exportar-csv-opus-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-opus-r2 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-sol-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-sol-r2 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| facturas-deepseek-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-deepseek-r2 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-deepseek-r3 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-haiku-r1 | 10/10 | 10 (accept, 1 rep.) | 10 (accept, 0 rep.) | revise (0/0) |
| facturas-haiku-r2 | 10/10 | 10 (accept, 1 rep.) | 10 (accept, 0 rep.) | accept (0/0) |
| facturas-haiku-r3 | 10/10 | 10 (accept, 1 rep.) | 10 (accept, 0 rep.) | revise (0/0) |
| facturas-luna-r1 | 10/10 | 10 (accept, 1 rep.) | 10 (accept, 1 rep.) | accept (0/0) |
| facturas-luna-r2 | 10/10 | 10 (revise, 2 rep.) | 10 (accept, 1 rep.) | revise (0/0) |
| facturas-luna-r3 | 10/10 | 10 (accept, 0 rep.) | 10 (accept, 2 rep.) | revise (0/0) |
| facturas-opus-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-opus-r2 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-opus-r3 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-sol-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-sol-r2 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-sol-r3 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-deepseek-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-deepseek-r2 | 10/10 | 10 (None, 0 rep.) | — | accept (0/0) |
| lista-espera-haiku-r1 | 10/10 | 10 (accept, 2 rep.) | 10 (accept, 0 rep.) | revise (0/0) |
| lista-espera-haiku-r2 | 10/10 | 10 (revise, 2 rep.) | 10 (accept, 0 rep.) | accept (0/0) |
| lista-espera-luna-r1 | 10/10 | 10 (accept, 2 rep.) | 10 (accept, 1 rep.) | revise (0/0) |
| lista-espera-luna-r2 | 10/10 | 10 (revise, 2 rep.) | 10 (accept, 2 rep.) | revise (0/0) |
| lista-espera-opus-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-opus-r2 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-sol-r1 | 10/10 | 10 (accept, 0 rep.) | — | revise (0/0) |
| lista-espera-sol-r2 | 10/10 | 10 (accept, 0 rep.) | — | revise (0/0) |
| reembolsos-deepseek-r1 | 9/9 | 9 (accept, 0 rep.) | — | accept (0/0) |
| reembolsos-deepseek-r2 | 9/9 | 9 (accept, 0 rep.) | — | accept (0/0) |
| reembolsos-haiku-r1 | 9/9 | 9 (accept, 0 rep.) | 9 (accept, 0 rep.) | accept (0/0) |
| reembolsos-haiku-r2 | 9/9 | 9 (accept, 1 rep.) | 9 (accept, 0 rep.) | accept (0/0) |
| reembolsos-luna-r1 | 9/9 | 9 (revise, 2 rep.) | 9 (accept, 1 rep.) | accept (0/0) |
| reembolsos-luna-r2 | 9/9 | 9 (accept, 0 rep.) | 9 (accept, 1 rep.) | accept (0/0) |
| reembolsos-opus-r1 | 9/9 | 9 (accept, 0 rep.) | — | accept (0/0) |
| reembolsos-opus-r2 | 9/9 | 9 (accept, 0 rep.) | — | accept (0/0) |
| reembolsos-sol-r1 | 9/9 | 9 (accept, 0 rep.) | — | accept (0/0) |
| reembolsos-sol-r2 | 9/9 | 9 (accept, 0 rep.) | — | accept (0/0) |
| reservas-fijas-deepseek-r1 | 13/13 | 13 (accept, 1 rep.) | — | revise (0/0) |
| reservas-fijas-deepseek-r2 | 13/13 | 13 (accept, 0 rep.) | — | accept (0/0) |
| reservas-fijas-deepseek-r3 | 13/13 | 13 (accept, 1 rep.) | — | revise (0/0) |
| reservas-fijas-haiku-r1 | 13/13 | 13 (accept, 1 rep.) | 13 (accept, 1 rep.) | revise (0/0) |
| reservas-fijas-haiku-r2 | 13/13 | 13 (accept, 1 rep.) | 13 (accept, 0 rep.) | revise (0/0) |
| reservas-fijas-haiku-r3 | 13/13 | 13 (accept, 0 rep.) | 13 (accept, 0 rep.) | revise (0/0) |
| reservas-fijas-luna-r1 | 12/13 | 12 (accept, 1 rep.) | 13 (accept, 1 rep.) | revise (0/1) |
| reservas-fijas-luna-r2 | 12/13 | 12 (accept, 1 rep.) | 13 (revise, 2 rep.) | revise (0/1) |
| reservas-fijas-luna-r3 | 11/13 | 12 (revise, 2 rep.) | 13 (accept, 2 rep.) | revise (1/2) |
| reservas-fijas-opus-r1 | 13/13 | 13 (revise, 2 rep.) | — | revise (0/0) |
| reservas-fijas-opus-r2 | 13/13 | 13 (accept, 1 rep.) | — | accept (0/0) |
| reservas-fijas-opus-r3 | 12/13 | 12 (accept, 0 rep.) | — | revise (0/1) |
| reservas-fijas-sol-r1 | 13/13 | 13 (accept, 1 rep.) | — | revise (0/0) |
| reservas-fijas-sol-r2 | 13/13 | 13 (accept, 1 rep.) | — | revise (0/0) |
| reservas-fijas-sol-r3 | 13/13 | 13 (accept, 1 rep.) | — | revise (0/0) |
