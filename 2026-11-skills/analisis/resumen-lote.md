# Resumen del lote lote

## Parte B: efecto

| Skill | Condición | Herramienta | n | Resultado | Mutantes cazados | Coste (mediana) | Tiempo (mediana) | Llamadas (mediana) | Skill cargada |
|---|---|---|---|---|---|---|---|---|---|
| consultas-club | recortada | claude | 3 | aciertos 4/4/4 de 4 | — | 0.180 $ | 30 s | 4 | 3/3 |
| consultas-club | recortada | codex | 3 | aciertos 4/4/4 de 4 | — | 0.035 $ | 19 s | 8 | 3/3 |
| consultas-club | recortada | opencode | 3 | aciertos 4/4/4 de 4 | — | 0.012 $ | 26 s | 8 | 3/3 |
| consultas-club | sin | claude | 3 | aciertos 4/4/4 de 4 | — | 0.169 $ | 24 s | 2 | 0/3 |
| consultas-club | sin | codex | 3 | aciertos 4/4/4 de 4 | — | 0.051 $ | 34 s | 7 | 0/3 |
| consultas-club | sin | opencode | 3 | aciertos 4/4/4 de 4 | — | 0.025 $ | 78 s | 9 | 0/3 |
| consultas-club | skill | claude | 3 | aciertos 4/4/4 de 4 | — | 0.177 $ | 31 s | 5 | 3/3 |
| consultas-club | skill | codex | 3 | aciertos 4/4/4 de 4 | — | 0.024 $ | 21 s | 8 | 3/3 |
| consultas-club | skill | opencode | 3 | aciertos 4/4/4 de 4 | — | 0.006 $ | 22 s | 5 | 3/3 |
| facturas-gestoria | agents | claude | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.668 $ | 134 s | 8 | 0/3 |
| facturas-gestoria | agents | codex | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.153 $ | 167 s | 15 | 0/3 |
| facturas-gestoria | agents | opencode | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.127 $ | 588 s | 28 | 0/3 |
| facturas-gestoria | sin | claude | 3 | criterios 8/8/8 de 10, fallan C['4', '6'], gate 3/3 | — | 0.843 $ | 188 s | 11 | 0/3 |
| facturas-gestoria | sin | codex | 3 | criterios 8/8/9 de 10, fallan C['4', '6'], gate 3/3 | — | 0.233 $ | 199 s | 25 | 0/3 |
| facturas-gestoria | sin | opencode | 2 | criterios 9/8 de 10, fallan C['4', '6'], gate 2/2 | — | 0.164 $ | 606 s | 42 | 0/2 |
| facturas-gestoria | skill | claude | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.652 $ | 129 s | 9 | 3/3 |
| facturas-gestoria | skill | codex | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.135 $ | 171 s | 14 | 3/3 |
| facturas-gestoria | skill | opencode | 3 | criterios 10/10/10 de 10, gate 3/3 | — | 0.129 $ | 462 s | 34 | 3/3 |
| tests-node | enfatica-barato | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 8/9/9 de 10 | 0.053 $ | 236 s | 28 | 3/3 |
| tests-node | enfatica-barato | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/6/6 de 10 | 0.013 $ | 200 s | 23 | 3/3 |
| tests-node | enfatica-barato | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 6/10/10 de 10 | 0.024 $ | 130 s | 27 | 3/3 |
| tests-node | enfatica-potente | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.853 $ | 215 s | 10 | 3/3 |
| tests-node | enfatica-potente | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/10/10 de 10 | 0.198 $ | 232 s | 17 | 3/3 |
| tests-node | enfatica-potente | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/10/10 de 10 | 0.151 $ | 691 s | 33 | 3/3 |
| tests-node | neutra-barato | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/10/9 de 10 | 0.037 $ | 155 s | 18 | 2/3 |
| tests-node | neutra-barato | codex | 3 | criterios 9/9/8 de 9, fallan C['5'], gate 3/3 | 5/2/6 de 10 | 0.010 $ | 151 s | 19 | 3/3 |
| tests-node | neutra-barato | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.029 $ | 125 s | 29 | 3/3 |
| tests-node | neutra-potente | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.824 $ | 181 s | 12 | 3/3 |
| tests-node | neutra-potente | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/9/8 de 10 | 0.164 $ | 182 s | 14 | 3/3 |
| tests-node | neutra-potente | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 9/10/8 de 10 | 0.154 $ | 565 s | 36 | 3/3 |
| tests-node | sin-barato | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/9/10 de 10 | 0.042 $ | 178 s | 19 | 0/3 |
| tests-node | sin-barato | codex | 3 | criterios 9/9/8 de 9, fallan C['5'], gate 3/3 | 4/7/6 de 10 | 0.014 $ | 155 s | 21 | 0/3 |
| tests-node | sin-barato | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.023 $ | 104 s | 27 | 0/3 |
| tests-node | sin-potente | claude | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.695 $ | 143 s | 7 | 0/3 |
| tests-node | sin-potente | codex | 3 | criterios 9/9/9 de 9, gate 3/3 | 7/7/7 de 10 | 0.144 $ | 163 s | 10 | 0/3 |
| tests-node | sin-potente | opencode | 3 | criterios 9/9/9 de 9, gate 3/3 | 10/10/10 de 10 | 0.159 $ | 563 s | 31 | 0/3 |

