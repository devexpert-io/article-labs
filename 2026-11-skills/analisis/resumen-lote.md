# Resumen del lote lote

## Parte B: efecto

| Skill | Condición | Herramienta | n | Resultado | Mutantes cazados | Coste (mediana) | Tiempo (mediana) | Llamadas (mediana) | Skill cargada |
|---|---|---|---|---|---|---|---|---|---|
| consultas-club | recortada | claude | 3 | aciertos 4/4/4 de 4 | — | 0.200 $ | 31 s | 5 | 3/3 |
| consultas-club | recortada | codex | 3 | aciertos 4/4/4 de 4 | — | 0.035 $ | 19 s | 9 | 3/3 |
| consultas-club | recortada | opencode | 3 | aciertos 4/4/4 de 4 | — | 0.008 $ | 25 s | 6 | 3/3 |
| consultas-club | sin | claude | 3 | aciertos 4/4/4 de 4 | — | 0.166 $ | 20 s | 2 | 0/3 |
| consultas-club | sin | codex | 3 | aciertos 4/4/4 de 4 | — | 0.041 $ | 30 s | 6 | 0/3 |
| consultas-club | sin | opencode | 3 | aciertos 4/4/4 de 4 | — | 0.022 $ | 68 s | 9 | 0/3 |
| consultas-club | skill | claude | 3 | aciertos 4/4/4 de 4 | — | 0.170 $ | 27 s | 4 | 3/3 |
| consultas-club | skill | codex | 3 | aciertos 4/4/4 de 4 | — | 0.027 $ | 18 s | 8 | 3/3 |
| consultas-club | skill | opencode | 3 | aciertos 4/4/4 de 4 | — | 0.006 $ | 24 s | 6 | 3/3 |
| facturas-gestoria | agents | claude | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.647 $ | 123 s | 8 | 0/3 |
| facturas-gestoria | agents | codex | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.132 $ | 162 s | 13 | 0/3 |
| facturas-gestoria | agents | opencode | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.102 $ | 446 s | 24 | 0/3 |
| facturas-gestoria | sin | claude | 3 | criterios 8/1/1 de 10, fallan C['1', '10', '2', '3', '4', '5', '6', '7', '8'], gate 3/3 | — | 0.246 $ | 39 s | 6 | 0/3 |
| facturas-gestoria | sin | codex | 3 | criterios 8/1/8 de 10, fallan C['1', '10', '2', '3', '4', '5', '6', '7', '8'], gate 3/3 | — | 0.200 $ | 164 s | 19 | 0/3 |
| facturas-gestoria | sin | opencode | 2 | criterios 10/8 de 10, fallan C['4', '6'], gate 2/2 | — | 0.239 $ | 680 s | 49 | 0/2 |
| facturas-gestoria | skill | claude | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.668 $ | 121 s | 9 | 3/3 |
| facturas-gestoria | skill | codex | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.125 $ | 152 s | 11 | 3/3 |
| facturas-gestoria | skill | opencode | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.116 $ | 496 s | 31 | 3/3 |
| tests-node | enfatica-barato | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.059 $ | 213 s | 24 | 3/3 |
| tests-node | enfatica-barato | codex | 3 | criterios 8/9/9 de 9, fallan C['5'], gate 3/3 | 7/8/8 de 10 | 0.013 $ | 175 s | 18 | 3/3 |
| tests-node | enfatica-barato | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/9 de 10 | 0.025 $ | 125 s | 25 | 3/3 |
| tests-node | enfatica-potente | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.839 $ | 185 s | 10 | 3/3 |
| tests-node | enfatica-potente | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/7/9 de 10 | 0.160 $ | 195 s | 17 | 3/3 |
| tests-node | enfatica-potente | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 8/9/10 de 10 | 0.108 $ | 508 s | 28 | 3/3 |
| tests-node | neutra-barato | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/4/10 de 10 | 0.043 $ | 197 s | 18 | 3/3 |
| tests-node | neutra-barato | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 8/8/2 de 10 | 0.012 $ | 169 s | 20 | 2/3 |
| tests-node | neutra-barato | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.025 $ | 113 s | 28 | 3/3 |
| tests-node | neutra-potente | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.873 $ | 193 s | 13 | 3/3 |
| tests-node | neutra-potente | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 7/9/7 de 10 | 0.163 $ | 170 s | 15 | 3/3 |
| tests-node | neutra-potente | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/8/9 de 10 | 0.140 $ | 624 s | 38 | 3/3 |
| tests-node | sin-barato | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.040 $ | 151 s | 19 | 0/3 |
| tests-node | sin-barato | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 6/8/5 de 10 | 0.016 $ | 190 s | 20 | 0/3 |
| tests-node | sin-barato | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.024 $ | 99 s | 26 | 0/3 |
| tests-node | sin-potente | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.727 $ | 146 s | 9 | 0/3 |
| tests-node | sin-potente | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 7/10/7 de 10 | 0.154 $ | 184 s | 14 | 0/3 |
| tests-node | sin-potente | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 8/8/10 de 10 | 0.113 $ | 548 s | 24 | 0/3 |

## Parte A: activación

| Herramienta | Descripción | Instalación | Tipo | n | Aciertos | Con falso positivo |
|---|---|---|---|---|---|---|
| claude | concreta | muchas | nombra | 1 | 1 | 0 |
| claude | concreta | pocas | nombra | 1 | 1 | 0 |
| claude | vaga | pocas | nombra | 2 | 2 | 0 |
| codex | concreta | muchas | nombra | 1 | 1 | 0 |
| codex | concreta | pocas | nombra | 1 | 1 | 0 |
| codex | vaga | muchas | nombra | 1 | 1 | 0 |
| codex | vaga | pocas | nombra | 1 | 1 | 0 |
| todas | concreta | muchas | nombra | 2 | 2 | 0 |
| todas | concreta | pocas | nombra | 2 | 2 | 0 |
| todas | vaga | muchas | nombra | 1 | 1 | 0 |
| todas | vaga | pocas | nombra | 3 | 3 | 0 |
