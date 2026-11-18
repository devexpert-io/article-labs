# Subagentes lab

Experimento del artículo de DevExpert sobre subagentes en agentes de programación (diciembre de 2026). La pregunta: ¿cuándo compensa que el agente delegue en un subagente, y cuándo es mejor que haga el trabajo él mismo o que siga un procedimiento guardado como skill? Medimos coste, tiempo, calidad y cuánto contexto le queda ocupado al agente principal.

> **Estado:** diseño fijado el 18 de noviembre de 2026, antes de ejecutar nada salvo las pruebas de humo de cada herramienta. Esta sección no se toca después de ver los datos. Si el piloto obliga a cambiar algo, el cambio va en su propia sección ("Cambios tras el piloto") con el motivo.

## Diseño

### Los agentes

Cada herramienta con su modelo principal y su modelo barato. El principal hace de orquestador. El barato solo aparece en el caso 3.

| Herramienta | Modelo principal | Modelo barato |
|---|---|---|
| Claude Code 2.1.327 | Opus 5.5 | Haiku 5.5 |
| Codex CLI 0.170.0 | gpt-6.1-sol, razonamiento medio | gpt-6-luna, razonamiento medio |
| OpenCode 2.3.2 (el piloto empezó con la 2.3.0) | DeepSeek V4 Pro (NaN Builders) | DeepSeek V4.1 Flash 1017 (NaN Builders) |

Cada agente se ejecuta sin la configuración de su usuario (ni instrucciones globales, ni skills, ni MCP) y dentro de una caja que solo le deja escribir en su carpeta de trabajo, como en el [laboratorio de validación](../2026-11-validacion).

Cómo se activan y se desactivan los subagentes en cada herramienta:

| Herramienta | Con subagentes | Sin subagentes |
|---|---|---|
| Claude Code | La herramienta `Agent` (de serie) | `--disallowedTools Agent` |
| Codex | `--enable multi_agent_v2` (`spawn_agent` y `wait_agent`) | `--disable multi_agent_v2 --disable multi_agent` |
| OpenCode | La herramienta `subagent` (de serie) | Permiso `subagent: deny` |

Dentro de "con subagentes", cada herramienta usa lo que trae de serie: qué modelo usa el subagente y cuánto contexto hereda es parte de lo que se mide. Por ejemplo, en la prueba de humo, Codex lanzó su subagente con `fork_turns: "all"`, que le copia toda la conversación.

### Caso 1: explorar mucho y devolver poco

El caso para el que se suelen recomendar los subagentes: una pregunta que obliga a leer mucho código para dar una respuesta corta.

- **El repositorio:** un proyecto de código abierto en TypeScript de tamaño medio (entre 50.000 y 150.000 líneas), fijado en un commit. Se elige en el piloto y se anota aquí con su commit antes del lote.
- **El encargo:** un inventario que obliga a recorrer todo el repositorio (por ejemplo, todas las variables de entorno que lee, con el fichero y el valor por defecto). Su respuesta correcta se saca del código con una búsqueda mecánica y se revisa a mano antes del lote.
- **Condiciones:** A, sin subagentes. B, el mismo encargo pidiendo que la exploración la hagan subagentes y que el principal se quede solo con lo que le devuelven.
- **Qué se mide:** acierto del inventario (cuántos elementos encuentra y cuántos se inventa), tokens y coste totales (principal más subagentes), tiempo y el contexto ocupado del agente principal al terminar.

### Caso 2: tres features independientes, en paralelo o seguidas

- **El proyecto:** el club de pádel del laboratorio de validación (`club/`, con su `AGENTS.md`, sus specs y sus tests ocultos).
- **El encargo:** tres features que no dependen entre sí: `exportar-csv`, `codigos-descuento` y `lista-espera`.
- **Condiciones:** A, un solo agente las implementa una detrás de otra en la misma sesión. B, el agente principal reparte una feature a cada subagente, en paralelo y sobre la misma carpeta, y al final comprueba que todo pasa.
- **Qué se mide:** cuántas features salen completas con los tests ocultos (la misma vara que en validación: un criterio cuenta si pasan todos sus tests), si el gate (`npm run check`) queda en verde, tiempo de reloj, tokens y coste totales y el contexto ocupado del principal al terminar.

### Caso 3: el mismo procedimiento como skill o como subagente

