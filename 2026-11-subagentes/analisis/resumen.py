"""Agrega resultados/<lote>/*.json en medias por caso, herramienta y condición.

Uso: python3 -I analisis/resumen.py [lote]  -> imprime tablas y escribe analisis/resumen-<lote>.json
"""
import json, statistics as st, sys
from pathlib import Path
from collections import defaultdict

LAB = Path(__file__).resolve().parent.parent
lote = sys.argv[1] if len(sys.argv) > 1 else "lote"
filas = []
for f in sorted((LAB / "resultados" / lote).glob("*.json")):
    d = json.loads(f.read_text())
    if not d.get("terminada"):
        continue
    e = d["ejecucion"]
    fila = {
        "id": d["id"], "caso": d["caso"], "herramienta": d["herramienta"], "condicion": d["condicion"],
        "encargo": d.get("encargo"), "coste": e["costes"]["total_usd"],
        "coste_sub": e["costes"].get("subagentes_usd") or 0, "duracion": e["duracion_s"],
        "contexto": e["principal"].get("contexto_final"), "n_sub": e.get("n_subagentes", 0),
        "tokens": e["total"]["entrada"] + e["total"]["salida"],
    }
    if d["caso"] == 1:
        p = d["puntuacion"]
        fila["calidad"] = p["aciertos"] / p["referencia"]
        fila["detalle"] = f"{p['aciertos']}/{p['referencia']} err={len(p['errores'])} inv={len(p['inventadas'])}"
    else:
        c = d["correccion"]
        ok = sum(v["criterios_ok"] for v in c["encargos"].values())
        tot = sum(v["criterios_total"] for v in c["encargos"].values())
        fila["calidad"] = ok / tot
        fila["completos"] = c["completos"]
        fila["detalle"] = f"{c['completos']}/{c['total']} completas, {ok}/{tot} criterios"
    filas.append(fila)

grupos = defaultdict(list)
for f in filas:
    grupos[(f["caso"], f["herramienta"], f["condicion"])].append(f)

med = lambda xs: st.median(xs) if xs else None  # noqa: E731
resumen = []
for (caso, h, c), fs in sorted(grupos.items()):
    r = {
        "caso": caso, "herramienta": h, "condicion": c, "n": len(fs),
        "coste_media": st.mean(x["coste"] for x in fs), "coste_mediana": med([x["coste"] for x in fs]),
        "duracion_mediana": med([x["duracion"] for x in fs]),
        "contexto_mediana": med([x["contexto"] for x in fs if x["contexto"]]),
        "subagentes_media": st.mean(x["n_sub"] for x in fs),
        "calidad_media": st.mean(x["calidad"] for x in fs),
        "detalles": [x["detalle"] for x in fs],
    }
    resumen.append(r)
    print(f"c{caso} {h:8} {c}  n={r['n']}  coste={r['coste_media']:.2f}$ (med {r['coste_mediana']:.2f})  "
          f"t={r['duracion_mediana']:.0f}s  ctx={r['contexto_mediana']/1000:.0f}K  sub={r['subagentes_media']:.1f}  "
          f"calidad={r['calidad_media']:.2f}  {r['detalles']}")
print(f"\n{len(filas)} ejecuciones, {sum(x['coste'] for x in filas):.2f}$ a precio de API")
(LAB / "analisis" / f"resumen-{lote}.json").write_text(json.dumps({"filas": filas, "grupos": resumen}, indent=1, ensure_ascii=False))

# Tabla en Markdown para el README: medianas por caso, herramienta y condición.
nombres = {"claude": "Claude Code", "codex": "Codex", "opencode": "OpenCode"}
lineas = ["| Caso | Herramienta | Condición | n | Coste (mediana) | Tiempo (mediana) | Contexto final del principal (mediana) | Subagentes | Resultado |",
          "|---|---|---|---|---|---|---|---|---|"]
for (caso, h, c), fs in sorted(grupos.items()):
    coste = med([x["coste"] for x in fs]); t = med([x["duracion"] for x in fs]); ctx = med([x["contexto"] for x in fs if x["contexto"]])
    subs = "/".join(str(x["n_sub"]) for x in fs)
    res = "; ".join(x["detalle"] for x in fs) if caso == 1 else ", ".join(x["detalle"].split(",")[0] for x in fs)
    lineas.append(f"| {caso} | {nombres[h]} | {c} | {len(fs)} | {f'{coste:.2f}'.replace('.', ',')} $ | {t:.0f} s | {f'{ctx:,.0f}'.replace(',', '.')} | {subs} | {res} |")
(LAB / "analisis" / f"resumen-{lote}.md").write_text("\n".join(lineas) + "\n")
