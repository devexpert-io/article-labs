# Validación lab

Experimento del artículo de DevExpert sobre cómo validar el trabajo de un agente de programación (noviembre de 2026). La pregunta: ¿compensa añadir un validador de IA al flujo, o con los modelos potentes es gastar tokens? ¿Cambia la respuesta según lo potente que sea el modelo que implementa?

> **Estado:** diseño fijado el 14 de noviembre de 2026, antes de lanzar el lote completo. Esta sección no se toca después de ver los datos. Los resultados irán en su propia sección.

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
LAB_SCRATCH=/var/tmp/lab-validacion oprun python3 -I runner/lote.py <lote> \
  --encargos exportar-csv,codigos-descuento,lista-espera,reembolsos \
  --configs opus,sol,haiku,luna,deepseek --reps 3
```

Antes hay que preparar `$LAB_SCRATCH/codex-home` (un `config.toml` mínimo y tu `auth.json`) y `$LAB_SCRATCH/home-oc/.config/opencode/opencode.json` (el proveedor de NaN). Los resultados de cada cadena quedan en `resultados/<lote>/<cadena>.json`, con los diffs de lo que entregó cada agente.

## Límites

- Los encargos, las specs y los tests ocultos son nuestros. Un test oculto puede dejarse algo, y un validador puede tener razón en algo que los tests no miran: por eso se revisan a mano las falsas alarmas.
- Es un proyecto pequeño (unas 700 líneas) y un solo protocolo de validación. Con proyectos grandes o con otro protocolo, los números pueden cambiar.
- Los costes son a precio de API. Con suscripción, lo que se gasta es cuota.
