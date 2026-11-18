"""Una ejecución de un caso: prepara el repositorio, lanza la herramienta en su condición, saca las métricas y
corrige el resultado.

- Caso 1 (A sin subagentes, B con): el inventario de variables de entorno del repositorio fijado, que se puntúa
  con caso1/puntuar.py.
- Caso 2 (A, B): las tres features del club en la misma sesión o una por subagente, que se corrigen con los tests
  ocultos de cada una y el gate.
- Caso 3 (S, P, B): una feature con la skill en la sesión principal (S) o encargada a un subagente definido con el
  modelo principal (P) o con el barato (B).
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import prompts
from agentes import HERRAMIENTAS, LAB, SCR, lanzar
from calificar import copiar_estado, evaluar
from costes import costes

sys.path.insert(0, str(LAB / "caso1"))
import puntuar  # noqa: E402

REPO_CASO1 = {"url": "https://github.com/umami-software/umami", "commit": "aad2c4cedd5c0b3bc4d361843830a0bb47cf79c4"}
CONDICIONES = {1: "AB", 2: "AB", 3: "SPB"}
CON_SUBAGENTES = {(1, "A"): False, (1, "B"): True, (2, "A"): False, (2, "B"): True,
                  (3, "S"): False, (3, "P"): True, (3, "B"): True}
LIMITES = {1: 30 * 60, 2: 60 * 60, 3: 45 * 60}
GIT = ["git", "-c", "user.email=lab@example.com", "-c", "user.name=lab", "-c", "commit.gpgsign=false"]


class FalloAjeno(RuntimeError):
    """La herramienta no pudo trabajar por algo ajeno al experimento: cuota, límite de uso, red o autenticación."""


AJENO = re.compile(
    r"usage limit|hit your [^.\n]{0,40}limit|rate[ _-]?limit|too many requests|\b429\b|quota|"
    r"insufficient[ _](balance|credit|funds)|\b402\b|overloaded|\b529\b|internal server error|bad gateway|"
    r"service unavailable|\b50[234]\b|unauthori[sz]ed|\b401\b|authenticat|invalid api key|"
    r"ECONNRESET|ENOTFOUND|ETIMEDOUT|network error|stream disconnected|connection (reset|refused|closed)", re.I)


def comprobar(m: dict) -> dict:
    """Como en validación: si la ejecución falló por algo ajeno, no es un dato y no se guarda como terminada."""
    texto = " ".join(str(m.get(k) or "") for k in ("error_agente", "respuesta_final", "stderr"))
    rechazada = any((v or {}).get("estado") == "rejected" for v in (m.get("cuota") or {}).values())
    sin_trabajo = not m["total"].get("salida")
    if rechazada and (m.get("error_agente") or sin_trabajo):
        raise FalloAjeno(f"cuota agotada ({m['herramienta']}). {texto[:300]}")
    if (m.get("error_agente") or m.get("rc") not in (0, None)) and AJENO.search(texto):
        if m["herramienta"] == "claude" or m.get("rc") != 0 or sin_trabajo:
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


def fijar(repo: Path, mensaje: str) -> str:
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", mensaje, "--allow-empty")
    return git(repo, "rev-parse", "HEAD").strip()


def repo_caso1(destino: Path) -> None:
    """El repositorio del caso 1 en su commit, sin historia (.git fuera), desde un clon local del laboratorio."""
    espejo = SCR / "repos" / "umami.git"
    if not espejo.exists():
        espejo.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--bare", REPO_CASO1["url"], str(espejo)], check=True)
    subprocess.run(["git", "clone", "-q", "--shared", str(espejo), str(destino)], check=True)
    subprocess.run(["git", "-C", str(destino), "checkout", "-q", REPO_CASO1["commit"]], check=True)
    shutil.rmtree(destino / ".git")


def repo_club(destino: Path, herramienta: str, caso: int, condicion: str) -> None:
    copiar_estado(LAB / "club", destino)
    if caso == 3:
        shutil.copy(LAB / "caso3" / "AGENTS.md", destino / "AGENTS.md")
        carpeta_skill = {"claude": ".claude/skills", "codex": ".agents/skills", "opencode": ".opencode/skills"}[herramienta]
        (destino / carpeta_skill / "implementar-feature").mkdir(parents=True)
        shutil.copy(LAB / "caso3" / "SKILL.md", destino / carpeta_skill / "implementar-feature" / "SKILL.md")
        if condicion in "PB":
            modelo = HERRAMIENTAS[herramienta]["principal" if condicion == "P" else "barato"]
            plantilla, destino_agente = {
                "claude": ("claude.md", ".claude/agents/implementador.md"),
                "codex": ("codex.toml", ".codex/agents/implementador.toml"),
                "opencode": ("opencode.md", ".opencode/agents/implementador.md"),
            }[herramienta]
            ruta = destino / destino_agente
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_text((LAB / "caso3" / "agentes" / plantilla).read_text().replace("{modelo}", modelo))
    fijar_base(destino)


def resumen(m: dict) -> dict:
    """Lo que se guarda de cada ejecución (el log completo se queda en el scratch)."""
    claves = ("herramienta", "version", "modelo", "modelo_real", "subagentes_activados", "duracion_s", "duracion_s_agente",
              "rc", "sesion", "principal", "subagentes", "n_subagentes", "modelos_subagentes", "por_modelo", "total",
              "costes", "coste_herramienta_usd", "modelUsage", "subagent_stats", "lanzamientos", "skills_cargadas",
              "herramientas", "ordenes", "respuesta_final", "error_agente", "stderr", "cuota", "aviso", "uso_stream",
              "uso_stream_principal")
    r = {k: m.get(k) for k in claves if k in m}
    if m.get("init"):
        r["init"] = {k: m["init"].get(k) for k in ("agents", "skills", "claude_code_version")}
    return r


def guardar(destino: Path, datos: dict) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1))
    tmp.replace(destino)


def ident(caso: int, herramienta: str, condicion: str, rep: int, encargo: str | None) -> str:
    return f"c{caso}-{herramienta}-{condicion}{'-' + encargo if encargo else ''}-r{rep}"


def ejecutar(lote: str, caso: int, herramienta: str, condicion: str, rep: int, encargo: str | None = None) -> dict:
    cid = ident(caso, herramienta, condicion, rep, encargo)
    destino = LAB / "resultados" / lote / f"{cid}.json"
    if destino.exists() and json.loads(destino.read_text()).get("terminada"):
        return json.loads(destino.read_text())
    base = SCR / "ejecuciones" / lote / cid
    if base.exists():
        shutil.rmtree(base)
    (base / "logs").mkdir(parents=True)
    repo = base / "repo"
    subagentes = CON_SUBAGENTES[(caso, condicion)]
    if caso == 1:
        repo_caso1(repo)
        prompt = prompts.caso1(condicion)
    else:
        repo_club(repo, herramienta, caso, condicion)
        prompt = prompts.caso2(condicion) if caso == 2 else prompts.caso3(condicion, encargo)
    r = {"id": cid, "lote": lote, "caso": caso, "herramienta": herramienta, "condicion": condicion, "rep": rep,
         "encargo": encargo, "subagentes_activados": subagentes, "prompt": prompt}
    m = lanzar(herramienta, prompt, repo, base / "logs" / "agente.jsonl", subagentes=subagentes,
               confiar=(caso == 3), limite_s=LIMITES[caso])
    m["costes"] = costes(m)
    comprobar(m)
    r["ejecucion"] = resumen(m)
    # Lo que hay que comprobar en cada ejecución: que se lanzan subagentes cuando se pide y no cuando no.
    r["comprobaciones"] = {"subagentes_como_se_pide": (m["n_subagentes"] > 0) == subagentes}
    if caso == 3 and condicion in "PB":
        esperado = HERRAMIENTAS[herramienta]["principal" if condicion == "P" else "barato"]
        r["comprobaciones"]["modelo_del_subagente"] = bool(m["modelos_subagentes"]) and all(
            (x or "").endswith(esperado.split("/")[-1]) for x in m["modelos_subagentes"])
    if caso == 1:
        r["puntuacion"] = puntuar.puntuar(m.get("respuesta_final") or "", repo)
    else:
        r["commit"] = fijar(repo, "agente")
        (base / "logs" / "agente.diff").write_text(git(repo, "diff", "base", "HEAD"))
        encargos = prompts.ENCARGOS_CASO2 if caso == 2 else [encargo]
        r["correccion"] = evaluar(repo, encargos)
    r["terminada"] = True
    guardar(destino, r)
    if caso != 1:
        (destino.parent / cid).mkdir(exist_ok=True)
        shutil.copy(base / "logs" / "agente.diff", destino.parent / cid / "agente.diff")
    return r