Una tarea que se repite, que es cuando la recomendación habitual es una skill.

- **El procedimiento:** implementar una feature del club siguiendo un procedimiento fijo (leer la spec entera, implementar solo lo que pide, añadir tests, actualizar el README y pasar el gate), escrito como skill.
- **Los encargos:** `reembolsos` (normal) y `duraciones` (difícil).
- **Condiciones:**
  - S, la skill en la sesión principal: el agente principal la carga y hace el trabajo él mismo.
  - P, un subagente con el mismo modelo que el principal, que recibe la skill.
  - B, un subagente con el modelo barato, que recibe la skill.
- **Qué se mide:** si la feature sale completa con los tests ocultos, tokens y coste totales, tiempo y el contexto ocupado del principal al terminar.

### Repeticiones y total

Tres repeticiones en los casos 1 y 2 y dos en el caso 3:

- Caso 1: 3 herramientas × 2 condiciones × 3 = 18 ejecuciones.
- Caso 2: 3 × 2 × 3 = 18.
- Caso 3: 3 × 3 condiciones × 2 encargos × 2 = 36.

Son 72 ejecuciones. A precio de API se estiman entre 50 y 60 $ (el lote de validación, de 85 cadenas, costó 57,69 $). El coste real es 0 $: Claude Code y Codex van con suscripción y DeepSeek con la de NaN Builders.

### Coste

Los tokens se convierten a dólares con el precio público de cada modelo, también en las ejecuciones con suscripción, para poder comparar. La tabla de precios y la fecha en que se tomó irán en `analisis/`.

### Lo que no mide

- Agent teams ni flujos de muchos agentes coordinados (los dynamic workflows de Claude Code, por ejemplo): solo un agente principal y sus subagentes.
- Subagentes que trabajan en worktrees separados: en el caso 2 comparten carpeta, que es lo que hace cada herramienta de serie.
- Tareas largas de horas. Son encargos de minutos, como los del laboratorio de validación.

## El repositorio del caso 1

Fijado en el piloto, el 18 de noviembre, antes del lote:

