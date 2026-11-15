"""Una cadena: un agente implementa un encargo y, sobre esa misma implementación, se prueban las condiciones.

- A, sin validador: lo que entrega el agente cuando dice que ha terminado.
- D, la misma sesión: se reanuda la sesión que implementó y se le pide que se valide. Solo se mide lo que
  detecta, no se repara.
- B, validador del mismo modelo en una sesión limpia: si pide cambios, una sesión nueva del mismo modelo los
  arregla con su brief, y vuelve a validar. Como mucho, dos reparaciones.
- C, validador del modelo potente de su mismo agente (solo para los modelos baratos), con el mismo bucle.

Cada estado se corrige con el gate del proyecto y con los tests ocultos (calificar.py).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import prompts
from agentes import CONFIGS, LAB, SCR, VALIDADOR_FRONTERA, lanzar
from calificar import GRANDES, copiar_estado, evaluar

class FalloAjeno(RuntimeError):
    """El agente no pudo trabajar por algo ajeno al experimento: cuota, límite de uso, red o autenticación."""


AJENO = re.compile(
    r"usage limit|hit your [^.\n]{0,40}limit|rate[ _-]?limit|too many requests|\b429\b|quota|"
    r"insufficient[ _](balance|credit|funds)|\b402\b|overloaded|\b529\b|internal server error|bad gateway|"
    r"service unavailable|\b50[234]\b|unauthori[sz]ed|\b401\b|authenticat|invalid api key|"
    r"ECONNRESET|ENOTFOUND|ETIMEDOUT|network error|stream disconnected|connection (reset|refused|closed)", re.I)


def comprobar(m: dict, paso: str) -> dict:
    """Si la ejecución falló por algo ajeno al agente, la cadena se corta y no se guarda como terminada:
    no es un dato del experimento, y al relanzar el lote se repite entera."""
    texto = " ".join(str(m.get(k) or "") for k in ("error_agente", "respuesta_final", "stderr"))
    rechazada = any((v or {}).get("estado") == "rejected" for v in (m.get("cuota") or {}).values())
    if rechazada and (m.get("error_agente") or not m.get("salida")):
        raise FalloAjeno(f"{paso} ({m.get('config')}): cuota agotada. {texto[:300]}")
    if m.get("error_agente"):
        if AJENO.search(texto) and (m.get("agente") == "claude" or m.get("rc") != 0 or not m.get("salida")):
            raise FalloAjeno(f"{paso} ({m.get('config')}): {texto[:400]}")
    return m


GIT = ["git", "-c", "user.email=lab@example.com", "-c", "user.name=lab", "-c", "commit.gpgsign=false"]
LIMITE_IMPLEMENTAR = 45 * 60
LIMITE_VALIDAR = 25 * 60
LIMITE_REPARAR = 30 * 60
MAX_REPARACIONES = 2
# Los encargos grandes tienen más margen (fijado antes de ejecutarlos, ver el README).
LIMITES_GRANDES = {"implementar": 120 * 60, "validar": 45 * 60, "reparar": 60 * 60}


def limite(encargo: str, paso: str) -> int:
    if encargo in GRANDES:
        return LIMITES_GRANDES[paso]
    return {"implementar": LIMITE_IMPLEMENTAR, "validar": LIMITE_VALIDAR, "reparar": LIMITE_REPARAR}[paso]


def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*GIT, *args], cwd=cwd, capture_output=True, text=True).stdout


def preparar(destino: Path) -> None:
    """Una copia limpia de la base con su propio repositorio: commit y etiqueta `base`."""
    copiar_estado(LAB / "club", destino)
    (destino / ".gitignore").write_text("node_modules/\ntest-ocultos/\n")
    git(destino, "init", "-q")
    git(destino, "add", "-A")
    git(destino, "commit", "-qm", "base")
    git(destino, "tag", "base")


def fijar(cwd: Path, mensaje: str) -> str:
    """Guarda en un commit lo que haya dejado el agente y devuelve su hash."""
    git(cwd, "add", "-A")
    git(cwd, "commit", "-qm", mensaje, "--allow-empty")
    return git(cwd, "rev-parse", "HEAD").strip()


def cambios_sin_fijar(cwd: Path) -> list[str]:
    return [linea for linea in git(cwd, "status", "--porcelain").splitlines() if linea.strip()]


def descartar(cwd: Path) -> None:
    git(cwd, "checkout", "-qf", "HEAD")
    git(cwd, "clean", "-qfd")


def leer_veredicto(texto: str) -> dict | None:
    bloques = re.findall(r"```json\s*(\{.*?\})\s*```", texto, re.S)
    candidatos = bloques[::-1] or re.findall(r"(\{.*\"veredicto\".*\})", texto, re.S)[::-1]
    for bloque in candidatos:
        try:
            datos = json.loads(bloque)
        except json.JSONDecodeError:
            continue
        if isinstance(datos, dict) and str(datos.get("veredicto", "")).strip() in ("accept", "revise", "block"):
            datos["veredicto"] = datos["veredicto"].strip()
            return datos
    return None


def guardar(destino: Path, datos: dict) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1))
    tmp.replace(destino)


def resumen(m: dict) -> dict:
    """Lo que se guarda de cada ejecución (el log completo se queda en el scratch)."""
    return {k: m.get(k) for k in (
        "config", "agente", "modelo", "modelo_real", "duracion_s", "rc", "sesion", "reanuda", "peticiones", "entrada",
        "entrada_cache_leida", "entrada_cache_escrita", "salida", "razonamiento", "coste_usd", "turnos",
        "herramientas", "ordenes", "respuesta_final", "error_agente", "stderr", "cuota")}


def rama(nombre: str, impl: Path, base: Path, encargo: str, implementador: str, validador: str,
         evaluacion_inicial: dict, logs: Path) -> dict:
    """Validar, reparar y volver a validar, sobre una copia de la implementación."""
    trabajo = base / nombre
    if trabajo.exists():
        shutil.rmtree(trabajo)
    copiar_estado(impl, trabajo)
    descartar(trabajo)
    rondas = []
    evaluacion = evaluacion_inicial
    for ronda in range(1, MAX_REPARACIONES + 2):
        v = comprobar(lanzar(validador, prompts.validar(encargo), trabajo, logs / f"{nombre}-validar{ronda}.jsonl",
                             limite_s=limite(encargo, "validar")), f"{nombre}-validar{ronda}")
        veredicto = leer_veredicto(v.get("respuesta_final", ""))
        tocados = cambios_sin_fijar(trabajo)
        descartar(trabajo)
        paso = {"ronda": ronda, "validacion": resumen(v), "veredicto": veredicto, "validador_toco": tocados,
                "evaluacion_validada": evaluacion}
        rondas.append(paso)
        if veredicto is None or veredicto["veredicto"] == "accept" or ronda > MAX_REPARACIONES:
            break
        r = comprobar(lanzar(implementador, prompts.reparar(encargo, veredicto), trabajo,
                             logs / f"{nombre}-reparar{ronda}.jsonl", limite_s=limite(encargo, "reparar")), f"{nombre}-reparar{ronda}")
        paso["reparacion"] = resumen(r)
        paso["commit"] = fijar(trabajo, f"reparacion-{ronda}")
        evaluacion = evaluar(trabajo, encargo)
        paso["evaluacion_tras_reparar"] = evaluacion
    (logs / f"{nombre}.diff").write_text(git(trabajo, "diff", "base", "HEAD"))
    return {"validador": validador, "rondas": rondas, "final": evaluacion,
            "veredicto_final": (rondas[-1]["veredicto"] or {}).get("veredicto") if rondas else None}


def ejecutar(lote: str, encargo: str, config: str, rep: int, condiciones: str = "ABCD") -> dict:
    cid = f"{encargo}-{config}-r{rep}"
    destino = LAB / "resultados" / lote / f"{cid}.json"
    if destino.exists() and json.loads(destino.read_text()).get("terminada"):
        return json.loads(destino.read_text())
    base = SCR / "ejecuciones" / lote / cid
    logs = base / "logs"
    if base.exists():
        shutil.rmtree(base)
    logs.mkdir(parents=True)
    impl = base / "impl"
    preparar(impl)
    r = {"id": cid, "lote": lote, "encargo": encargo, "config": config, "rep": rep, **CONFIGS[config]}

    m = comprobar(lanzar(config, prompts.implementar(encargo), impl, logs / "implementar.jsonl", persistir=True,
                         limite_s=limite(encargo, "implementar")), "implementar")
    r["implementacion"] = resumen(m)
    r["commit_implementacion"] = fijar(impl, "implementacion")
    (logs / "implementacion.diff").write_text(git(impl, "diff", "base", "HEAD"))
    r["A"] = evaluar(impl, encargo)
    guardar(destino, r)

    if "D" in condiciones and m.get("sesion"):
        d = comprobar(lanzar(config, prompts.validar(encargo), impl, logs / "D-validar.jsonl", reanudar=m["sesion"],
                             limite_s=limite(encargo, "validar")), "D-validar")
        r["D"] = {"validacion": resumen(d), "veredicto": leer_veredicto(d.get("respuesta_final", "")),
                  "validador_toco": cambios_sin_fijar(impl)}
        descartar(impl)
        guardar(destino, r)

    if "B" in condiciones:
        r["B"] = rama("B", impl, base, encargo, config, config, r["A"], logs)
        guardar(destino, r)

    if "C" in condiciones and config in VALIDADOR_FRONTERA:
        r["C"] = rama("C", impl, base, encargo, config, VALIDADOR_FRONTERA[config], r["A"], logs)
        guardar(destino, r)

    r["terminada"] = True
    guardar(destino, r)
    # Los diffs se guardan con los resultados: son pequeños y dejan ver qué entregó cada agente.
    for diff in logs.glob("*.diff"):
        (destino.parent / cid).mkdir(exist_ok=True)
        shutil.copy(diff, destino.parent / cid / diff.name)
    return r
