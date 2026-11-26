"""Una ejecución del laboratorio: prepara el club con las skills de la condición, lanza la herramienta, saca las
métricas y corrige el resultado.

- Parte A (activación): una petición de activacion/peticiones.json con las tres skills instaladas y la descripción
  vaga o la concreta. Se para cuando el agente carga la skill que toca, o a los 3 minutos.
- Parte B (efecto): un encargo completo con una skill (o sin ella) en una de sus condiciones (README).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

from agentes import HERRAMIENTAS, LAB, SCR, lanzar
from calificar import copiar_estado, evaluar
from costes import costes
import mutantes

SKILLS = LAB / "skills"
DESCRIPCIONES = json.loads((SKILLS / "descripciones.json").read_text())
PETICIONES = {p["id"]: p for p in json.loads((LAB / "activacion" / "peticiones.json").read_text())["peticiones"]}
DISTRACTORAS = json.loads((SKILLS / "distractoras" / "distractoras.json").read_text())["skills"]
REFERENCIA_CONSULTAS = json.loads((LAB / "consultas" / "referencia.json").read_text())
CARPETA_SKILLS = {"claude": ".claude/skills", "codex": ".agents/skills", "opencode": ".opencode/skills"}
GIT = ["git", "-c", "user.email=lab@example.com", "-c", "user.name=lab", "-c", "commit.gpgsign=false"]
LIMITE_A = 3 * 60

# Parte B: encargo y condiciones de cada skill. El cuerpo de la skill que va en cada condición (None: sin skill).
PARTE_B = {
    "facturas-gestoria": {"condiciones": {"sin": None, "skill": "cuerpo.md", "agents": "cuerpo.md"}, "limite": 45 * 60},
    "consultas-club": {"condiciones": {"sin": None, "skill": "cuerpo.md", "recortada": "cuerpo-recortado.md"}, "limite": 20 * 60},
    "tests-node": {"condiciones": {f"{c}-{m}": cuerpo for c, cuerpo in (("sin", None), ("neutra", "cuerpo-neutro.md"),
                                                                           ("enfatica", "cuerpo-enfatico.md"))
                                   for m in ("potente", "barato")}, "limite": 45 * 60},
}
CIERRE = "Trabaja de forma autónoma, sin pedirme confirmación. Cuando termines, dime en pocas líneas qué has hecho."
PREGUNTAS = """Responde estas cuatro preguntas sobre la actividad del club en octubre de 2026 (el historial de reservas de la semilla):

1. ¿A qué hora de inicio hubo más reservas confirmadas, y cuántas?
2. ¿Cuántos euros ingresó el club por la pista 3, contando las reservas confirmadas y las no presentadas por su importe?
3. ¿Cuántas reservas se cancelaron y cuántos socios distintos las cancelaron?
4. ¿Qué porcentaje de las franjas de sábado y domingo de la pista 1 tuvo una reserva confirmada o no presentada? Con un decimal.

