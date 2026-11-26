"""Lo que ocupa el listado de skills al arrancar (27-nov-2026).

Cada herramienta, con 0, 3 o 33 skills instaladas (las del experimento con su descripción concreta, más las 30 de
relleno), recibe "Responde solo OK" y se mide la entrada de su primera petición al modelo: el contexto con el que
arranca. La diferencia entre 0 y 3, y entre 0 y 33, es lo que cuesta tener las skills instaladas en cada sesión.

Uso: oprun python3 -I analisis/sondas/listado.py
"""
import json
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

LAB = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(LAB / "runner"))
import agentes  # noqa: E402
import casos  # noqa: E402
from calificar import copiar_estado  # noqa: E402

PROMPT = "Responde solo OK, sin usar herramientas."


def preparar(repo: Path, herramienta: str, n: int) -> None:
    if n == 0:
        copiar_estado(LAB / "club", repo)
        casos.fijar_base(repo)
    else:
        casos.preparar_a(repo, herramienta, "concreta", "pocas" if n == 3 else "muchas")


def primera_entrada(herramienta: str, m: dict, aux: Path) -> int | None:
    if herramienta == "claude":
        for t in (aux / "claude-config" / "projects").rglob("*.jsonl"):
            for e in agentes.eventos(t):
                if e.get("type") == "assistant":
                    u = (e.get("message") or {}).get("usage") or {}
                    return u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
    if herramienta == "codex":
        for r in (aux / "codex-home" / "sessions").rglob("rollout-*.jsonl"):
            for e in agentes.eventos(r):
                p = e.get("payload") or {}
                if e.get("type") == "event_msg" and p.get("type") == "token_count" and p.get("info"):
                    return (p["info"].get("last_token_usage") or {}).get("input_tokens")
    if herramienta == "opencode":
        for e in agentes.eventos(aux.with_suffix(".jsonl")):
            if e.get("type") == "step_finish":
                tk = (e.get("part") or {}).get("tokens", {})
                return tk.get("input", 0) + tk.get("cache", {}).get("read", 0) + tk.get("cache", {}).get("write", 0)
    return None


def una(t):
    herramienta, n, rep = t
    base = agentes.SCR / "ejecuciones" / "sonda-listado" / f"{herramienta}-{n}-r{rep}"
    shutil.rmtree(base, ignore_errors=True)
    (base / "logs").mkdir(parents=True)
    repo = base / "repo"
    preparar(repo, herramienta, n)
    log = base / "logs" / "agente.jsonl"
    m = agentes.lanzar(herramienta, PROMPT, repo, log, limite_s=300)
    return {"herramienta": herramienta, "skills": n, "rep": rep, "entrada_primera": primera_entrada(herramienta, m, log.with_suffix(".aux")),
            "version": m.get("version"), "skills_init": len(((m.get("init") or {}).get("skills")) or []) if herramienta == "claude" else None,
            "respuesta": (m.get("respuesta_final") or "")[:40]}


if __name__ == "__main__":
    trabajos = [(h, n, r) for r in (1, 2) for n in (0, 3, 33) for h in ("claude", "codex", "opencode")]
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(una, trabajos))
    out = LAB / "analisis" / "sondas" / "resultados"
    out.mkdir(exist_ok=True)
    (out / "listado.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    for r in res:
        print(r)
