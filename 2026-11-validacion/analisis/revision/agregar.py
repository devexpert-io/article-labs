import json, glob
from collections import Counter, defaultdict
D = str(__import__("pathlib").Path(__file__).resolve().parent)
paq, rev = {}, {}
for f in glob.glob(f"{D}/paquetes/*.json"):
    for h in json.load(open(f)): paq[h["id"]] = h
for f in glob.glob(f"{D}/clasificacion/*.json"):
    for h in json.load(open(f)): rev[h["id"]] = h
print("paquete", len(paq), "revisados", len(rev), "sin revisar", len(set(paq) - set(rev)), "de más", len(set(rev) - set(paq)))
print("categorías:", Counter(r["categoria"] for r in rev.values()))
print("defectos por tipo:", Counter(r.get("tipo") for r in rev.values() if r["categoria"] == "defecto"))
raiz = {i: r for i, r in rev.items() if r["categoria"] == "defecto" and not r.get("mismo_que")}
print("defectos distintos (sin mismo_que):", len(raiz), Counter((r.get("tipo"), r.get("gravedad_real")) for r in raiz.values()))
print("de ellos, en estados de la implementación (ronda 1 o D):", sum(1 for i in raiz if paq[i]["ronda"] == 1))
# Por veredicto: (cadena, condición, ronda)
ver = defaultdict(list)
for i, h in paq.items():
    ver[(h["cadena"], h["condicion"], h["ronda"], h["validador"], h["implementa"])].append(rev[i])
print("\nveredictos revise/block sobre trabajo completo:", len(ver))
tabla = defaultdict(lambda: Counter())
for (cad, cond, ronda, val, imp), rs in ver.items():
    clave = (imp, cond, val)
    t = tabla[clave]
    t["peticiones"] += 1
    if ronda == 1: t["peticiones_r1"] += 1
    cats = {r["categoria"] for r in rs}
    tipos = {r.get("tipo") for r in rs if r["categoria"] == "defecto"}
    if "defecto" in cats: t["con_defecto"] += 1
    if "comportamiento" in tipos: t["con_fallo_comportamiento"] += 1
    if ronda == 1 and "defecto" in cats: t["r1_con_defecto"] += 1
    if ronda == 1 and "comportamiento" in tipos: t["r1_con_comportamiento"] += 1
    for r in rs: t[r["categoria"]] += 1
print(f"{'implementa':9} {'cond':4} {'valida':9} | pet. | con defecto | con fallo de comport. | r1: pet. con defecto con comport. | hallazgos: defecto previo de_mas error ambigua")
for clave in sorted(tabla, key=lambda k: (["opus","sol","haiku","luna","deepseek"].index(k[0]), k[1])):
    t = tabla[clave]
    print(f"{clave[0]:9} {clave[1]:4} {clave[2]:9} | {t['peticiones']:4} | {t['con_defecto']:11} | {t['con_fallo_comportamiento']:21} | {t['peticiones_r1']:7} {t['r1_con_defecto']:11} {t['r1_con_comportamiento']:12} | {t['defecto']:7} {t['previo']:6} {t['de_mas']:6} {t['error']:5} {t['ambigua']:7}")
# Arreglos
arr = Counter(str(r.get("arreglado")) for r in rev.values() if r["categoria"] == "defecto")
print("\ndefectos (todos los hallazgos) arreglado:", arr)
print("defectos distintos arreglado:", Counter(str(r.get("arreglado")) for r in raiz.values()))
# Implementaciones (estado A) con algún defecto real según la revisión
impl_con = defaultdict(set)
for i, r in rev.items():
    h = paq[i]
    if r["categoria"] == "defecto" and h["ronda"] == 1:
        impl_con[h["implementa"]].add(h["cadena"])
for k in ["opus","sol","haiku","luna","deepseek"]:
    print(f"implementaciones de {k} con algún defecto real marcado en su primera validación: {len(impl_con[k])} -> {sorted(impl_con[k])}")
json.dump({"raiz": list(raiz)}, open(f"{D}/agregado.json", "w"))
