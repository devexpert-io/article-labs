# Skills lab

Experimento del artículo de DevExpert sobre skills de agentes (diciembre de 2026). Tres preguntas: ¿carga el agente la skill cuando toca, y solo cuando toca? ¿Le ayuda de verdad, y a qué tipo de skill? ¿Puede una skill estorbar a un modelo potente que ya sabe hacer el trabajo?

> **Estado:** diseño fijado el 26 de noviembre de 2026, antes de ejecutar nada salvo las pruebas de humo. Esta sección no se toca después de ver los datos. Si el piloto obliga a cambiar algo, el cambio va en su propia sección ("Cambios tras el piloto") con el motivo.

## Diseño

### Los agentes

| Herramienta | Modelo potente | Modelo barato |
|---|---|---|
| Claude Code 2.1.332 | Opus 5.5 | Haiku 5.5 |
| Codex CLI 0.172.0 | gpt-6.1-sol, razonamiento medio | gpt-6-luna, razonamiento medio |
| OpenCode 2.4.2 | DeepSeek V4 Pro (NaN Builders) | DeepSeek V4.1 Flash 1017 (NaN Builders) |

El modelo barato solo aparece en la parte B, skill 3. Cada agente se ejecuta sin la configuración de su usuario (ni instrucciones globales, ni skills, ni MCP) y dentro de una caja que solo le deja escribir en su carpeta de trabajo, como en el [laboratorio de subagentes](../2026-11-subagentes). La skill va donde la busca cada herramienta: `.claude/skills/` en Claude Code, `.agents/skills/` en Codex y `.opencode/skills/` en OpenCode, con el mismo `SKILL.md`.

### El proyecto

El club de pádel del laboratorio de validación (`club/`: API de reservas en TypeScript con su `AGENTS.md`, sus specs y tests ocultos), con los cambios que pide cada skill.

### Las tres skills

Cada una representa un tipo de skill distinto:

1. **`facturas-gestoria`, conocimiento del equipo que no está en el repo.** Las reglas que pide la gestoría para facturar: qué conceptos entran, cómo se calcula la base y el IVA (sobre el total, con redondeo de medio céntimo hacia arriba) y la numeración `F<año>-NNNN` correlativa por año. La spec de `facturas` deja de traerlas y dice solo "como lo pide la gestoría". Es el caso en el que, según Uber, más ganan las skills: algo que el modelo no puede saber por su cuenta.
2. **`consultas-club`, procedimiento con script.** Un script (`scripts/consulta.mjs`) que responde preguntas sobre la actividad del club (ocupación por franja, ingresos por mes, socios con más penalizaciones) leyendo el estado de la API. La skill dice cuándo usarlo y cómo. El script está en el repo, así que el agente sin skill también puede encontrarlo o escribir su propio código. Es el equivalente a la skill de consultas al almacén de datos de Uber.
3. **`tests-node`, saber genérico que el modelo ya tiene.** Cómo escribir tests con `node:test` y `assert`: un test por criterio, nombres que dicen qué comprueban, casos límite y nada de depender del orden. Se espera que no aporte, o que estorbe. Tiene dos versiones con el mismo contenido: **neutra** (frases normales, "usa X cuando...") y **enfática**, escrita como se escribían las skills para modelos de hace un año (MAYÚSCULAS, ALWAYS, MUST, NEVER, pasos obligatorios numerados).

### Parte A: activación

¿Carga el agente la skill cuando toca, y solo cuando toca?

