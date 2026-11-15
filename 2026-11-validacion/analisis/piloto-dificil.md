# Resumen de piloto-dificil

## Encargos: dificil

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 3 | 3 | 3 | 0/0 | 1.40 $ | — | —/— | — |
| sol | 3 | 3 | 3 | 0/0 | 0.86 $ | — | —/— | — |
| haiku | 3 | 3 | 3 | 0/0 | 0.23 $ | 3 | 0/0 | 2.36 $ |
| luna | 3 | 2 | 2 | 0/0 | 0.03 $ | 3 | 1/0 | 1.18 $ |
| deepseek | 3 | 3 | 3 | 0/0 | 0.51 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 1.40 $ | 45 % | 3 | — | no | 0/3 | 0 | 0 |
| sol | B | 0.86 $ | 195 % | 11 | — | no | 1/3 | 2 | 0 |
| haiku | B | 0.23 $ | 82 % | 17 | — | no | 2/3 | 3 | 0 |
| haiku | C | 2.36 $ | 831 % | 7 | — | no | 1/3 | 1 | 0 |
| luna | B | 0.03 $ | 102 % | 5 | — | no | 0/2 | 0 | 0 |
| luna | C | 1.18 $ | 4677 % | 23 | 1.18 $ | no | 1/2 | 2 | 0 |
| deepseek | B | 0.51 $ | 163 % | 29 | — | no | 1/3 | 2 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 0 | 0 | 1 | 0 |
| opus | B | 0 | 0 | 0 | 0 |
| sol | D | 0 | 0 | 1 | 0 |
| sol | B | 0 | 0 | 1 | 0 |
| haiku | D | 0 | 0 | 3 | 0 |
| haiku | B | 0 | 0 | 3 | 0 |
| haiku | C | 0 | 0 | 1 | 0 |
| luna | D | 2 | 1 | 2 | 0 |
| luna | B | 2 | 1 | 2 | 0 |
| luna | C | 2 | 2 | 5 | 0 |
| deepseek | D | 0 | 0 | 1 | 0 |
| deepseek | B | 0 | 0 | 1 | 0 |

La misma sesión (D, solo detecta):

| Config | Coste | Cambios pedidos en trabajo completo |
|---|---|---|
| opus | 0.93 $ | 1/3 |
| sol | 0.41 $ | 1/3 |
| haiku | 0.41 $ | 2/3 |
| luna | 0.02 $ | 1/2 |
| deepseek | 0.37 $ | 1/3 |

## Encargos: todas

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 3 | 3 | 3 | 0/0 | 1.40 $ | — | —/— | — |
| sol | 3 | 3 | 3 | 0/0 | 0.86 $ | — | —/— | — |
| haiku | 3 | 3 | 3 | 0/0 | 0.23 $ | 3 | 0/0 | 2.36 $ |
| luna | 3 | 2 | 2 | 0/0 | 0.03 $ | 3 | 1/0 | 1.18 $ |
| deepseek | 3 | 3 | 3 | 0/0 | 0.51 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 1.40 $ | 45 % | 3 | — | no | 0/3 | 0 | 0 |
| sol | B | 0.86 $ | 195 % | 11 | — | no | 1/3 | 2 | 0 |
| haiku | B | 0.23 $ | 82 % | 17 | — | no | 2/3 | 3 | 0 |
| haiku | C | 2.36 $ | 831 % | 7 | — | no | 1/3 | 1 | 0 |
| luna | B | 0.03 $ | 102 % | 5 | — | no | 0/2 | 0 | 0 |
| luna | C | 1.18 $ | 4677 % | 23 | 1.18 $ | no | 1/2 | 2 | 0 |
| deepseek | B | 0.51 $ | 163 % | 29 | — | no | 1/3 | 2 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 0 | 0 | 1 | 0 |
| opus | B | 0 | 0 | 0 | 0 |
| sol | D | 0 | 0 | 1 | 0 |
| sol | B | 0 | 0 | 1 | 0 |
| haiku | D | 0 | 0 | 3 | 0 |
| haiku | B | 0 | 0 | 3 | 0 |
| haiku | C | 0 | 0 | 1 | 0 |
| luna | D | 2 | 1 | 2 | 0 |
| luna | B | 2 | 1 | 2 | 0 |
| luna | C | 2 | 2 | 5 | 0 |
| deepseek | D | 0 | 0 | 1 | 0 |
| deepseek | B | 0 | 0 | 1 | 0 |

La misma sesión (D, solo detecta):

| Config | Coste | Cambios pedidos en trabajo completo |
|---|---|---|
| opus | 0.93 $ | 1/3 |
| sol | 0.41 $ | 1/3 |
| haiku | 0.41 $ | 2/3 |
| luna | 0.02 $ | 1/2 |
| deepseek | 0.37 $ | 1/3 |

## Cadenas

| Cadena | A | B | C | D |
|---|---|---|---|---|
| duraciones-deepseek-r1 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-haiku-r1 | 12/12 | 12 (accept, 0 rep.) | 12 (accept, 0 rep.) | accept (0/0) |
| duraciones-luna-r1 | 12/12 | 12 (accept, 0 rep.) | 12 (accept, 2 rep.) | revise (0/0) |
| duraciones-opus-r1 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| duraciones-sol-r1 | 12/12 | 12 (accept, 0 rep.) | — | accept (0/0) |
| facturas-deepseek-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-haiku-r1 | 10/10 | 10 (revise, 2 rep.) | 10 (accept, 0 rep.) | revise (0/0) |
| facturas-luna-r1 | 10/10 | 10 (accept, 0 rep.) | 10 (accept, 0 rep.) | accept (0/0) |
| facturas-opus-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| facturas-sol-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| reservas-fijas-deepseek-r1 | 13/13 | 13 (accept, 2 rep.) | — | revise (0/0) |
| reservas-fijas-haiku-r1 | 13/13 | 13 (accept, 1 rep.) | 13 (accept, 1 rep.) | revise (0/0) |
| reservas-fijas-luna-r1 | 11/13 | 12 (accept, 1 rep.) | 13 (revise, 2 rep.) | revise (1/2) |
| reservas-fijas-opus-r1 | 13/13 | 13 (accept, 0 rep.) | — | revise (0/0) |
| reservas-fijas-sol-r1 | 13/13 | 13 (accept, 2 rep.) | — | revise (0/0) |
