"""Lo que ocupan las reglas de facturación pegadas en AGENTS.md (27-nov-2026): contexto inicial con el AGENTS.md del
club y con las reglas añadidas, como en la condición "agents" de la parte B."""
import json, shutil, sys
from pathlib import Path
LAB = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(LAB / "runner")); sys.path.insert(0, str(Path(__file__).parent))
import agentes, casos, listado  # noqa: E401,E402
res = []
for h in ("claude", "codex", "opencode"):
    for cond in ("sin", "agents"):
        base = agentes.SCR / "ejecuciones" / "sonda-agents" / f"{h}-{cond}"
        shutil.rmtree(base, ignore_errors=True); (base / "logs").mkdir(parents=True)
        casos.preparar_b(base / "repo", h, "facturas-gestoria", cond)
        log = base / "logs" / "agente.jsonl"
        m = agentes.lanzar(h, listado.PROMPT, base / "repo", log, limite_s=300)
        res.append({"herramienta": h, "condicion": cond, "entrada_primera": listado.primera_entrada(h, m, log.with_suffix(".aux"))})
(LAB / "analisis" / "sondas" / "resultados" / "agents_md.json").write_text(json.dumps(res, indent=1))
print(res)
