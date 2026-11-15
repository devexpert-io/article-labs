# Validación lab

Experimento del artículo de DevExpert sobre cómo validar el trabajo de un agente de programación (noviembre de 2026). La pregunta: ¿compensa añadir un validador de IA al flujo, o con los modelos potentes es gastar tokens? ¿Cambia la respuesta según lo potente que sea el modelo que implementa?

> **Estado:** diseño fijado el 14 de noviembre de 2026, antes de lanzar el lote completo. Esta sección no se toca después de ver los datos. Los resultados irán en su propia sección.
>
> **Resultados:** el lote completo terminó el 15 de noviembre. Ver [Resultados](#resultados).

## Diseño

### El proyecto y los encargos

`club/` es la API de reservas de un club de pádel (TypeScript, Node 26, estado en memoria con una semilla determinista), con un harness mínimo: un `AGENTS.md` que dice cómo se trabaja una feature (leer la spec entera, implementar solo lo que pide, añadir tests, actualizar el README y pasar `npm run check`) y una spec por feature en `club/docs/specs/`.

Siete encargos, cada uno con su spec y entre 9 y 13 criterios de aceptación. Son features como las de cualquier proyecto, sin trampas. Los tres difíciles se añadieron tras el piloto (ver "Cambios tras el piloto"):

| Encargo | Dificultad | Qué pide |
|---|---|---|
| `exportar-csv` | normal | Exportar las reservas de un periodo a CSV, solo para gestores |
| `codigos-descuento` | normal | Tres códigos de descuento al reservar, con sus condiciones |
| `lista-espera` | normal | Lista de espera de franjas con asignación automática al cancelar |
| `reembolsos` | normal | Penalizaciones escalonadas por antelación (con el cambio de hora), exención de gestor e informe de caja |
| `duraciones` | difícil | Reservas de 60, 90 o 120 minutos sin romper las de siempre: solapes, disponibilidad y precio por minutos |
| `reservas-fijas` | difícil | Series semanales que crea la recepción, con semanas saltadas, descuento y cancelación de la serie |
| `facturas` | difícil | Una factura por socio y mes, con numeración correlativa por año e IVA redondeado por factura |

### Quién implementa

| Configuración | Agente | Modelo | Nivel |
|---|---|---|---|
| `opus` | Claude Code 2.1.325 | Opus 5.5 | frontera |
| `sol` | Codex CLI 0.169.0 | gpt-6.1-sol, razonamiento medio | frontera |
| `haiku` | Claude Code 2.1.325 | Haiku 5.5 | barato |
| `luna` | Codex CLI 0.169.0 | gpt-6-luna, razonamiento medio | barato |
| `deepseek` | OpenCode 2.3.0 | DeepSeek V4 Flash (NaN Builders) | barato |

Cada agente se ejecuta sin la configuración de su usuario (ni instrucciones globales, ni skills, ni MCP) y dentro de una caja que solo le deja escribir en su carpeta de trabajo (ver "Aislamiento").

### Las condiciones

Cada implementación se corrige tal como la entrega el agente y, a partir de esa misma implementación, se prueban las condiciones:

- **A, sin validador:** lo que entrega el agente cuando dice que ha terminado. El gate determinista (tipos y tests) está en todas las condiciones, porque el `AGENTS.md` pide pasarlo antes de terminar: lo que se mide es lo que añade un validador de IA por encima del gate.
- **B, validador del mismo modelo en una sesión limpia:** recibe el protocolo de validación (`runner/prompts.py`, adaptado de la skill `feature-validator` que usamos en DevExpert) y da un veredicto `accept`, `revise` o `block`, criterio a criterio y con un brief de reparación. Si no acepta, una sesión nueva del mismo modelo arregla lo que pide el brief y se vuelve a validar. Como mucho, dos reparaciones.
- **C, validador potente (solo `haiku` y `luna`):** el mismo bucle, pero valida el modelo frontera de su mismo agente (Opus valida a Haiku y gpt-6.1-sol valida a gpt-6-luna). Repara el modelo barato.
- **D, la misma sesión:** se reanuda la sesión que implementó y se le da el mismo protocolo de validación. Solo se mide lo que detecta, sin reparar. Sirve para comparar el validador en la misma sesión con el validador en una sesión limpia (la primera validación de B).

Repeticiones: 2 por combinación en los encargos normales y 3 en los difíciles (4 × 5 × 2 + 3 × 5 × 3 = 85 implementaciones).

### La verdad de referencia

Los tests ocultos de `ocultos/<encargo>/`: tests de caja negra contra la API, uno o varios por criterio de aceptación, que el agente no ve nunca. Un criterio se da por cumplido si pasan todos sus tests, y un encargo está **completo** si se cumplen todos sus criterios. Para cada encargo hay una implementación de referencia en `referencias/<encargo>/` que los pasa todos, y la base los suspende salvo los de "lo demás no cambia".

## Cambios tras el piloto (14 de noviembre)

El piloto (`resultados/piloto/`: `exportar-csv` y `lista-espera`, una repetición, las cinco configuraciones y las cuatro condiciones) se usó solo para calibrar y no entra en los resultados. Lo que cambió después, antes de lanzar el lote completo:

- **Encargos difíciles.** Las diez implementaciones del piloto salieron completas, también las de los modelos baratos, en entre 1,5 y 4 minutos. Sin fallos no hay nada que validar, así que se añadieron tres encargos más difíciles, de los que tocan varias partes del sistema o cruzan reglas: `duraciones` (reservas de 60, 90 o 120 minutos, con solapes, disponibilidad y precio por minutos), `reservas-fijas` (series semanales que crea la recepción, con semanas saltadas, descuento y cancelación de la serie) y `facturas` (una factura por socio y mes, con numeración correlativa por año e IVA redondeado por factura). Los cuatro primeros se quedan como encargos normales.
- **Un test de `exportar-csv` era más estricto que la spec.** Exigía conservar un salto de línea LF dentro de un campo entre comillas, y el RFC 4180 admite CR, LF o CRLF. Ahora acepta los tres.
- **Tests que fallan por carga.** En el piloto, un test de `lista-espera` falló una vez sobre un código que lo pasa en todas las demás corridas, con la máquina cargada. Ahora, si falla algún test oculto, se repite la corrida, y un test cuenta como pasado si pasa en alguna de las dos. Los que cambian entre corridas quedan apuntados como `inestables`.
- **Tokens de Claude Code.** Se toman del resultado final de cada ejecución, porque los mensajes intermedios del stream llevan el uso parcial.

El piloto de los difíciles (`resultados/piloto-dificil/`: los tres encargos, una repetición, las cinco configuraciones) tampoco entra en los resultados. Salieron completas 14 de las 15 implementaciones. Con eso basta para lanzar el lote, así que el diseño no cambia. Solo cambia el runner:

- **Fallos ajenos al agente.** Si una ejecución falla por la cuota, el límite de uso, la red o la autenticación, la cadena se corta, se anota como `AJENO` y no se guarda como terminada. No es un dato del experimento: al relanzar el lote, se repite entera.
- **Versiones fijas.** Claude Code corre con `DISABLE_AUTOUPDATER=1` y OpenCode con `autoupdate: false`, para que ninguno cambie de versión a mitad de lote. Cada ejecución de Claude guarda además cuánta cuota llevaba gastada la cuenta, para planificar los lotes.

## Qué se mide

**Principal**, por configuración:

1. Encargos completos sin validador (A) y al final de B y de C.
2. Lo que cuesta validar: coste extra de validar y reparar (en dólares a precio de API) y minutos extra, y el coste por encargo arreglado.

**Secundario:**

- Detección: de los criterios que fallan en el estado que se valida, cuántos marca el validador como `no_cumple` o `sin_evidencia`.
- Falsas alarmas: criterios que el validador marca como `no_cumple` y que sí se cumplen.
- Veredictos `accept` con fallos dentro.
- Reparaciones que estropean un criterio que estaba bien.
- La misma sesión (D) frente a una sesión limpia (primera validación de B).
- Si el validador edita código aunque se le pide que no lo haga.

### Qué cuenta como "compensa"

Fijado antes de ver los datos:

- **Compensa** en una configuración si el validador convierte al menos 2 de sus encargos incompletos en completos, sin estropear ninguno que estuviera completo. Se mira por separado en los encargos normales (8 por configuración) y en los difíciles (9).
- **No compensa** si arregla 0 o 1, o si estropea tantos como arregla. En ese caso, el coste de validar es gasto.
- Además del veredicto, se da el coste por encargo arreglado y el porcentaje de coste extra, porque si compensa o no en dinero depende de lo que cueste un fallo que llega a producción en cada equipo.

Con 8 o 9 encargos por configuración y dificultad no hay potencia para pruebas estadísticas: es una medición orientativa, no un benchmark.

## Aislamiento

- **Claude Code:** `--setting-sources project,local --strict-mcp-config --disable-slash-commands`, sin acceso de lectura a los repos de la máquina. Su sandbox no arranca en este Linux (no puede aplicar su filtro seccomp en un namespace de usuario anidado), así que se desactiva y el proceso entero va en bubblewrap.
- **Codex:** `CODEX_HOME` y `HOME` limpios, `sandbox_mode = "workspace-write"` con red y `approval_policy = "never"`.
- **OpenCode:** `HOME` y `XDG_*` limpios dentro de bubblewrap, con `--standalone --auto --archived`.
- **Bubblewrap:** el sistema en solo lectura, `/tmp` propio, escritura solo en la carpeta de trabajo y en la configuración del agente, y sin ver los repos ni las claves del usuario.
- Los agentes no reciben ninguna clave en el entorno, salvo OpenCode, que recibe solo la de NaN.
- Los tests ocultos se copian junto al estado justo antes de corregir, en una carpeta temporal, y se borran después. El gate y los tests ocultos también corren en bubblewrap.

## Cómo se ejecuta

```sh
cd club && npm install && cd ..
LAB_SCRATCH=/var/tmp/lab-validacion oprun python3 -I runner/lote.py completo \
  --encargos exportar-csv,codigos-descuento,lista-espera,reembolsos,duraciones,reservas-fijas,facturas \
  --configs opus,sol,haiku,luna,deepseek --reps 2 --reps-dificiles 3 --hilos 8
python3 -I analisis/analizar.py completo
```

La revisión a mano y la vara ampliada, que se hicieron después:

```sh
python3 -I analisis/revision/paquetes.py analisis/revision/paquetes   # los hallazgos que había que revisar
python3 -I analisis/revision/agregar.py                               # el recuento de las clasificaciones
for e in codigos-descuento duraciones exportar-csv facturas lista-espera reservas-fijas; do
  LAB_SCRATCH=/var/tmp/lab-validacion python3 -I analisis/ampliar.py $e ocultos-ampliados/$e.test.ts analisis/ampliados/$e.json
done
python3 -I analisis/agregar_ampliados.py mayor                        # o todas
LAB_SCRATCH=/var/tmp/lab-validacion python3 -I analisis/semilla/comparar.py   # ¿alguien tocó la semilla?
```

`ampliar.py` y `comparar.py` corren contra las carpetas de cada ejecución en `$LAB_SCRATCH`. Sin ellas, cada estado se puede reconstruir aplicando a `club/` su diff de `resultados/completo/<cadena>/`.

Antes hay que preparar `$LAB_SCRATCH/codex-home` (un `config.toml` mínimo y tu `auth.json`) y `$LAB_SCRATCH/home-oc/.config/opencode/opencode.json` (el proveedor de NaN). Los resultados de cada cadena quedan en `resultados/<lote>/<cadena>.json`, con los diffs de lo que entregó cada agente.

## Resultados

Lote `completo`, del 14 de noviembre a las 23:06 al 15 a la 1:57: 85 cadenas, ninguna cortada por cuota, red o autenticación. Claude Code no cambió de versión en ninguna de sus 171 ejecuciones (2.1.325). El coste total, a precio de API, fue de 61,81 $ (Claude 42,32 $, Codex 13,41 $ y OpenCode 6,08 $). Las tablas completas, por dificultad y cadena a cadena, están en `analisis/completo.md`.

### Encargos completos

| Config | Nivel | Sin validador (A) | Al final de B | Al final de C |
|---|---|---|---|---|
| `opus` | frontera | 16 de 17 | 16 | — |
| `sol` | frontera | 17 de 17 | 17 | — |
| `haiku` | barato | 17 de 17 | 17 | 17 |
| `luna` | barato | 14 de 17 | 14 | 17 |
| `deepseek` | barato | 17 de 17 | 17 | — |

- Sin validador salieron completas 81 de las 85 implementaciones. Las cuatro incompletas son de `reservas-fijas` y fallan en el mismo criterio, el 8: la respuesta de `POST /api/series` trae las reservas completas en lugar de sus ids. Una de Luna falla además el 6, porque las reservas de la serie contaban para el límite de 3 reservas futuras.
- El validador del mismo modelo (B) no arregló ninguna. El de Opus aceptó su trabajo con el fallo dentro. El de Luna marcó 1 de los 4 criterios que fallaban (el 6) y no vio nunca el 8.
- El validador potente (C, gpt-6.1-sol sobre Luna) marcó los 4 en su primera validación, y las reparaciones de Luna dejaron completos los tres encargos.
- La misma sesión (D) detectó lo mismo que B: 0 de 1 con Opus y 1 de 4 con Luna.
- Ninguna reparación estropeó un criterio que estuviera bien.

### ¿Compensa?

Con la regla fijada antes de ver los datos, compensa en una sola combinación: el validador potente sobre Luna en los encargos difíciles, que arregla 3 y no estropea ninguno. En las demás, o no había nada que arreglar, o el validador no lo arregló.

### Lo que cuesta

| Config | Implementar, por encargo | B, coste extra | C, coste extra |
|---|---|---|---|
| `opus` | 0,76 $ | 10,33 $ (+80 %) | — |
| `sol` | 0,14 $ | 3,06 $ (+130 %) | — |
| `haiku` | 0,07 $ | 1,15 $ (+97 %) | 10,04 $ (+846 %) |
| `luna` | 0,009 $ | 0,28 $ (+173 %) | 5,43 $ (+3.399 %) |
| `deepseek` | 0,10 $ | 2,31 $ (+135 %) | — |

El coste extra es lo que cuesta validar y reparar en los 17 encargos, y el porcentaje, sobre lo que costó implementarlos.

- Luna con el validador potente costó 5,59 $ por los 17 encargos y los dejó todos completos. Sol solo costó 2,35 $, con los 17 completos a la primera. Y Haiku solo, 1,19 $, también con los 17 completos.
- Validar en la misma sesión (D) sale más barato o más caro según el modelo. Con Opus cuesta 0,31 $ por validación, frente a 0,48 $ en una sesión limpia. Con Haiku y DeepSeek sale más caro (0,08 $ frente a 0,02 $, y 0,12 $ frente a 0,08 $). Con Sol y Luna cuesta casi lo mismo. La sesión reanudada arrastra todo el contexto de la implementación: a Opus se lo abarata la caché, y DeepSeek, que en nuestra tabla de precios no tiene descuento por caché, lo paga entero.

### Peticiones de cambio en trabajo completo

Los validadores pidieron cambios 102 veces sobre estados que los tests ocultos daban por completos, con 222 hallazgos. Los revisamos uno a uno, con cinco revisores (Claude Opus 5.5, uno por encargo o por pareja de encargos): cada hallazgo se comprobó con una prueba contra el estado validado y contra la base, o leyendo el código. Las instrucciones, las clasificaciones y las pruebas están en `analisis/revision/`.

| Categoría | Hallazgos | Qué es |
|---|---|---|
| Defecto | 80 (36 %) | El validador tenía razón: el estado no cumple la spec en algo que los tests ocultos no miran |
| De más | 111 (50 %) | La spec no lo pide: validaciones extra, casos que deja abiertos, más tests, retoques del README |
| Previo | 23 (10 %) | Es real, pero la base ya era así y la spec no pide cambiarlo |
| Error | 7 (3 %) | Lo que dice el validador es falso |
| Ambigua | 1 | La spec admite las dos lecturas |

- **Los 80 defectos son 50 fallos distintos,** porque varios validadores señalaron el mismo. 35 son de comportamiento, 12 son tests que faltan y 3 son del README.
- **Casi todos son casos límite:** fechas u horas imposibles (el 30 de febrero, las 10:60, el mes 13), un código de descuento vacío o el año 9999. Pero hay alguno serio. Una implementación de Luna (`facturas-luna-r1`) se inventó una penalización en el historial de la semilla y la factura de octubre de un socio salía por 192 € en lugar de 180 €. Los tests ocultos no lo ven porque calculan lo esperado con el `/_estado` de la propia implementación.

Cuántas peticiones de cambio sobre trabajo completo llevaban al menos un defecto real:

| Implementa | Valida | Condición | Peticiones | Con algún defecto |
|---|---|---|---|---|
| `opus` | `opus` | B | 4 | 3 |
| `opus` | `opus` | D | 1 | 0 |
| `sol` | `sol` | B | 3 | 0 |
| `sol` | `sol` | D | 6 | 1 |
| `haiku` | `haiku` | B | 19 | 9 |
| `haiku` | `haiku` | D | 10 | 6 |
| `haiku` | `opus` | C | 5 | 5 |
| `luna` | `luna` | B | 19 | 11 |
| `luna` | `luna` | D | 7 | 5 |
| `luna` | `sol` | C | 20 | 15 |
| `deepseek` | `deepseek` | B | 6 | 5 |
| `deepseek` | `deepseek` | D | 2 | 2 |

**Reparaciones que estropearon algo que los tests no miran:**
- **`reservas-fijas-opus-r1` (B):** la primera reparación cambió también las reservas normales, que es lo que la spec pide no tocar. La segunda lo deshizo.
- **`lista-espera-haiku-r1` (B):** una falsa alarma llevó a una reparación que creaba reservas en pistas cerradas. La siguiente ronda lo vio y lo deshizo.
- **`codigos-descuento-luna-r1` (B):** para que pasaran sus tests, la segunda reparación metió en la semilla un socio de prueba con tres reservas. Se queda en el estado final.
- **`exportar-csv-deepseek-r2` (B):** la reparación pone un apóstrofo delante de las notas que empiezan por `=`, `+`, `-` o `@`, así que cambia los datos exportados. Se queda en el estado final.
- **`lista-espera-luna-r2` (C):** la reparación de la pista cerrada abrió un fallo nuevo del criterio 3.
- **El cambio de hora en `reservas-fijas`:** en 7 estados finales (B de deepseek-r3, luna-r1 y las tres de sol, y C de luna-r2 y luna-r3), cancelar la serie cuenta horas reales y cancelar la reserva sola sigue con horas de reloj, como la base. La misma reserva sale gratis o queda pendiente según cómo se cancele. En `luna-r2` (B), la reparación cambió además la regla de todo el club.
- **Tres reparaciones editaron la propia spec,** las tres de Haiku en B. Las dos de `lista-espera` (un glosario en r1 y dos criterios reescritos en r2) siguen en el estado final. La de `exportar-csv-haiku-r1` se deshizo en la ronda siguiente.

### Una vara más exigente (después de ver los datos)

Esta parte no estaba en el diseño: la añadimos después de ver los datos, porque la revisión dejaba un sesgo. A Haiku y Luna las miraron tres validadores (D, B y C, y en C uno potente), y a Opus, Sol y DeepSeek solo dos y siempre del mismo modelo. Así, los defectos que aparecían dependían de quién había mirado.

Para corregirlo, los revisores convirtieron cada clase de defecto de comportamiento en un test (`ocultos-ampliados/`, 22 tests en seis encargos) y los pasamos por todos los estados: la implementación, el final de B y el final de C de cada cadena, más la base y la referencia. Los tests ampliados encontraron fallos que ningún validador había visto, también en Opus y en Sol. Reembolsos no tiene ninguno, porque su único defecto de comportamiento no cambia ninguna respuesta de la API.

Un estado está completo con esta vara si cumple los criterios ocultos y pasa los tests ampliados de su encargo. Damos dos versiones (`analisis/ampliados/gravedad.json`):
- **Todos los defectos.**
- **Solo los mayores:** datos equivocados que siempre están ahí (la semilla cambiada), una validación de la base que la feature rompe, un riesgo de seguridad, o un comportamiento equivocado en un caso que puede pasar (cancelar con la pista cerrada, notas que empiezan por un guion). Los menores son los que solo cambian el código de error de una petición que falla igual, los que necesitan una entrada imposible que la base ya aceptaba (el 30 de febrero) y los casos rebuscados (el año 9999, más de 10 000 esperas, cerrar y reabrir la pista entre medias).

Encargos completos de 17, con la regla de "compensa" aplicada igual que antes (por dificultad):

| Config | Mayores: A | B | C | ¿Compensa? | Todos: A | B | C | ¿Compensa? |
|---|---|---|---|---|---|---|---|---|
| `opus` | 15 | 15 | — | no | 10 | 12 | — | B, en difíciles |
| `sol` | 17 | 17 | — | no | 15 | 15 | — | no |
| `haiku` | 14 | 17 | 17 | B y C, en difíciles | 7 | 14 | 11 | B, en los dos, y C, en difíciles |
| `luna` | 10 | 9 | 17 | C, en los dos | 6 | 7 | 16 | C, en los dos |
| `deepseek` | 13 | 14 | — | B, en difíciles | 10 | 12 | — | B, en difíciles |

- **Sol** no tiene ningún defecto mayor, y sus dos menores (la duración sale vacía en una reserva con una fecha imposible) no los arregla su validador.
- **Opus** tiene dos mayores (el criterio 8 de `reservas-fijas` y una hora 99:00 que acepta en `duraciones`) y su validador no arregla ninguno. Con todos los defectos, arregla dos casos de fechas imposibles en las series.
- **Haiku:** su propio validador arregla sus tres mayores (horas como las 10:60, que la base rechazaba), igual que Opus validándola, y cuesta casi nueve veces menos.
- **Luna:** su propio validador no arregla ninguno de sus siete mayores y estropea uno (el socio de prueba en la semilla). Sol validándola los arregla todos.
- **DeepSeek:** su validador arregla dos de sus cuatro mayores y estropea uno (el apóstrofo en las notas).

Lo que cuesta llegar a esos resultados, en los 17 encargos y con los defectos mayores:

| Con qué | Coste | Completos |
|---|---|---|
| Opus solo | 12,98 $ | 15 |
| Haiku solo | 1,19 $ | 14 |
| Haiku y su validador | 2,34 $ | 17 |
| Haiku y Opus validando | 11,23 $ | 17 |
| Sol solo | 2,35 $ | 17 |
| Luna sola | 0,16 $ | 10 |
| Luna y su validador | 0,44 $ | 9 |
| Luna y Sol validando | 5,59 $ | 17 |
| DeepSeek solo | 1,71 $ | 13 |
| DeepSeek y su validador | 4,02 $ | 14 |

Las matrices de cada encargo (estado por test) están en `analisis/ampliados/`.

### Otras cosas que pasaron

- **El gate.** En 1 de las 85 implementaciones, el agente (`codigos-descuento-luna-r1`) dio el trabajo por terminado con `npm run check` en rojo, porque fallaban sus propios tests. Los dos validadores lo vieron y las reparaciones lo arreglaron. Un gate en la integración continua lo habría parado igual.
- **Un gate roto por la carga.** Tras la reparación de `reservas-fijas-sol-r1` (B), el gate falló al corregir. Corregido otra vez tres veces con la máquina en reposo, pasa siempre.
- **Tests inestables.** En 5 estados, algún test oculto falló en la primera pasada y pasó en la segunda. Corregidos otra vez con la máquina en reposo, pasan siempre, así que era la carga y no la implementación.
- **Un validador sin veredicto.** DeepSeek terminó una validación (`lista-espera-deepseek-r2`, B1) anunciando más comprobaciones y sin dar veredicto. Cuenta como validación sin veredicto, y no hubo reparación.
- **Ficheros sueltos.** Opus, como validador, dejó dos veces en la carpeta las salidas de sus pruebas (`o1.json`, `o2.json` y `out.txt`). No tocó código, pero cuenta en la columna "El validador tocó código" de `analisis/completo.md`.

### Correcciones del análisis

- **El coste de D.** D reanuda la sesión que implementó, y al reanudar, Claude Code da el coste de toda la sesión y Codex los tokens de todo el hilo. El análisis contaba ese total como coste de validar. Ahora resta lo que ya había gastado la implementación (`solo_lo_reanudado` en `analisis/analizar.py`), también en los dos pilotos. OpenCode da los tokens de cada ejecución, así que en DeepSeek no cambia nada.

### Lo que limita estos resultados

- Los fallos que ven los tests ocultos están concentrados. Los cinco criterios que fallaron son de un solo encargo, y cuatro son el mismo punto.
- La vara ampliada se escribió después de ver los datos y sale de lo que encontraron los validadores: un defecto que no vio ningún validador ni ningún revisor no está. La revisión y los tests ampliados los hizo Claude Opus 5.5, el mismo modelo que valida en `opus` y en la C de `haiku`. Para que eso pese lo menos posible, cada defecto se comprobó con una prueba contra el estado y contra la base. Dónde va la línea entre defectos mayores y menores es decisión nuestra, y por eso damos las dos versiones.
- El criterio 8 se presta a confusión. La spec dice que una serie lleva los ids de sus reservas y que solo `GET /api/series/:id` las trae completas, pero el criterio dice que el POST responde "con la serie, sus `reservas` y sus `saltadas`". Quien lee la spec entera lo resuelve, y 11 de las 15 implementaciones lo hicieron bien.

## Límites

- Los encargos, las specs y los tests ocultos son nuestros. Un test oculto puede dejarse algo, y un validador puede tener razón en algo que los tests no miran: por eso se revisan a mano las falsas alarmas.
- Es un proyecto pequeño (unas 700 líneas) y un solo protocolo de validación. Con proyectos grandes o con otro protocolo, los números pueden cambiar.
- Los costes son a precio de API. Con suscripción, lo que se gasta es cuota.
