"""Resumen de los veredictos del juez a ciegas (parte B y parte C).

Uso: python3 -I analisis/juez.py lote
- Por pareja de condiciones: cuántas veces gana cada una o empatan, por juez.
- Parte C: cuántas veces cambia el veredicto al invertir el orden (sesgo de posición) y cuántas coinciden los dos
  jueces.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]


def main():
    lote = sys.argv[1]
    vs = [json.loads(f.read_text()) for f in (LAB / "resultados" / lote / "juez").glob("*.json")]
    por = defaultdict(Counter)
    for v in vs:
        sk = v["pareja"].split("-", 1)[1].rsplit("-r", 1)[0]
        sk = "-".join(sk.split("-")[:2])
        g = v["gana"] if v["gana"] in (v["x"], v["y"]) else ("empate" if v["gana"] == "empate" else "sin veredicto")
        etiqueta = "x" if g == v["x"] else "y" if g == v["y"] else g
        por[(sk, v["x"], v["y"], v["juez"])][etiqueta] += 1
    print("| Skill | X | Y | Juez | Gana X | Gana Y | Empate | Sin veredicto |")
    print("|---|---|---|---|---|---|---|---|")
    for (sk, x, y, j), c in sorted(por.items()):
        print(f"| {sk} | {x} | {y} | {j} | {c['x']} | {c['y']} | {c['empate']} | {c['sin veredicto']} |")
    # Parte C
    idx = defaultdict(dict)
    for v in vs:
        idx[(v["pareja"], v["juez"])][v["orden"]] = v["gana"]
    cambia = Counter()
    total = Counter()
    for (p, j), o in idx.items():
        if "xy" in o and "yx" in o:
            total[j] += 1
            cambia[j] += o["xy"] != o["yx"]
    print()
    for j in total:
        print(f"{j}: el veredicto cambia al invertir el orden en {cambia[j]} de {total[j]} parejas")
    acuerdo = n = 0
    for (p, j), o in idx.items():
        if j != "opus":
            continue
        otro = idx.get((p, "sol"), {})
        for orden in ("xy", "yx"):
            if orden in o and orden in otro:
                n += 1
                acuerdo += o[orden] == otro[orden]
    print(f"los dos jueces coinciden en {acuerdo} de {n} juicios")


if __name__ == "__main__":
    main()