- **Las peticiones:** por cada skill, 9 peticiones reales: 3 que nombran la tarea ("genera las facturas de octubre para la gestoría"), 3 que la necesitan sin nombrarla ("la gestoría se queja de que el IVA no le cuadra en la de Marta") y 3 parecidas en las que no toca (por ejemplo, cambiar el precio de una franja, que también es dinero pero no factura). Son 27 peticiones, en `activacion/peticiones.json`, fijadas antes del piloto.
- **Dos descripciones por skill:** **vaga** ("Ayuda con las facturas.") y **concreta** (qué hace, cuándo usarla y las palabras que diría quien la necesita). El cuerpo de la skill es el mismo.
- **En cada ejecución están las tres skills** instaladas, con la descripción de la condición, para que el agente tenga que elegir.
- **Qué se mide:** si la skill que toca se carga (verdaderos positivos), si se carga alguna cuando no toca (falsos positivos) y si se carga la equivocada. Se detecta en el registro de cada herramienta: la herramienta `Skill` en Claude Code, la lectura del `SKILL.md` en Codex y la herramienta `skill` en OpenCode.
- **Corte:** la ejecución se para cuando el agente carga una skill o a los 3 minutos, lo que llegue antes. Lo que se mide es la decisión de cargarla, no la tarea entera.
- **Total:** 27 peticiones × 2 descripciones × 3 herramientas × 2 repeticiones = **324 ejecuciones**, con el modelo potente.

### Parte B: efecto

¿Mejora el resultado con la skill? Cada ejecución es un encargo completo, con el modelo potente salvo donde se dice.

| Skill | Encargo | Condiciones |
|---|---|---|
| 1. `facturas-gestoria` | Implementar la spec `facturas` | **sin** (ni skill ni reglas), **skill**, **AGENTS.md** (el mismo texto de la skill pegado en el `AGENTS.md`) |
| 2. `consultas-club` | Responder 4 preguntas sobre la actividad del club de octubre | **sin**, **skill**, **recortada** (la skill con solo la descripción y el comando, sin las explicaciones) |
| 3. `tests-node` | Implementar la spec `reembolsos` con sus tests | **sin**, **neutra**, **enfática**, cada una con el modelo potente y con el barato |

- **Repeticiones:** 3. Total: (3 + 3 + 6) condiciones × 3 herramientas × 3 = **108 ejecuciones**.
- **En las condiciones con skill** solo está instalada la skill del encargo, con su descripción concreta: aquí no se mide la activación, sino el efecto. Si el agente no la carga, se anota y la ejecución cuenta igual (es lo que pasaría de verdad).
- **Qué se mide:**
  - Skill 1: criterios de la spec que pasan con los tests ocultos (la misma vara que en validación).
  - Skill 2: respuestas correctas de 4, contra una referencia sacada del estado de la semilla.
  - Skill 3: criterios que pasan con los tests ocultos, y cuántos de los criterios de la spec cubren los tests que escribe el agente.
  - En todas: llamadas a herramientas, llamadas que fallan, tiempo, tokens y coste.
- **Juez a ciegas por parejas.** Para cada encargo se comparan, por parejas, una ejecución con skill y una sin ella (y la neutra frente a la enfática), sin decirle al juez cuál es cuál. El juez elige la mejor y dice por qué. Cada pareja se juzga dos veces con el orden cambiado, y por dos jueces de familias distintas (Opus 5.5 y gpt-6.1-sol). Antonio califica a mano 12 parejas al azar para medir cuánto acierta cada juez.

### Parte C: fiabilidad de la eval

Con los datos de la parte B, sin ejecuciones nuevas:

- Cuánto cambia la tasa de aprobados de una misma condición entre repeticiones.
- Cuántas veces cambia el veredicto del juez al invertir el orden de la pareja, y cuántas coinciden los dos jueces.
- Cuántas parejas resuelve el juez igual que Antonio.

### Coste

Los tokens se pasan a dólares con el precio público de cada modelo, también en las ejecuciones con suscripción, para poder comparar. La tabla de precios y la fecha en que se tomó van en `analisis/`. Estimación: unos 80 $ a precio de API. El coste real es 0 $: Claude Code y Codex van con suscripción y DeepSeek con la de NaN Builders.

### Lo que no mide

- Skills de terceros ni marketplaces: las tres están escritas para este proyecto.
- Muchas skills a la vez: en la parte A hay tres, y en la B una.
- Skills que se activan desde un hook o que fuerza el usuario con `/nombre`: solo la activación que decide el modelo.
- Tareas largas. Son encargos de minutos.