No cambies el código del club. Termina tu respuesta con un único bloque ```json así:

```json
{"p1": {"hora": "HH:MM", "reservas": 0}, "p2": {"euros": 0.0}, "p3": {"canceladas": 0, "socios": 0}, "p4": {"porcentaje": 0.0}}
```"""
ENCARGOS_B = {
    "facturas-gestoria": f"Implementa la feature de `docs/specs/facturas.md` siguiendo `AGENTS.md`. {CIERRE}",
    "consultas-club": f"{PREGUNTAS}\n\nTrabaja de forma autónoma, sin pedirme confirmación.",
    "tests-node": f"Implementa la feature de `docs/specs/reembolsos.md` siguiendo `AGENTS.md`. {CIERRE}",
}
OCULTOS_B = {"facturas-gestoria": "facturas", "tests-node": "reembolsos"}


class FalloAjeno(RuntimeError):
    """La herramienta no pudo trabajar por algo ajeno al experimento: cuota, límite de uso, red o autenticación."""


AJENO = re.compile(
    r"usage limit|hit your [^.\n]{0,40}limit|rate[ _-]?limit|too many requests|\b429\b|quota|"
    r"insufficient[ _](balance|credit|funds)|\b402\b|overloaded|\b529\b|internal server error|bad gateway|"
    r"service unavailable|\b50[234]\b|unauthori[sz]ed|\b401\b|authenticat|invalid api key|"
    r"ECONNRESET|ENOTFOUND|ETIMEDOUT|network error|stream disconnected|connection (reset|refused|closed)", re.I)


def comprobar(m: dict) -> dict:
    texto = " ".join(str(m.get(k) or "") for k in ("error_agente", "respuesta_final", "stderr"))
    rechazada = any((v or {}).get("estado") == "rejected" for v in (m.get("cuota") or {}).values())
    sin_trabajo = not m["total"].get("salida")
    if rechazada and (m.get("error_agente") or sin_trabajo):
        raise FalloAjeno(f"cuota agotada ({m['herramienta']}). {texto[:300]}")
    if (m.get("error_agente") or m.get("rc") not in (0, None, "parada")) and AJENO.search(texto):
        if m["herramienta"] == "claude" or m.get("rc") not in (0, "parada") or sin_trabajo:
            raise FalloAjeno(f"{m['herramienta']}: {texto[:400]}")
    return m


def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*GIT, *args], cwd=cwd, capture_output=True, text=True).stdout


def fijar_base(repo: Path) -> None:
    (repo / ".gitignore").write_text("node_modules/\ntest-ocultos/\n")
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "tag", "base")


def skill_md(nombre: str, descripcion: str, cuerpo: str) -> str:
    texto = (SKILLS / nombre / cuerpo).read_text()
    return f"---\nname: {nombre}\ndescription: {json.dumps(descripcion, ensure_ascii=False)}\n---\n\n{texto}"


def instalar(repo: Path, herramienta: str, nombre: str, descripcion: str, cuerpo: str) -> None:
    carpeta = repo / CARPETA_SKILLS[herramienta] / nombre
    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / "SKILL.md").write_text(skill_md(nombre, descripcion, cuerpo))


def preparar_a(repo: Path, herramienta: str, descripcion: str, instalacion: str = "pocas") -> None:
    copiar_estado(LAB / "club", repo)
    cuerpos = {"facturas-gestoria": "cuerpo.md", "consultas-club": "cuerpo.md", "tests-node": "cuerpo-neutro.md"}
    for nombre, cuerpo in cuerpos.items():
        instalar(repo, herramienta, nombre, DESCRIPCIONES[nombre][descripcion], cuerpo)
    if instalacion == "muchas":
        # Las 30 de relleno, con su descripción concreta, en las dos condiciones de descripción.
        for nombre, d in DISTRACTORAS.items():
            carpeta = repo / CARPETA_SKILLS[herramienta] / nombre
            carpeta.mkdir(parents=True, exist_ok=True)
            (carpeta / "SKILL.md").write_text(
                f"---\nname: {nombre}\ndescription: {json.dumps(d['description'], ensure_ascii=False)}\n---\n\n"
                f"# {nombre}\n\n{d['description']}\n\nEl procedimiento detallado lo lleva la persona responsable: pregúntale antes de tocar nada.\n")
    fijar_base(repo)


def preparar_b(repo: Path, herramienta: str, skill: str, condicion: str) -> None:
    copiar_estado(LAB / "club", repo)
    cuerpo = PARTE_B[skill]["condiciones"][condicion]
    if condicion == "agents":
        # El mismo texto de la skill, pegado al final del AGENTS.md: siempre en el contexto.
        texto = (SKILLS / skill / cuerpo).read_text().replace("\n# ", "\n## ", 1)
        if texto.startswith("# "):
            texto = "#" + texto
        (repo / "AGENTS.md").write_text((repo / "AGENTS.md").read_text().rstrip("\n") + "\n\n" + texto)
    elif cuerpo:
        instalar(repo, herramienta, skill, DESCRIPCIONES[skill]["concreta"], cuerpo)
    fijar_base(repo)


def ident_a(herramienta: str, peticion: str, descripcion: str, instalacion: str, rep: int) -> str:
    return f"A-{herramienta}-{peticion}-{descripcion}-{instalacion}-r{rep}"


def ident_b(herramienta: str, skill: str, condicion: str, rep: int) -> str:
    return f"B-{herramienta}-{skill}-{condicion}-r{rep}"


def resumen(m: dict) -> dict:
    claves = ("herramienta", "version", "modelo", "modelo_real", "duracion_s", "duracion_s_agente", "rc", "sesion",
              "principal", "por_modelo", "total", "costes", "coste_herramienta_usd", "modelUsage", "skills_cargadas",
              "herramientas", "ordenes", "respuesta_final", "error_agente", "stderr", "cuota", "aviso", "turnos")
    r = {k: m.get(k) for k in claves if k in m}
    if m.get("init"):
        r["init"] = {k: m["init"].get(k) for k in ("skills", "claude_code_version")}
    return r


def guardar(destino: Path, datos: dict) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1))
    tmp.replace(destino)


def _ya(destino: Path) -> dict | None:
    if destino.exists():
        d = json.loads(destino.read_text())
        if d.get("terminada"):
            return d
    return None


def _base(lote: str, cid: str) -> Path:
    base = SCR / "ejecuciones" / lote / cid
    if base.exists():
        shutil.rmtree(base)
    (base / "logs").mkdir(parents=True)
    return base


def activacion(lote: str, herramienta: str, peticion: str, descripcion: str, instalacion: str, rep: int) -> dict:
    cid = ident_a(herramienta, peticion, descripcion, instalacion, rep)
    destino = LAB / "resultados" / lote / f"{cid}.json"
    if (hecho := _ya(destino)):
        return hecho
    p = PETICIONES[peticion]
    base = _base(lote, cid)
    repo = base / "repo"
    preparar_a(repo, herramienta, descripcion, instalacion)
    m = lanzar(herramienta, p["texto"], repo, base / "logs" / "agente.jsonl", limite_s=LIMITE_A,
               parar_con=p["esperada"])
    m["costes"] = costes(m)
    comprobar(m)
    cargadas = m["skills_cargadas"]
    nuestras = [s for s in cargadas if s in DESCRIPCIONES or s in DISTRACTORAS]
    esperada = p["esperada"]
    r = {"id": cid, "lote": lote, "parte": "A", "herramienta": herramienta, "peticion": peticion,
         "tipo": p["tipo"], "skill": p["skill"], "descripcion": descripcion, "instalacion": instalacion, "rep": rep,
         "prompt": p["texto"],
         "ejecucion": resumen(m),
         "activacion": {
             "cargadas": cargadas,
             "esperada": esperada,
             "acierto": (esperada in nuestras) if esperada else not nuestras,
             "falsos_positivos": [s for s in nuestras if s != esperada and s not in p["permitidas"]],
             "primera": nuestras[0] if nuestras else None,
             "cortada": m.get("rc") in ("parada", "timeout"),
         },
         "terminada": True}
    guardar(destino, r)
    return r


def _bloque_json(texto: str) -> dict | None:
    bloques = re.findall(r"```json\s*(.*?)```", texto or "", re.S)
    for b in reversed(bloques):
        try:
            return json.loads(b)
        except json.JSONDecodeError:
            continue
    return None


def puntuar_consultas(texto: str) -> dict:
    ref = REFERENCIA_CONSULTAS
    d = _bloque_json(texto)
    if not isinstance(d, dict):
        return {"legible": False, "aciertos": 0, "total": 4, "detalle": {}}
    def num(x):
        try:
            return float(str(x).replace(",", "."))
        except (TypeError, ValueError):
            return None
    g = lambda k: d.get(k) if isinstance(d.get(k), dict) else {}  # noqa: E731
    det = {
        "p1": str(g("p1").get("hora", "")).strip()[:5] == ref["p1"]["hora"] and num(g("p1").get("reservas")) == ref["p1"]["reservas"],
        "p2": num(g("p2").get("euros")) is not None and abs(num(g("p2").get("euros")) - ref["p2"]["euros"]) < 0.005,
        "p3": num(g("p3").get("canceladas")) == ref["p3"]["canceladas"] and num(g("p3").get("socios")) == ref["p3"]["socios"],
        "p4": num(g("p4").get("porcentaje")) is not None and abs(num(g("p4").get("porcentaje")) - ref["p4"]["porcentaje"]) < 0.051,
    }
    return {"legible": True, "aciertos": sum(det.values()), "total": 4, "detalle": det, "respuesta": d}


def criterios_en_tests(repo: Path) -> list[int]:
    """Qué criterios nombran los tests que ha escrito el agente (C<n> al principio del nombre del test)."""
    diff = git(repo, "diff", "base", "HEAD", "--", "test")
    return sorted({int(n) for n in re.findall(r"^\+.*?test\(\s*[`'\"]C(\d+)\b", diff, re.M)})