## Parte A: activación

| Herramienta | Descripción | Instalación | Tipo | n | Aciertos | Con falso positivo |
|---|---|---|---|---|---|---|
| claude | concreta | muchas | implicita | 18 | 18 | 0 |
| claude | concreta | muchas | nombra | 18 | 18 | 0 |
| claude | concreta | muchas | parecida | 18 | 18 | 0 |
| claude | concreta | pocas | implicita | 18 | 18 | 0 |
| claude | concreta | pocas | nombra | 18 | 18 | 0 |
| claude | concreta | pocas | parecida | 18 | 18 | 0 |
| claude | vaga | muchas | implicita | 18 | 13 | 0 |
| claude | vaga | muchas | nombra | 18 | 15 | 0 |
| claude | vaga | muchas | parecida | 18 | 18 | 0 |
| claude | vaga | pocas | implicita | 18 | 16 | 0 |
| claude | vaga | pocas | nombra | 18 | 18 | 0 |
| claude | vaga | pocas | parecida | 18 | 18 | 0 |
| codex | concreta | muchas | implicita | 18 | 18 | 0 |
| codex | concreta | muchas | nombra | 18 | 18 | 0 |
| codex | concreta | muchas | parecida | 18 | 18 | 0 |
| codex | concreta | pocas | implicita | 18 | 18 | 0 |
| codex | concreta | pocas | nombra | 18 | 18 | 0 |
| codex | concreta | pocas | parecida | 18 | 18 | 0 |
| codex | vaga | muchas | implicita | 18 | 18 | 2 |
| codex | vaga | muchas | nombra | 18 | 18 | 0 |
| codex | vaga | muchas | parecida | 18 | 10 | 8 |
| codex | vaga | pocas | implicita | 18 | 18 | 1 |
| codex | vaga | pocas | nombra | 18 | 18 | 0 |
| codex | vaga | pocas | parecida | 18 | 5 | 13 |
| opencode | concreta | muchas | implicita | 18 | 15 | 0 |
| opencode | concreta | muchas | nombra | 18 | 17 | 0 |
| opencode | concreta | muchas | parecida | 18 | 18 | 0 |
| opencode | concreta | pocas | implicita | 18 | 18 | 0 |
| opencode | concreta | pocas | nombra | 18 | 18 | 0 |
| opencode | concreta | pocas | parecida | 18 | 17 | 1 |
| opencode | vaga | muchas | implicita | 18 | 11 | 2 |
| opencode | vaga | muchas | nombra | 18 | 12 | 0 |
| opencode | vaga | muchas | parecida | 18 | 18 | 0 |
| opencode | vaga | pocas | implicita | 18 | 12 | 0 |
| opencode | vaga | pocas | nombra | 18 | 12 | 0 |
| opencode | vaga | pocas | parecida | 18 | 17 | 1 |
| todas | concreta | muchas | implicita | 54 | 51 | 0 |
| todas | concreta | muchas | nombra | 54 | 53 | 0 |
| todas | concreta | muchas | parecida | 54 | 54 | 0 |
| todas | concreta | pocas | implicita | 54 | 54 | 0 |
| todas | concreta | pocas | nombra | 54 | 54 | 0 |
| todas | concreta | pocas | parecida | 54 | 53 | 1 |
| todas | vaga | muchas | implicita | 54 | 42 | 4 |
| todas | vaga | muchas | nombra | 54 | 45 | 0 |
| todas | vaga | muchas | parecida | 54 | 46 | 8 |
| todas | vaga | pocas | implicita | 54 | 46 | 1 |
| todas | vaga | pocas | nombra | 54 | 48 | 0 |
| todas | vaga | pocas | parecida | 54 | 40 | 14 |
