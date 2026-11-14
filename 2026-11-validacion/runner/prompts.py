"""Los tres encargos que reciben los agentes: implementar, validar y reparar.

El de validar es el mismo en las tres condiciones (la misma sesión, una sesión limpia del mismo modelo y una
sesión limpia del modelo potente), para que lo único que cambie sea el contexto y el modelo. Está adaptado de la
skill feature-validator que usamos en DevExpert.
"""
import json


def implementar(encargo: str) -> str:
    return (f"Implementa la feature de `docs/specs/{encargo}.md` siguiendo `AGENTS.md`. "
            "Trabaja de forma autónoma, sin pedirme confirmación. Cuando termines, dime en pocas líneas qué has hecho.")


def validar(encargo: str) -> str:
    return f"""Actúa como validador independiente de la feature `{encargo}`. La spec es `docs/specs/{encargo}.md`. La implementación son los cambios de este repositorio respecto al commit etiquetado `base` (`git diff base`, ficheros nuevos incluidos).

Tu papel:
- Eres el validador, no quien implementa. No te fíes de lo que diga quien implementó ni de que los tests pasen: juzga con la spec, el código y lo que puedas comprobar tú.
- No edites ningún fichero. Si encuentras fallos, descríbelos con su evidencia y di cómo arreglarlos.

Qué hacer:
1. Lee `AGENTS.md`, la spec entera (objetivo, no-objetivos y criterios de aceptación) y el `README.md`.
2. Revisa el diff y los ficheros que cambian.
3. Ejecuta `npm run check` y las comprobaciones que necesites (por ejemplo, arrancar la API y llamarla) para tener evidencia de cada criterio.
4. Decide, criterio a criterio, si se cumple, con evidencia concreta.
5. Revisa también el alcance (los no-objetivos), la seguridad y los permisos, y la documentación.

Veredicto:
- `accept`: cumple la spec entera y tienes evidencia suficiente.
- `revise`: está cerca, pero hay cambios concretos que hacer.
- `block`: no se puede validar o está mal de raíz.

Termina tu respuesta con un único bloque ```json con este formato, con todos los criterios de la spec en orden:

```json
{{
  "veredicto": "accept | revise | block",
  "criterios": [{{"n": 1, "estado": "cumple | no_cumple | sin_evidencia", "evidencia": "…"}}],
  "hallazgos": [{{"gravedad": "alta | media | baja", "criterio": 3, "descripcion": "…", "cambio": "…"}}],
  "brief_reparacion": "Instrucciones ordenadas para quien implementó, que se puedan seguir sin esta conversación. Vacío si el veredicto es accept."
}}
```"""


def reparar(encargo: str, veredicto: dict) -> str:
    hallazgos = json.dumps(veredicto.get("hallazgos", []), ensure_ascii=False, indent=2)
    return f"""Un validador independiente ha revisado la implementación de la feature de `docs/specs/{encargo}.md` que hay en este repositorio y pide cambios.

Su brief de reparación:

{veredicto.get("brief_reparacion") or "(sin brief)"}

Sus hallazgos:

{hallazgos}

Arregla lo que pide. Si crees que algún hallazgo no es correcto, compruébalo contra la spec antes de cambiar nada. Sigue `AGENTS.md` y pasa `npm run check`. Trabaja de forma autónoma, sin pedirme confirmación, y cuando termines dime en pocas líneas qué has cambiado."""