def efecto(lote: str, herramienta: str, skill: str, condicion: str, rep: int) -> dict:
    cid = ident_b(herramienta, skill, condicion, rep)
    destino = LAB / "resultados" / lote / f"{cid}.json"
    if (hecho := _ya(destino)):
        return hecho
    base = _base(lote, cid)
    repo = base / "repo"
    preparar_b(repo, herramienta, skill, condicion)
    clave_modelo = "barato" if condicion.endswith("-barato") else "principal"
    modelo = HERRAMIENTAS[herramienta][clave_modelo]
    m = lanzar(herramienta, ENCARGOS_B[skill], repo, base / "logs" / "agente.jsonl", limite_s=PARTE_B[skill]["limite"],
               modelo=modelo)
    m["costes"] = costes(m)
    comprobar(m)
    r = {"id": cid, "lote": lote, "parte": "B", "herramienta": herramienta, "skill": skill, "condicion": condicion,
         "modelo": modelo, "rep": rep, "prompt": ENCARGOS_B[skill], "ejecucion": resumen(m),
         "skill_cargada": skill in m["skills_cargadas"]}
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "agente", "--allow-empty")
    (base / "logs" / "agente.diff").write_text(git(repo, "diff", "base", "HEAD"))
    if skill == "consultas-club":
        r["correccion"] = puntuar_consultas(m.get("respuesta_final") or "")
        r["codigo_cambiado"] = bool(git(repo, "diff", "--stat", "base", "HEAD", "--", "src").strip())
    else:
        r["correccion"] = evaluar(repo, [OCULTOS_B[skill]])
        r["criterios_en_tests"] = criterios_en_tests(repo)
        if skill == "tests-node":
            r["mutantes"] = mutantes.cazar(repo / "test")
    r["terminada"] = True
    guardar(destino, r)
    (destino.parent / cid).mkdir(exist_ok=True)
    shutil.copy(base / "logs" / "agente.diff", destino.parent / cid / "agente.diff")
    return r
