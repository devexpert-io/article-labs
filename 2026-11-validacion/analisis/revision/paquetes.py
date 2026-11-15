"""Un paquete por encargo con los hallazgos de cada veredicto revise o block sobre un estado que los tests ocultos dan
por completo, con la carpeta y el commit del estado que se validó.

Uso: python3 -I analisis/revision/paquetes.py <carpeta-de-salida> [<lote>]   (el lote, "completo" por defecto)"""
import json, glob, sys
from collections import Counter
from pathlib import Path
LOTE = sys.argv[2] if len(sys.argv) > 2 else "completo"
EJ = f"/var/tmp/lab-validacion/ejecuciones/{LOTE}"
salida = Path(sys.argv[1]); salida.mkdir(exist_ok=True)
por_encargo = {}
for f in sorted(glob.glob(f'/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion/resultados/{LOTE}/*.json')):
    r = json.load(open(f))
    vals = []
    if r.get("D"):
        vals.append(("D", 1, r["config"], r["D"]["veredicto"], r["A"], f"{EJ}/{r['id']}/impl", r["commit_implementacion"]))
    for rama in ("B", "C"):
        x = r.get(rama)
        if not x: continue
        for ro in x["rondas"]:
            commit = r["commit_implementacion"] if ro["ronda"] == 1 else x["rondas"][ro["ronda"] - 2]["commit"]
            vals.append((rama, ro["ronda"], x["validador"], ro["veredicto"], ro["evaluacion_validada"], f"{EJ}/{r['id']}/{rama}", commit, ro.get("commit")))
    vals = [v if len(v) == 8 else (*v, None) for v in vals]
    for cond, ronda, validador, v, ev, carpeta, commit, reparado in vals:
        if not v or v["veredicto"] not in ("revise", "block") or not ev["completo"]:
            continue
        marcas = {str(c.get("n")): c for c in v.get("criterios", []) or []}
        hallazgos = v.get("hallazgos") or []
        if not hallazgos:
            hallazgos = [{"gravedad": None, "criterio": c.get("n"), "descripcion": c.get("evidencia"), "cambio": None}
                         for c in v.get("criterios", []) if str(c.get("estado")) in ("no_cumple", "sin_evidencia")]
        for i, h in enumerate(hallazgos, 1):
            m = marcas.get(str(h.get("criterio")))
            por_encargo.setdefault(r["encargo"], []).append({
                "id": f"{r['id']}/{cond}{ronda}/h{i}", "cadena": r["id"], "implementa": r["config"], "condicion": cond,
                "ronda": ronda, "validador": validador, "veredicto": v["veredicto"], "gravedad": h.get("gravedad"),
                "criterio": h.get("criterio"), "descripcion": h.get("descripcion"), "cambio": h.get("cambio"),
                "marca_del_criterio": m and {"estado": m.get("estado"), "evidencia": m.get("evidencia")},
                "estado_validado": {"carpeta": carpeta, "commit": commit},
                "estado_reparado": reparado and {"carpeta": carpeta, "commit": reparado}})
for e, hs in por_encargo.items():
    (salida / f"{e}.json").write_text(json.dumps(hs, ensure_ascii=False, indent=1))
print({e: len(hs) for e, hs in por_encargo.items()}, sum(len(h) for h in por_encargo.values()))
print(Counter(h["gravedad"] for hs in por_encargo.values() for h in hs))
