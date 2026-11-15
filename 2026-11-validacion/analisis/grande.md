# Resumen de grande

## Encargos: grande

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 6 | 6 | 6 | 0/0 | 5.27 $ | — | —/— | — |
| sol | 6 | 6 | 6 | 0/0 | 1.99 $ | — | —/— | — |
| haiku | 6 | 5 | 6 | 1/0 | 3.58 $ | 6 | 1/0 | 6.61 $ |
| luna | 6 | 0 | 2 | 2/0 | 0.18 $ | 3 | 3/0 | 3.79 $ |
| deepseek | 6 | 6 | 6 | 0/0 | 1.51 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 5.27 $ | 64 % | 15 | — | no | 1/6 | 1 | 0 |
| sol | B | 1.99 $ | 146 % | 26 | — | no | 3/6 | 3 | 0 |
| haiku | B | 3.58 $ | 252 % | 100 | 3.58 $ | no | 5/5 | 9 | 0 |
| haiku | C | 6.61 $ | 464 % | 21 | 6.61 $ | no | 1/5 | 1 | 0 |
| luna | B | 0.18 $ | 210 % | 35 | 0.09 $ | sí | 0/0 | 0 | 0 |
| luna | C | 3.79 $ | 4379 % | 87 | 1.26 $ | sí | 0/0 | 0 | 0 |
| deepseek | B | 1.51 $ | 99 % | 64 | — | no | 0/6 | 0 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | B | 0 | 0 | 1 | 0 |
| sol | B | 0 | 0 | 3 | 0 |
| haiku | B | 1 | 1 | 8 | 0 |
| haiku | C | 1 | 1 | 0 | 0 |
| luna | B | 37 | 8 | 13 | 0 |
| luna | C | 37 | 23 | 18 | 0 |
| deepseek | B | 0 | 0 | 0 | 0 |

## Encargos: todas

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 6 | 6 | 6 | 0/0 | 5.27 $ | — | —/— | — |
| sol | 6 | 6 | 6 | 0/0 | 1.99 $ | — | —/— | — |
| haiku | 6 | 5 | 6 | 1/0 | 3.58 $ | 6 | 1/0 | 6.61 $ |
| luna | 6 | 0 | 2 | 2/0 | 0.18 $ | 3 | 3/0 | 3.79 $ |
| deepseek | 6 | 6 | 6 | 0/0 | 1.51 $ | — | —/— | — |

Lo que cuesta validar (B y C, con sus reparaciones):

| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |
|---|---|---|---|---|---|---|---|---|---|
| opus | B | 5.27 $ | 64 % | 15 | — | no | 1/6 | 1 | 0 |
| sol | B | 1.99 $ | 146 % | 26 | — | no | 3/6 | 3 | 0 |
| haiku | B | 3.58 $ | 252 % | 100 | 3.58 $ | no | 5/5 | 9 | 0 |
| haiku | C | 6.61 $ | 464 % | 21 | 6.61 $ | no | 1/5 | 1 | 0 |
| luna | B | 0.18 $ | 210 % | 35 | 0.09 $ | sí | 0/0 | 0 | 0 |
| luna | C | 3.79 $ | 4379 % | 87 | 1.26 $ | sí | 0/0 | 0 | 0 |
| deepseek | B | 1.51 $ | 99 % | 64 | — | no | 0/6 | 0 | 0 |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | B | 0 | 0 | 1 | 0 |
| sol | B | 0 | 0 | 3 | 0 |
| haiku | B | 1 | 1 | 8 | 0 |
| haiku | C | 1 | 1 | 0 | 0 |
| luna | B | 37 | 8 | 13 | 0 |
| luna | C | 37 | 23 | 18 | 0 |
| deepseek | B | 0 | 0 | 0 | 0 |

## Cadenas

| Cadena | A | B | C | D |
|---|---|---|---|---|
| partidos-abiertos-deepseek-r1 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-deepseek-r2 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-deepseek-r3 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-haiku-r1 | 21/21 | 21 (revise, 2 rep.) | 21 (accept, 1 rep.) | — |
| partidos-abiertos-haiku-r2 | 21/21 | 21 (accept, 1 rep.) | 21 (accept, 0 rep.) | — |
| partidos-abiertos-haiku-r3 | 20/21 | 21 (None, 2 rep.) | 21 (accept, 1 rep.) | — |
| partidos-abiertos-luna-r1 | 20/21 | 20 (accept, 1 rep.) | 20 (accept, 2 rep.) | — |
| partidos-abiertos-luna-r2 | 20/21 | 21 (revise, 2 rep.) | 21 (revise, 2 rep.) | — |
| partidos-abiertos-luna-r3 | 20/21 | 21 (accept, 2 rep.) | 21 (accept, 1 rep.) | — |
| partidos-abiertos-opus-r1 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-opus-r2 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-opus-r3 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-sol-r1 | 21/21 | 21 (accept, 1 rep.) | — | — |
| partidos-abiertos-sol-r2 | 21/21 | 21 (accept, 0 rep.) | — | — |
| partidos-abiertos-sol-r3 | 21/21 | 21 (accept, 0 rep.) | — | — |
| torneos-deepseek-r1 | 25/25 | 25 (accept, 0 rep.) | — | — |
| torneos-deepseek-r2 | 25/25 | 25 (accept, 0 rep.) | — | — |
| torneos-deepseek-r3 | 25/25 (gate ✗) | 25 (accept, 0 rep.) | — | — |
| torneos-haiku-r1 | 25/25 | 25 (accept, 2 rep.) | 25 (accept, 0 rep.) | — |
| torneos-haiku-r2 | 25/25 (gate ✗) | 25 (accept, 2 rep.) | 25 (accept, 0 rep.) | — |
| torneos-haiku-r3 | 25/25 | 25 (revise, 2 rep.) | 25 (accept, 0 rep.) | — |
| torneos-luna-r1 | 11/25 | 20 (revise, 2 rep.) | 24 (revise, 2 rep.) | — |
| torneos-luna-r2 | 15/25 | 15 (revise, 2 rep.) | 24 (revise, 2 rep.) | — |
| torneos-luna-r3 | 15/25 | 17 (revise, 2 rep.) | 25 (revise, 2 rep.) | — |
| torneos-opus-r1 | 25/25 | 25 (accept, 0 rep.) | — | — |
| torneos-opus-r2 | 25/25 | 25 (accept, 1 rep.) | — | — |
| torneos-opus-r3 | 25/25 | 25 (accept, 0 rep.) | — | — |
| torneos-sol-r1 | 25/25 | 25 (accept, 0 rep.) | — | — |
| torneos-sol-r2 | 25/25 | 25 (accept, 1 rep.) | — | — |
| torneos-sol-r3 | 25/25 | 25 (accept, 1 rep.) | — | — |
