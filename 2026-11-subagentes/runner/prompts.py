"""Los encargos de cada caso y condición. Son los mismos en las tres herramientas: "subagente" es la palabra que
usan las tres (la herramienta Agent de Claude Code, spawn_agent de Codex y subagent de OpenCode).

Lo único que cambia entre condiciones de un caso es la frase que pide (o no) delegar. Lo demás, igual.
"""

FORMATO_CASO1 = """Termina tu respuesta con un único bloque ```json con el inventario completo, una entrada por variable:

```json
[{"nombre": "NOMBRE_DE_LA_VARIABLE", "ficheros": ["ruta/relativa/al/repositorio.ts"], "defecto": "valor por defecto o null"}]
```"""


def caso1(condicion: str) -> str:
    # Tras el piloto se acota a los ficheros JavaScript y TypeScript (ver "Cambios tras el piloto" en el README).
    encargo = ("Haz un inventario de todas las variables de entorno que lee el código JavaScript y TypeScript de este "
               "repositorio (ficheros .ts, .tsx, .js, .mjs y .cjs): la aplicación, los paquetes, los scripts, los "
               "ficheros de configuración y los tests. Para cada variable, di en qué ficheros se lee y qué valor por "
               "defecto le da el código, si le da alguno.")
    delegar = {
        "A": "",
        "B": (" Reparte la exploración del código entre subagentes: que ellos lean el repositorio y te devuelvan lo "
              "que encuentren, y tú quédate solo con lo que te devuelven para montar el inventario."),
    }[condicion]
    return f"{encargo}{delegar} Trabaja de forma autónoma, sin pedirme confirmación.\n\n{FORMATO_CASO1}"


ENCARGOS_CASO2 = ["exportar-csv", "codigos-descuento", "lista-espera"]


def caso2(condicion: str) -> str:
    specs = ", ".join(f"`docs/specs/{e}.md`" for e in ENCARGOS_CASO2[:-1]) + f" y `docs/specs/{ENCARGOS_CASO2[-1]}.md`"
    encargo = f"Implementa las tres features de {specs} siguiendo `AGENTS.md`."
    como = {
        "A": " Hazlas tú, una detrás de otra.",
        "B": (" Reparte el trabajo: lanza un subagente por feature, los tres en paralelo y sobre esta misma carpeta. "
              "Cuando terminen, comprueba tú que `npm run check` pasa con las tres juntas y arregla lo que haga falta."),
    }[condicion]
    return (f"{encargo}{como} Trabaja de forma autónoma, sin pedirme confirmación. Cuando termines, dime en pocas "
            "líneas qué has hecho.")


def caso3(condicion: str, encargo: str) -> str:
    spec = f"`docs/specs/{encargo}.md`"
    if condicion == "S":
        return (f"Implementa la feature de {spec} con la skill `implementar-feature`. Hazlo tú, en esta sesión. "
                "Trabaja de forma autónoma, sin pedirme confirmación. Cuando termines, dime en pocas líneas qué has hecho.")
    # P y B tienen el mismo encargo: lo que cambia es el modelo del subagente `implementador`.
    return (f"Encarga la feature de {spec} al subagente `implementador`, que la implementa con la skill "
            "`implementar-feature`. No la implementes tú: lánzalo, espera a que termine y dime en pocas líneas qué ha "
            "hecho. Trabaja de forma autónoma, sin pedirme confirmación.")
