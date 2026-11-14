# Resumen de piloto

## Encargos: normal

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 2 | 2 | 2 | 0/0 | 0.90 $ | — | —/— | — |
| sol | 2 | 2 | 2 | 0/0 | 0.24 $ | — | —/— | — |
| haiku | 2 | 2 | 1 | 0/1 | 0.20 $ | 2 | 0/0 | 1.05 $ |
| luna | 2 | 2 | 1 | 0/1 | 0.03 $ | 2 | 0/0 | 0.59 $ |
| deepseek | 2 | 2 | 2 | 0/0 | 0.17 $ | — | —/— | — |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 0 | 0 | 0 | 0 |
| opus | B | 0 | 0 | 0 | 0 |
| sol | D | 0 | 0 | 2 | 0 |
| sol | B | 0 | 0 | 0 | 0 |
| haiku | D | 0 | 0 | 0 | 0 |
| haiku | B | 0 | 0 | 1 | 0 |
| haiku | C | 0 | 0 | 0 | 0 |
| luna | D | 0 | 0 | 0 | 0 |
| luna | B | 0 | 0 | 3 | 0 |
| luna | C | 0 | 0 | 1 | 0 |
| deepseek | D | 0 | 0 | 0 | 0 |
| deepseek | B | 0 | 0 | 0 | 0 |

## Encargos: todas

| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |
|---|---|---|---|---|---|---|---|---|
| opus | 2 | 2 | 2 | 0/0 | 0.90 $ | — | —/— | — |
| sol | 2 | 2 | 2 | 0/0 | 0.24 $ | — | —/— | — |
| haiku | 2 | 2 | 1 | 0/1 | 0.20 $ | 2 | 0/0 | 1.05 $ |
| luna | 2 | 2 | 1 | 0/1 | 0.03 $ | 2 | 0/0 | 0.59 $ |
| deepseek | 2 | 2 | 2 | 0/0 | 0.17 $ | — | —/— | — |

Detección (primera validación):

| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |
|---|---|---|---|---|---|
| opus | D | 0 | 0 | 0 | 0 |
| opus | B | 0 | 0 | 0 | 0 |
| sol | D | 0 | 0 | 2 | 0 |
| sol | B | 0 | 0 | 0 | 0 |
| haiku | D | 0 | 0 | 0 | 0 |
| haiku | B | 0 | 0 | 1 | 0 |
| haiku | C | 0 | 0 | 0 | 0 |
| luna | D | 0 | 0 | 0 | 0 |
| luna | B | 0 | 0 | 3 | 0 |
| luna | C | 0 | 0 | 1 | 0 |
| deepseek | D | 0 | 0 | 0 | 0 |
| deepseek | B | 0 | 0 | 0 | 0 |

## Cadenas

| Cadena | A | B | C | D |
|---|---|---|---|---|
| exportar-csv-deepseek-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-haiku-r1 | 11/11 | 11 (accept, 2 rep.) | 11 (accept, 0 rep.) | accept (0/0) |
| exportar-csv-luna-r1 | 11/11 | 10 (accept, 1 rep.) | 11 (accept, 0 rep.) | accept (0/0) |
| exportar-csv-opus-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| exportar-csv-sol-r1 | 11/11 | 11 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-deepseek-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-haiku-r1 | 10/10 | 9 (revise, 2 rep.) | 10 (accept, 0 rep.) | revise (0/0) |
| lista-espera-luna-r1 | 10/10 | 10 (accept, 1 rep.) | 10 (accept, 2 rep.) | accept (0/0) |
| lista-espera-opus-r1 | 10/10 | 10 (accept, 0 rep.) | — | accept (0/0) |
| lista-espera-sol-r1 | 10/10 | 10 (accept, 0 rep.) | — | revise (0/0) |
