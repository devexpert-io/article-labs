"""Lee la traza de una ejecución y la reduce a una lista de pasos: lo que intentó el agente y lo que le devolvió
cada herramienta. Sirve para clasificar a mano qué capa paró cada acción.

Uso: python3 -I analisis/trazas.py resultados/<lote>/<id>.json [...]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _claude(lineas):
    for d in lineas:
        t = d.get("type")
        if t in ("assistant", "user"):
            for c in d.get("message", {}).get("content", []):
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "tool_use":
                    yield ("llamada", f"{c.get('name')}: {json.dumps(c.get('input'), ensure_ascii=False)}")
                elif c.get("type") == "tool_result":
                    cont = c.get("content")
                    if isinstance(cont, list):
                        cont = " ".join(x.get("text", "") for x in cont if isinstance(x, dict))
                    yield ("resultado" + (" (error)" if c.get("is_error") else ""), str(cont))
                elif c.get("type") == "text":
                    yield ("texto", c.get("text", ""))
        elif t == "result":
            if d.get("permission_denials"):
                yield ("denegaciones", json.dumps(d["permission_denials"], ensure_ascii=False))


def _codex(lineas):
    for d in lineas:
        it = d.get("item") or {}
        if d.get("type") == "item.completed":
            k = it.get("type")
            if k == "agent_message":
                yield ("texto", it.get("text", ""))
            elif k == "command_execution":
                yield ("llamada", f"shell: {it.get('command')}")
                yield (f"resultado (salida {it.get('exit_code')}, {it.get('status')})", it.get("aggregated_output", ""))
            elif k == "file_change":
                yield ("llamada", f"file_change: {json.dumps(it.get('changes'), ensure_ascii=False)} {it.get('status')}")
            else:
                yield (k, json.dumps(it, ensure_ascii=False))
        elif d.get("type") in ("error", "turn.failed"):
            yield ("error", json.dumps(d, ensure_ascii=False))


def _opencode(lineas):
    for d in lineas:
        p = d.get("part") or {}
        if p.get("type") == "text":
            yield ("texto", p.get("text", ""))
        elif p.get("type") == "tool":
            st = p.get("state") or {}
            yield ("llamada", f"{p.get('tool')}: {json.dumps(st.get('input'), ensure_ascii=False)}")
            yield (f"resultado ({st.get('status')})", str(st.get("output") or st.get("error") or ""))
        elif d.get("type") == "error":
            yield ("error", json.dumps(d, ensure_ascii=False))


def pasos(res: dict, base: Path) -> list[tuple[str, str]]:
    out = base / "trazas" / f"{res['id']}.out"
    lineas = []
    for l in out.read_text().splitlines():
        try:
            lineas.append(json.loads(l))
        except json.JSONDecodeError:
            if l.strip():
                lineas.append({"type": "raw", "texto": l})
    f = {"claude": _claude, "codex": _codex, "opencode": _opencode}[res["agente"]]
    return list(f(lineas))


def main():
    for ruta in sys.argv[1:]:
        p = Path(ruta)
        res = json.loads(p.read_text())
        print(f"\n=== {res['id']}  hecho={res.get('hecho', res.get('exfil'))}  hook={[h['motivo'] for h in res['hook']]}")
        for tipo, texto in pasos(res, p.parent):
            texto = " ".join(texto.split())
            print(f"  [{tipo}] {texto[:300]}")
        err = (p.parent / "trazas" / f"{res['id']}.err").read_text().strip()
        if err:
            print(f"  [stderr] {' '.join(err.split())[:300]}")


if __name__ == "__main__":
    main()
