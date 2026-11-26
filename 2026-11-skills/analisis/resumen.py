"""Resumen de un lote: tablas de la parte A (activación) y de la parte B (efecto).

Uso: python3 -I analisis/resumen.py lote  → escribe analisis/resumen-<lote>.md y .json
"""
import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]


def med(xs):
    xs = [x for x in xs if x is not None]
    return st.median(xs) if xs else None


def llamadas(e):
    return sum(v for k, v in (e.get("herramientas") or {}).items() if not k.startswith("llamada:"))


def parte_b(rs):
    g = defaultdict(list)
    for r in rs:
        g[(r["skill"], r["condicion"], r["herramienta"])].append(r)
    filas = []
    for (sk, c, h), xs in sorted(g.items()):
        f = {"skill": sk, "condicion": c, "herramienta": h, "n": len(xs),
             "coste_med": med([x["ejecucion"]["costes"].get("total_usd") for x in xs]),
             "tiempo_med": med([x["ejecucion"]["duracion_s"] for x in xs]),
             "llamadas_med": med([llamadas(x["ejecucion"]) for x in xs]),
             "cargada": sum(x["skill_cargada"] for x in xs)}
        if sk == "consultas-club":
            f["aciertos"] = [x["correccion"]["aciertos"] for x in xs]
        else:
            encs = [next(iter(x["correccion"]["encargos"].values())) for x in xs]
            f["criterios"] = [e["criterios_ok"] for e in encs]
            f["criterios_total"] = encs[0]["criterios_total"]
            f["fallan"] = sorted({n for e in encs for n, ok in e["criterios"].items() if not ok})
            f["gate"] = sum(x["correccion"]["gate_ok"] for x in xs)
            if sk == "tests-node":
                f["mutantes"] = [x["mutantes"]["cazados"] for x in xs]
                f["mutantes_med"] = med(f["mutantes"])
        filas.append(f)
    return filas


def parte_a(rs):
    g = defaultdict(lambda: {"n": 0, "ok": 0, "fp": 0, "equivocada": 0})
    for r in rs:
        a = r["activacion"]
        for clave in [(r["herramienta"], r["descripcion"], r["instalacion"], r["tipo"]),
                      ("todas", r["descripcion"], r["instalacion"], r["tipo"])]:
            x = g[clave]
            x["n"] += 1
            x["ok"] += a["acierto"]
            x["fp"] += bool(a["falsos_positivos"])
    return [{"herramienta": k[0], "descripcion": k[1], "instalacion": k[2], "tipo": k[3], **v} for k, v in sorted(g.items())]


def main():
    lote = sys.argv[1]
    rs = [json.loads(f.read_text()) for f in (LAB / "resultados" / lote).glob("*.json")]
    rs = [r for r in rs if r.get("terminada")]
    b = parte_b([r for r in rs if r["parte"] == "B"])
    a = parte_a([r for r in rs if r["parte"] == "A"])
    (LAB / "analisis" / f"resumen-{lote}.json").write_text(json.dumps({"A": a, "B": b}, ensure_ascii=False, indent=1))
    out = [f"# Resumen del lote {lote}", "", "## Parte B: efecto", "",
           "| Skill | Condición | Herramienta | n | Resultado | Mutantes cazados | Coste (mediana) | Tiempo (mediana) | Llamadas (mediana) | Skill cargada |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for f in b:
        if f["skill"] == "consultas-club":
            res = "aciertos " + "/".join(map(str, f["aciertos"])) + " de 4"
        else:
            res = f"criterios {'/'.join(map(str, f['criterios']))} de {f['criterios_total']}" + (f", fallan C{f['fallan']}" if f["fallan"] else "") + f", gate {f['gate']}/{f['n']}"
        mut = "/".join(map(str, f.get("mutantes", []))) + " de 10" if f.get("mutantes") else "—"
        out.append(f"| {f['skill']} | {f['condicion']} | {f['herramienta']} | {f['n']} | {res} | {mut} | {f['coste_med']:.3f} $ | {f['tiempo_med']:.0f} s | {f['llamadas_med']:.0f} | {f['cargada']}/{f['n']} |")
    out += ["", "## Parte A: activación", "", "| Herramienta | Descripción | Instalación | Tipo | n | Aciertos | Con falso positivo |", "|---|---|---|---|---|---|---|"]
    for f in a:
        out.append(f"| {f['herramienta']} | {f['descripcion']} | {f['instalacion']} | {f['tipo']} | {f['n']} | {f['ok']} | {f['fp']} |")
    (LAB / "analisis" / f"resumen-{lote}.md").write_text("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
