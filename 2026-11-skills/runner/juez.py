"""Juez a ciegas por parejas (parte B y parte C).

Para cada herramienta, skill y repetición se comparan dos condiciones (PAREJAS): lo que entregó el agente en cada
una (el diff en facturas y tests, la respuesta en consultas), sin decirle al juez cuál es cuál. Cada pareja se juzga
dos veces, con el orden cambiado, y por dos jueces de familias distintas: Opus 5.5 (Claude Code) y gpt-6.1-sol
(Codex). El juez solo ve el encargo, la spec y las dos entregas: no ve los tests ocultos ni las métricas.

Uso:
  oprun python3 -I runner/juez.py lote
Escribe resultados/<lote>/juez/<pareja>-<juez>-<orden>.json y es reanudable.
"""
import argparse
import json
import random
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agentes import CODEX_HOME, HOME_CODEX, LAB, entorno_limpio  # noqa: E402

PAREJAS = {
    "facturas-gestoria": [("skill", "sin"), ("agents", "sin"), ("skill", "agents")],
    "consultas-club": [("skill", "sin"), ("recortada", "skill")],
    "tests-node": [("neutra-potente", "sin-potente"), ("enfatica-potente", "neutra-potente"),
                   ("neutra-barato", "sin-barato"), ("enfatica-barato", "neutra-barato")],
}
SPEC = {"facturas-gestoria": "facturas", "tests-node": "reembolsos"}
MAX_DIFF = 60_000

INSTRUCCIONES = """Eres revisor de código en un equipo. Te doy un encargo y dos entregas, A y B, que lo intentan resolver.
Decide cuál de las dos es mejor para el equipo: la que cumple mejor el encargo, con menos errores y con tests que de
verdad comprueban lo que pide. No premies la longitud. Si son igual de buenas, dilo.

Responde solo con un bloque ```json así:
```json
{"mejor": "A" | "B" | "empate", "motivo": "una o dos frases"}
```"""


def entrega(r: dict, carpeta: Path) -> str:
    if r["skill"] == "consultas-club":
        return r["ejecucion"].get("respuesta_final") or "(sin respuesta)"
    diff = (carpeta / r["id"] / "agente.diff").read_text(errors="replace")
    diff = re.sub(r"(?ms)^diff --git a/package-lock\.json.*?(?=^diff --git |\Z)", "", diff)
    return diff[:MAX_DIFF] + ("\n[... diff recortado ...]" if len(diff) > MAX_DIFF else "")


def contexto(skill: str, prompt: str) -> str:
    texto = f"## Encargo\n\n{prompt}\n"
    if skill in SPEC:
        texto += f"\n## La spec\n\n{(LAB / 'club' / 'docs' / 'specs' / (SPEC[skill] + '.md')).read_text()}\n"
    if skill == "facturas-gestoria":
        # El juez necesita las reglas de la gestoría para juzgar, aunque una de las entregas no las tuviera.
        texto += f"\n## Las reglas de la gestoría (las que debe cumplir la entrega)\n\n{(LAB / 'skills' / skill / 'cuerpo.md').read_text()}\n"
    return texto


def juzgar(juez: str, texto: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        if juez == "opus":
            cmd = ["claude", "-p", texto, "--model", "claude-opus-5-5", "--output-format", "json",
                   "--setting-sources", "project,local", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                   "--disallowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep", "Agent", "Workflow", "WebFetch", "WebSearch"]
            env = entorno_limpio()
            p = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=900, env=env)
            try:
                salida = json.loads(p.stdout).get("result") or ""
            except json.JSONDecodeError:
                salida = p.stdout
        else:
            cmd = ["codex", "exec", "--skip-git-repo-check", "-m", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"',
                   "-s", "read-only", "-C", tmp, texto]
            env = entorno_limpio()
            env.update({"HOME": str(HOME_CODEX), "CODEX_HOME": str(CODEX_HOME)})
            p = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=900, env=env)
            salida = p.stdout
    bloques = re.findall(r"```json\s*(.*?)```", salida, re.S) or re.findall(r"(\{[^{}]*\"mejor\"[^{}]*\})", salida, re.S)
    for b in reversed(bloques):
        try:
            d = json.loads(b)
            if d.get("mejor") in ("A", "B", "empate"):
                return {"mejor": d["mejor"], "motivo": d.get("motivo", ""), "rc": p.returncode}
        except json.JSONDecodeError:
            continue
    return {"mejor": None, "motivo": salida[-500:], "rc": p.returncode}


def parejas(lote: str) -> list[dict]:
    carpeta = LAB / "resultados" / lote
    res = {}
    for f in carpeta.glob("B-*.json"):
        r = json.loads(f.read_text())
        if r.get("terminada"):
            res[(r["herramienta"], r["skill"], r["condicion"], r["rep"])] = r
    lista = []
    for (h, sk, c, rep), r in sorted(res.items()):
        for x, y in PAREJAS[sk]:
            if c == x and (h, sk, y, rep) in res:
                lista.append({"id": f"{h}-{sk}-{x}-vs-{y}-r{rep}", "herramienta": h, "skill": sk, "x": x, "y": y,
                              "rep": rep, "rx": r, "ry": res[(h, sk, y, rep)]})
    return lista


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("lote")
    a.add_argument("--hilos", type=int, default=4)
    a.add_argument("--jueces", default="opus,sol")
    args = a.parse_args()
    carpeta = LAB / "resultados" / args.lote
    salida = carpeta / "juez"
    salida.mkdir(exist_ok=True)
    trabajos = []
    for p in parejas(args.lote):
        for juez in args.jueces.split(","):
            for orden in ("xy", "yx"):
                destino = salida / f"{p['id']}-{juez}-{orden}.json"
                if not destino.exists():
                    trabajos.append((p, juez, orden, destino))
    random.Random(20261126).shuffle(trabajos)
    print(f"{len(trabajos)} juicios pendientes", flush=True)

    def uno(t):
        p, juez, orden, destino = t
        primera, segunda = (p["rx"], p["ry"]) if orden == "xy" else (p["ry"], p["rx"])
        texto = (f"{INSTRUCCIONES}\n\n{contexto(p['skill'], p['rx']['prompt'])}\n"
                 f"## Entrega A\n\n{entrega(primera, carpeta)}\n\n## Entrega B\n\n{entrega(segunda, carpeta)}\n")
        v = juzgar(juez, texto)
        # Se traduce A/B a la condición que había detrás.
        letra = {"A": primera["condicion"], "B": segunda["condicion"]}
        v.update({"pareja": p["id"], "juez": juez, "orden": orden, "x": p["x"], "y": p["y"],
                  "gana": letra.get(v["mejor"], v["mejor"])})
        destino.write_text(json.dumps(v, ensure_ascii=False, indent=1))
        return f"{p['id']} {juez} {orden}: {v['gana']}"

    with ThreadPoolExecutor(args.hilos) as ex:
        for f in as_completed([ex.submit(uno, t) for t in trabajos]):
            try:
                print(f.result(), flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"ERROR {e}", flush=True)


if __name__ == "__main__":
    main()
