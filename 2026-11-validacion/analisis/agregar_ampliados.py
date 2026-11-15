"""Completos con la vara ampliada: los tests ocultos más los tests ampliados (X…) que salieron de la revisión a mano.
Un estado está completo si cumple todos los criterios ocultos y pasa todos los tests ampliados de su encargo."""
import json, glob, sys
from collections import defaultdict
from pathlib import Path
LAB = Path("/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion")
D = LAB / "analisis"
DIFICILES = {"duraciones", "reservas-fijas", "facturas"}
ORDEN = ["opus", "sol", "haiku", "luna", "deepseek"]
SOLO = sys.argv[1] if len(sys.argv) > 1 else "todas"   # "todas" o "mayor"
GRAVEDAD = json.load(open(D / "ampliados" / "gravedad.json"))
matrices = {Path(f).stem: json.load(open(f)) for f in glob.glob(str(D / "ampliados" / "*.json")) if Path(f).stem not in ("gravedad",) and not Path(f).stem.startswith(("humo", "agregado"))}
print("matrices:", sorted(matrices))
filas = []
for f in sorted((LAB / "resultados" / "completo").glob("*.json")):
    r = json.load(open(f))
    m = matrices.get(r["encargo"])
    sin_ampliados = m is None   # reembolsos: ningún defecto de comportamiento que se vea por la API
    def ok(cond, evaluacion):
        x = {} if sin_ampliados else m.get(f"{r['id']}/{cond}")
        def cuenta(n):
            if SOLO == "todas": return True
            clave = n.split(" ")[0]
            return GRAVEDAD[r["encargo"]].get(clave) == SOLO
        fallan = [n for n, v in (x or {}).items() if not v and cuenta(n)]
        return evaluacion["completo"] and x is not None and not fallan, fallan
    fila = {"id": r["id"], "encargo": r["encargo"], "config": r["config"], "dif": "dificil" if r["encargo"] in DIFICILES else "normal"}
    fila["A"], fila["A_fallan"] = ok("A", r["A"])
    fila["B"], fila["B_fallan"] = ok("B", r["B"]["final"])
    if r.get("C"):
        fila["C"], fila["C_fallan"] = ok("C", r["C"]["final"])
    filas.append(fila)
json.dump(filas, open(D / "ampliados" / f"agregado-{SOLO}.json", "w"), ensure_ascii=False, indent=1)
print("vara:", SOLO)
for dif in ("normal", "dificil", "todas"):
    print(f"\n## {dif}")
    print(f"{'config':9} {'n':>3} {'A':>3} {'B':>3} {'B arr/est':>10} {'C':>3} {'C arr/est':>10}")
    for cfg in ORDEN:
        fs = [x for x in filas if x["config"] == cfg and (dif == "todas" or x["dif"] == dif)]
        if not fs: continue
        a = sum(x["A"] for x in fs); b = sum(x["B"] for x in fs)
        b_arr = sum(1 for x in fs if not x["A"] and x["B"]); b_est = sum(1 for x in fs if x["A"] and not x["B"])
        cs = [x for x in fs if "C" in x]
        c = sum(x["C"] for x in cs) if cs else None
        c_arr = sum(1 for x in cs if not x["A"] and x["C"]); c_est = sum(1 for x in cs if x["A"] and not x["C"])
        print(f"{cfg:9} {len(fs):3} {a:3} {b:3} {b_arr:>4}/{b_est:<5} {('—' if c is None else c):>3} {(f'{c_arr}/{c_est}' if cs else '—'):>10}")
