"""Calibración del juez sin humanos (27-nov-2026): en las parejas de tests, la "verdad" es qué entrega tiene tests que
cazan más fallos metidos a propósito (mutantes). Se compara con lo que eligió cada juez.

- Solo cuentan las parejas en las que los mutantes distinguen (una caza más que la otra). Si empatan, el juez no
  puede acertar ni fallar contra esta verdad: se cuentan aparte.
"""
import json
from collections import Counter
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
lote = LAB / "resultados" / "lote"
B = {}
for f in lote.glob("B-*tests-node*.json"):
    r = json.loads(f.read_text())
    B[(r["herramienta"], r["condicion"], r["rep"])] = r["mutantes"]["cazados"]
c = Counter()
for f in (lote / "juez").glob("*tests-node*.json"):
    v = json.loads(f.read_text())
    h = v["pareja"].split("-")[0]
    rep = int(v["pareja"].rsplit("-r", 1)[1])
    mx, my = B[(h, v["x"], rep)], B[(h, v["y"], rep)]
    verdad = v["x"] if mx > my else v["y"] if my > mx else "empate"
    if verdad == "empate":
        c[(v["juez"], "mutantes empatan", "juez dice empate" if v["gana"] == "empate" else "juez elige una")] += 1
    else:
        c[(v["juez"], "mutantes distinguen", "acierta" if v["gana"] == verdad else "empate" if v["gana"] == "empate" else "falla")] += 1
for k, n in sorted(c.items()):
    print(k, n)
