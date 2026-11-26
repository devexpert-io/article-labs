"""¿Compensa tener una skill instalada? Lo que cuesta su descripción en cada sesión frente a lo que ahorra cuando se
usa (27-nov-2026).

- Tokens de una descripción: la diferencia de contexto inicial entre 0 y 3 skills (sondas/resultados/listado.json),
  dividida entre 3. Son las descripciones concretas del experimento (unos 300 caracteres).
- Una sesión paga esos tokens en cada petición: la primera, como escritura de caché (Claude) o entrada (Codex y
  OpenCode), y las demás como lectura de caché. Peticiones por sesión: mediana de las ejecuciones sin skill de la
  parte B (encargos de minutos).
- Ahorro por uso: coste mediano sin skill menos con skill en la parte B (facturas y consultas).
- Sesiones que paga un uso: ahorro / coste por sesión.
"""
import json
import statistics as st
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
P = json.loads((LAB / "analisis" / "precios.json").read_text())["modelos"]
MODELO = {"claude": "claude-opus-5-5", "codex": "gpt-6.1-sol", "opencode": "nan/deepseek-v4-pro"}
son = json.loads((LAB / "analisis" / "sondas" / "resultados" / "listado.json").read_text())
B = [json.loads(f.read_text()) for f in (LAB / "resultados" / "lote").glob("B-*.json")]


def entrada(h, n):
    return st.median([r["entrada_primera"] for r in son if r["herramienta"] == h and r["skills"] == n])


def coste(h, skill, cond):
    return st.median([r["ejecucion"]["costes"]["total_usd"] for r in B if r["herramienta"] == h and r["skill"] == skill and r["condicion"] == cond])


filas = []
for h, m in MODELO.items():
    p = P[m]
    por_skill = (entrada(h, 3) - entrada(h, 0)) / 3
    # Codex y OpenCode no dan el número de peticiones al modelo: se aproxima con las llamadas a herramientas más una
    # (cada llamada obliga a una petición más). En Claude Code sale de la transcripción.
    def n(r):
        e = r["ejecucion"]
        return e["principal"]["uso"]["peticiones"] or (sum(v for k, v in (e.get("herramientas") or {}).items()
                                                            if not k.startswith("llamada:")) + 1)
    peticiones = st.median([n(r) for r in B if r["herramienta"] == h and r["condicion"] in ("sin", "sin-potente")])
    primera = p.get("cache_escrita_5m", p["entrada"])
    sesion = por_skill * (primera + (peticiones - 1) * p["cache_leida"]) / 1e6
    f = {"herramienta": h, "tokens_por_descripcion": round(por_skill), "tokens_33_skills": entrada(h, 33) - entrada(h, 0),
         "peticiones_por_sesion": peticiones, "coste_descripcion_por_sesion_usd": round(sesion, 6)}
    for sk in ("facturas-gestoria", "consultas-club"):
        ahorro = coste(h, sk, "sin") - coste(h, sk, "skill")
        f[f"ahorro_{sk}_usd"] = round(ahorro, 4)
        f[f"sesiones_que_paga_{sk}"] = round(ahorro / sesion) if sesion and ahorro > 0 else None
    filas.append(f)
(LAB / "analisis" / "coste-listado.json").write_text(json.dumps(filas, indent=1))
for f in filas:
    print(f)