- **[umami-software/umami](https://github.com/umami-software/umami)**, commit `aad2c4cedd5c0b3bc4d361843830a0bb47cf79c4` (17 de noviembre de 2026). Tiene unas 120.000 líneas de TypeScript sin contar los ficheros generados (182.000 con ellos, casi todo `packages/api-client/src/generated`). Las variables de entorno se leen repartidas por más de 50 ficheros (la aplicación, los paquetes, los scripts, la configuración de Next.js, Playwright y Rollup y los tests), y no en un `env.ts` central, que es lo que hace falta para que la exploración sea de verdad.
- El runner lo clona por commit (`runner/casos.py`, en un espejo local en `$LAB_SCRATCH/repos/umami.git`) y le quita la historia. No está en este repositorio.
- **La referencia** (`caso1/referencia.json`): 83 variables y 168 pares variable-fichero. Sale de una búsqueda mecánica (`caso1/extraer.py`: `process.env.X`, `process.env['X']`, `env('X')` de Prisma, desestructuraciones, alias de `process.env` y listas leídas con `process.env[clave]`) y de una revisión a mano, escrita con sus motivos en `caso1/construir_referencia.py`: las claves que `next.config.ts` inyecta con otro nombre (`cloudMode`, `basePath`…) son neutras, un comentario JSDoc y el nombre de un test no son lecturas, y los ficheros que solo escriben la variable (tests) no cuentan como pares pero tampoco penalizan. Se puntúan 14 valores por defecto, los que son un literal claro.
- **La puntuación** (`caso1/puntuar.py`): aciertos (nombres de la referencia), inventadas (nombres que no aparecen en ningún fichero del repositorio), `fuera_del_codigo` (nombres que aparecen pero no los lee el código JS/TS: GitHub Actions, docker-compose, scripts de shell), y, como secundarias, los pares variable-fichero, los ficheros de más y los valores por defecto.

## Cómo se ha montado

- **Herramientas.** `runner/agentes.py` viene del laboratorio de validación (el mismo aislamiento con bubblewrap y sin la configuración del usuario) y añade el interruptor de subagentes y las métricas separadas del principal y de cada subagente:
  - **Claude Code:** el reparto sale de las transcripciones (`<sesión>.jsonl` y `<sesión>/subagents/agent-*.jsonl` con su `.meta.json`), que se escriben en una carpeta propia de la ejecución montada sobre `~/.claude/projects`. El uso por mensaje del stream JSON es parcial y no vale para esto. El total y el coste son los de `modelUsage` del evento `result` (a precio de lista). En el piloto, el Opus de las transcripciones coincide al céntimo con el de `modelUsage`. La diferencia que queda es Haiku, que Claude Code usa para llamadas auxiliares suyas (menos de 0,001 $ por ejecución).
  - **Codex:** se leen los rollouts del hilo principal y de sus descendientes (`session_meta.parent_thread_id`), que se copian a la carpeta de la ejecución. El hijo empieza con una copia de la historia del padre (con `fork_turns: "all"`, el valor por defecto), así que solo cuenta lo que viene después de `subagent_history_start_ordinal`.
  - **OpenCode:** cada ejecución tiene su propia configuración y su propio `opencode.db` (`XDG_CONFIG_HOME` y `XDG_DATA_HOME`), y el consumo de cada sesión hija sale de `session_v2`.
- **Coste:** `runner/costes.py` con `analisis/precios.json` (precios públicos tomados el 18 de noviembre). Para Claude Code se usa su `costUSD`, y para Codex y OpenCode, la tabla.
- **Corrección:** `runner/calificar.py` es la de validación, con los mismos tests ocultos (`ocultos/`) y las mismas referencias (`referencias/`). En el caso 2, el gate se pasa una vez y los tests ocultos de cada feature, por separado. `referencias/caso2-combinada/` junta las tres referencias del caso 2 en un mismo repositorio y pasa los tests ocultos de las tres (120 de 120): las tres features se pueden tener a la vez sin que se pisen los tests.
- **Caso 3:** la skill (`caso3/SKILL.md`) es el "Cómo se trabaja una feature" del `AGENTS.md` del club, y en el caso 3 ese apartado del `AGENTS.md` se cambia por una línea que manda a la skill (`caso3/AGENTS.md`), para que el procedimiento llegue solo por la skill. Cada herramienta la recibe en su sitio (`.claude/skills/`, `.agents/skills/`, `.opencode/skills/`). En P y B, el subagente `implementador` se define en el formato de cada una (`caso3/agentes/`) con el modelo de la condición. El encargo de P y el de B son el mismo texto: solo cambia el modelo del fichero del subagente.
- **Encargos:** `runner/prompts.py`.
- **Lote:** `runner/lote.py`, reanudable, con un límite de ejecuciones simultáneas por herramienta, `AJENO` para los fallos de cuota, red o autenticación (no se guardan y se repiten al relanzar) y `--tope-usd` para no empezar ejecuciones nuevas a partir de un gasto.

## Cambios tras el piloto (18 de noviembre)

El piloto (`resultados/piloto/`) no entra en los resultados. Se cortó con `--tope-usd 7`: costó 12,71 $ a precio de API (lo que ya estaba en marcha terminó) y quedaron sin lanzar siete ejecuciones del caso 3 (Claude B, Codex S, P y B y OpenCode P y B). Los subagentes definidos con su modelo sí se comprobaron antes en las tres herramientas con una prueba de humo: Claude Code lanzó el suyo en Haiku 5.5, Codex en gpt-6-luna y OpenCode en DeepSeek V4.1 Flash, los tres con la skill cargada.

Lo que cambia, y por qué:

- **Desactivar los subagentes en Codex.** `--disable multi_agent_v2 --disable multi_agent` (la tabla del diseño) no basta con gpt-6.1-sol: el catálogo de modelos que descarga Codex marca el modelo con `multi_agent_version = "v2"` y le vuelve a dar `spawn_agent`, que el modelo usó en una prueba en la que se le pidió delegar. En "sin subagentes" se pasan esos dos flags y, además, una copia del catálogo del día con ese campo vacío (`-c model_catalog_json=…`). Con eso, Codex deja los subagentes desactivados (`turn_context.multi_agent_version = "disabled"`) y no ofrece las herramientas de colaboración. En "con subagentes", lo de serie.
- **Los subagentes definidos de Codex (caso 3).** Codex solo carga `.codex/agents/` si la carpeta de trabajo es de confianza, y no valen `-c projects…` ni la confianza de una carpeta superior. El runner añade la entrada de cada carpeta del caso 3 a `config.toml`. Con ella, `spawn_agent` admite `agent_type: "implementador"` y el hijo corre con el modelo del fichero.
- **Claude Code sin `Workflow`.** En las dos condiciones se quita la herramienta `Workflow` (flujos de muchos agentes, que el diseño deja fuera). "Sin subagentes" quita `Agent`, `Task`, `SendMessage` y `TaskStop`. A diferencia de validación, no se pasa `--disable-slash-commands`, porque desactiva las skills y el caso 3 las necesita: Claude Code ve las skills de serie que trae y la del proyecto, no las del usuario.
- **El encargo del caso 1 se acota al código JavaScript y TypeScript** (`.ts`, `.tsx`, `.js`, `.mjs` y `.cjs`). En el piloto, las seis ejecuciones dieron también entre 6 y 19 variables de GitHub Actions, docker-compose y scripts de shell (`PATH`, `GITHUB_OUTPUT`, `POSTGRES_USER`…). No son inventadas, pero la referencia no las cubre y el encargo no decía si contaban. Ahora lo dice.
- **La versión de cada herramienta se anota justo antes de lanzarla.** OpenCode se actualizó a la 2.3.2 a mitad del piloto: las dos ejecuciones del caso 1 de OpenCode arrancaron con la 2.3.0 y el runner, que miraba la versión al terminar, anotó la 2.3.2. Está corregido a mano en esos dos resultados. El caso 3 S de OpenCode también corrió con la 2.3.0. Las demás de OpenCode, con la 2.3.2. No se repiten: los cambios entre las dos son mínimos.

Lo que no cambia, aunque conviene tenerlo en cuenta al leer los resultados:

- **El caso 1 sale fácil para la calidad.** Las seis ejecuciones del piloto encontraron las 83 variables y los 168 pares, sin inventar ninguna, con subagentes y sin ellos. Lo que distingue a las condiciones es el coste, el tiempo y el contexto del principal, que es lo que pregunta el caso.
- **En el caso 2, el criterio "lo demás no cambia" de una feature caza cambios de otra.** Las dos ejecuciones de OpenCode suspendieron el C10 de `exportar-csv` (`GET /api/reservas` responde distinto que en la base) porque su `codigos-descuento` añade campos también a las reservas de la semilla, cosa que su spec no pide. Es un fallo de verdad, pero cae en otra feature. Se cuenta como dice el diseño (una feature está completa si pasan todos sus criterios), y en el análisis se apunta aparte cuando el criterio que falla es el de "sin cambios".

### Lo que salió en el piloto

Una ejecución por herramienta y condición. Coste a precio de API, contexto del principal al terminar en tokens.

| Ejecución | Versión | Minutos | Coste | Subagentes | Contexto final | Resultado |
|---|---|---|---|---|---|---|
| Caso 1, Claude A | 2.1.327 | 2,8 | 1,06 $ | 0 | 86.540 | 83/83, 0 inventadas |
| Caso 1, Claude B | 2.1.327 | 3,1 | 2,31 $ | 5 (Explore, en Opus 5.5) | 60.497 | 83/83, 0 inventadas |
| Caso 1, Codex A | 0.170.0 | 3,1 | 0,30 $ | 0 | 85.029 | 83/83, 0 inventadas |
| Caso 1, Codex B | 0.170.0 | 4,8 | 0,66 $ | 3 (gpt-6.1-sol) | 27.581 | 83/83, 0 inventadas |
| Caso 1, OpenCode A | 2.3.0 | 6,7 | 0,18 $ | 0 | 110.032 | 83/83, 0 inventadas |
| Caso 1, OpenCode B | 2.3.0 | 12,6 | 0,60 $ | 6 (explore, en V4 Pro) | 83.782 | 83/83, 0 inventadas |
| Caso 2, Claude A | 2.1.327 | 5,2 | 1,60 $ | 0 | 89.200 | 3/3, gate en verde |
| Caso 2, Claude B | 2.1.327 | 4,2 | 2,76 $ | 3 (en segundo plano, Opus 5.5) | 53.866 | 3/3, gate en verde |
| Caso 2, Codex A | 0.170.0 | 5,3 | 0,28 $ | 0 | 56.412 | 3/3, gate en verde |
| Caso 2, Codex B | 0.170.0 | 3,3 | 0,64 $ | 3 (gpt-6.1-sol) | 58.115 | 3/3, gate en verde |
| Caso 2, OpenCode A | 2.3.2 | 15,0 | 0,30 $ | 0 | 121.283 | 2/3 (C10 de exportar-csv), gate en verde |
| Caso 2, OpenCode B | 2.3.2 | 15,7 | 0,56 $ | 3 (V4 Pro) | 61.615 | 2/3 (C10 de exportar-csv), gate en verde |
| Caso 3 `reembolsos`, Claude S | 2.1.327 | 2,1 | 0,69 $ | 0 (skill cargada) | 62.275 | completa, 9/9 |
| Caso 3 `reembolsos`, Claude P | 2.1.327 | 2,4 | 0,77 $ | 1 (`implementador`, Opus 5.5) | 33.214 | completa, 9/9 |
| Caso 3 `reembolsos`, OpenCode S | 2.3.0 | 11,9 | 0,19 $ | 0 (skill cargada) | 62.623 | completa, 9/9 |

Comprobado en cada ejecución: hay subagentes cuando la condición los pide y ninguno cuando no, y en Claude P el subagente corre con el modelo de su fichero. Por lo que se vio, cada herramienta usa de serie su modelo principal en los subagentes (Claude Code también en Explore), y Codex les pasa toda la conversación (`fork_turns: "all"`).

## Resultados del lote (18 de noviembre)

72 ejecuciones, 40,58 $ a precio de API (0 $ reales: suscripciones y créditos de NaN). Se regeneran con `python3 -I analisis/resumen.py lote`, que escribe `analisis/resumen-lote.json` y esta tabla (`analisis/resumen-lote.md`). Condiciones: A sin subagentes y B con ellos en los casos 1 y 2. En el caso 3, S skill, P subagente con el modelo principal y B subagente con el modelo barato.

| Caso | Herramienta | Condición | n | Coste (mediana) | Tiempo (mediana) | Contexto final del principal (mediana) | Subagentes | Resultado |
|---|---|---|---|---|---|---|---|---|
| 1 | Claude Code | A | 3 | 0,66 $ | 116 s | 59.984 | 0/0/0 | 83/83 err=0 inv=0; 83/83 err=0 inv=0; 83/83 err=0 inv=0 |
| 1 | Claude Code | B | 3 | 1,54 $ | 174 s | 52.928 | 5/3/4 | 83/83 err=0 inv=0; 83/83 err=0 inv=0; 83/83 err=0 inv=0 |
| 1 | Codex | A | 3 | 0,18 $ | 155 s | 57.039 | 0/0/0 | 83/83 err=0 inv=0; 83/83 err=0 inv=0; 83/83 err=0 inv=0 |
| 1 | Codex | B | 3 | 0,64 $ | 256 s | 33.834 | 3/3/3 | 83/83 err=0 inv=0; 83/83 err=0 inv=0; 83/83 err=0 inv=0 |
| 1 | OpenCode | A | 3 | 0,17 $ | 452 s | 94.921 | 0/0/0 | 83/83 err=0 inv=0; 83/83 err=0 inv=0; 83/83 err=0 inv=0 |
| 1 | OpenCode | B | 3 | 0,55 $ | 991 s | 86.662 | 8/5/6 | 83/83 err=0 inv=0; 83/83 err=0 inv=0; 83/83 err=0 inv=0 |
| 2 | Claude Code | A | 3 | 1,69 $ | 343 s | 95.343 | 0/0/0 | 3/3 completas, 3/3 completas, 3/3 completas |
| 2 | Claude Code | B | 3 | 2,64 $ | 221 s | 55.368 | 3/3/3 | 3/3 completas, 2/3 completas, 2/3 completas |
| 2 | Codex | A | 3 | 0,23 $ | 315 s | 55.194 | 0/0/0 | 3/3 completas, 3/3 completas, 3/3 completas |
| 2 | Codex | B | 3 | 0,77 $ | 208 s | 56.072 | 3/3/3 | 3/3 completas, 3/3 completas, 3/3 completas |
| 2 | OpenCode | A | 3 | 0,24 $ | 694 s | 112.798 | 0/0/0 | 3/3 completas, 2/3 completas, 2/3 completas |
| 2 | OpenCode | B | 3 | 0,57 $ | 1026 s | 61.832 | 3/3/3 | 3/3 completas, 2/3 completas, 3/3 completas |
| 3 | Claude Code | B | 4 | 0,21 $ | 264 s | 32.782 | 1/1/1/1 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | Claude Code | P | 4 | 0,86 $ | 172 s | 33.218 | 1/1/1/1 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | Claude Code | S | 4 | 0,74 $ | 142 s | 62.936 | 0/0/0/0 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | Codex | B | 4 | 0,10 $ | 217 s | 18.772 | 1/1/1/1 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | Codex | P | 4 | 0,29 $ | 210 s | 19.994 | 1/1/1/1 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | Codex | S | 4 | 0,17 $ | 159 s | 37.847 | 0/0/0/0 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | OpenCode | B | 4 | 0,03 $ | 198 s | 7.586 | 1/1/1/1 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |
| 3 | OpenCode | P | 4 | 0,13 $ | 438 s | 8.242 | 1/1/1/1 | 1/1 completas, 0/1 completas, 1/1 completas, 1/1 completas |
| 3 | OpenCode | S | 4 | 0,13 $ | 385 s | 66.096 | 0/0/0/0 | 1/1 completas, 1/1 completas, 1/1 completas, 1/1 completas |

Lo principal:

- **Caso 1.** Las 18 ejecuciones aciertan las 83 variables. Con subagentes cuesta 2,3 veces más en Claude Code, 3,6 en Codex y 3,2 en OpenCode, y tarda más en las tres. El contexto final del principal baja mucho en Codex (57K a 34K) y poco en las otras dos. Los subagentes se llevan entre el 56 % y el 67 % del gasto. Sin subagentes, el principal no pasa de unos 95K, por debajo del umbral de 100K de The Infinity.
- **Caso 2.** En paralelo, Claude Code y Codex terminan en torno a un 35 % antes. OpenCode tarda más. El coste sube 1,6 veces en Claude Code, 3,3 en Codex y 2,4 en OpenCode. Codex completa 9/9 features en las dos condiciones. Claude Code completa 9/9 sin subagentes y 7/9 con ellos: las dos veces falla el C10 de `exportar-csv` porque el subagente de `codigos-descuento` añade `importeBase` y `descuento` a todas las reservas. OpenCode falla ese C10 también sin subagentes (2 de 3), y con subagentes falla una vez el C3 de `codigos-descuento`.
- **Caso 3.** Todas las ejecuciones pasan el gate. Con el modelo barato, el subagente cuesta un 71 % menos que la skill en Claude Code, un 41 % menos en Codex y un 73 % menos en OpenCode, y completa los 4 encargos en las tres. Con el mismo modelo cuesta un 16 % más en Claude Code, un 74 % más en Codex y lo mismo en OpenCode.
- **El fallo de `c3-opencode-P-duraciones-r2`.** El principal lanzó el subagente y cerró su turno a los 14 s ("quedo a la espera"), aunque el encargo le pedía esperar. El subagente siguió en segundo plano y el runner mató la ejecución a los 750 s por silencio (`rc = estancado`, límite de 12 min sin salida). Queda con 1/12 criterios. El corte es del runner, pero el comportamiento del principal es de OpenCode y se cuenta como fallo.

### Sondas

`analisis/sondas/anidar.py` comprueba si un subagente puede lanzar otro (18-nov, resultados en `analisis/sondas/resultados/`). En Codex 0.170.0 sí: el subagente lanzó otro con `depth: 2` y devolvió PING. En OpenCode 2.3.2, el subagente `general` no tiene la herramienta `subagent` y responde SIN_HERRAMIENTA. En las bases de datos de OpenCode del lote se ve además que lanza los subagentes a la vez, hasta 8 en el caso 1.

## Cómo se ejecuta

```sh
cd club && npm install && cd ..
# El lote del diseño: casos 1 y 2 con 3 repeticiones, caso 3 con reembolsos y duraciones y 2 repeticiones (72 ejecuciones).
LAB_SCRATCH=/var/tmp/lab-subagentes oprun python3 -I runner/lote.py lote --hilos 6 --claude 2 --codex 2 --opencode 2
```

El piloto se lanzó con `runner/lote.py piloto --reps 1 --reps-caso3 1 --encargos-caso3 reembolsos --tope-usd 7`.
