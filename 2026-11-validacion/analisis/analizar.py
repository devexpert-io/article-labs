"""Resume un lote: encargos completos con y sin validador, lo que cuesta validar y lo que detecta cada validador.

Uso: python3 -I analisis/analizar.py <lote> [<lote> …]
Escribe analisis/<lote>.json y analisis/<lote>.md.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]

# Dólares por millón de tokens, a precio de API, para los agentes que no dan el coste (Codex y OpenCode).
# Claude Code da el suyo (total_cost_usd). Comprobados el 14-nov-2026:
# - OpenAI, developers.openai.com/api/docs/pricing (estándar, contexto corto). Codex no separa las escrituras
#   de caché, así que se cobran como entrada normal.
# - DeepSeek V4.1 Flash 1017: api-docs.deepseek.com/quick_start/pricing, comprobado el 15-nov-2026. Es la tarifa
#   base (la de OpenRouter con el proveedor DeepSeek). En horas punta (01:00-04:00 y 06:00-10:00 UTC, de lunes a
#   viernes) cuesta el doble, y eso cambia los dólares pero no los porcentajes. En el laboratorio se usó a través de
#   NaN Builders, con suscripción y con el nombre deepseek-v4-flash, que en NaN es la versión 4.1-1017 (su panel de
#   uso la llama así) y que la API de DeepSeek también atiende con la 1017.
PRECIOS = {
    "gpt-6.1-sol": {"entrada": 2.00, "cache": 0.10, "salida": 10.00},
    "gpt-6-luna": {"entrada": 0.10, "cache": 0.01, "salida": 0.50},
    "nan/deepseek-v4-flash": {"entrada": 0.15, "cache": 0.003, "salida": 0.60},
}
ORDEN = ["opus", "sol", "haiku", "luna", "deepseek"]
DIFICILES = {"duraciones", "reservas-fijas", "facturas"}
GRANDES = {"torneos", "partidos-abiertos"}


def dificultad(encargo: str) -> str:
    return "grande" if encargo in GRANDES else "dificil" if encargo in DIFICILES else "normal"


def coste(m: dict | None) -> float | None:
    if not m:
        return 0.0
    if m.get("coste_usd") is not None:
        return m["coste_usd"]
    p = PRECIOS.get(m.get("modelo") or "")
    if not p or p["entrada"] is None:
        return None
    sin_cache = max(0, (m.get("entrada") or 0) - (m.get("entrada_cache_leida") or 0))
    salida = (m.get("salida") or 0) + (m.get("razonamiento") or 0 if m.get("agente") == "opencode" else 0)
    return (sin_cache * p["entrada"] + (m.get("entrada_cache_leida") or 0) * p["cache"] + salida * p["salida"]) / 1e6


def solo_lo_reanudado(d: dict, impl: dict) -> dict:
    """D reanuda la sesión que implementó, y al reanudar Claude Code da el coste de toda la sesión (total_cost_usd y
    modelUsage, aunque `usage` sí es solo de la ejecución) y Codex los tokens de todo el hilo (turn.completed). Lo que
    cuesta validar en la misma sesión es la diferencia con lo que ya había gastado la implementación. OpenCode da los
    tokens de cada paso de la ejecución, así que ya vienen separados."""
    if d.get("agente") == "claude":
        return {**d, "coste_usd": (d.get("coste_usd") or 0) - (impl.get("coste_usd") or 0)}
    if d.get("agente") == "codex":
        return {**d, **{k: (d.get(k) or 0) - (impl.get(k) or 0) for k in ("entrada", "entrada_cache_leida", "salida", "razonamiento")}}
    return d


def suma(valores):
    vs = list(valores)
    return None if any(v is None for v in vs) else sum(vs)


def deteccion(veredicto: dict | None, evaluacion: dict) -> dict:
    """Compara lo que dice el validador, criterio a criterio, con los tests ocultos del estado que validó."""
    reales = {int(n): ok for n, ok in evaluacion["criterios"].items()}
    marcados = {}
    for c in (veredicto or {}).get("criterios", []) or []:
        try:
            marcados[int(c.get("n"))] = str(c.get("estado", "")).strip()
        except (TypeError, ValueError):
            continue
    fallos = [n for n, ok in reales.items() if not ok]
    cazados = [n for n in fallos if marcados.get(n) in ("no_cumple", "sin_evidencia")]
    falsas = [n for n, ok in reales.items() if ok and marcados.get(n) == "no_cumple"]
    return {"fallos": len(fallos), "cazados": len(cazados), "falsas_alarmas": len(falsas),
            "accept_con_fallos": bool(veredicto) and veredicto.get("veredicto") == "accept" and bool(fallos),
            "veredicto": (veredicto or {}).get("veredicto")}


def rama_resumen(r: dict, clave: str) -> dict | None:
    rama = r.get(clave)
    if not rama:
        return None
    validaciones = [p["validacion"] for p in rama["rondas"]]
    reparaciones = [p["reparacion"] for p in rama["rondas"] if p.get("reparacion")]
    a_ok = {int(n) for n, ok in r["A"]["criterios"].items() if ok}
    final_ok = {int(n) for n, ok in rama["final"]["criterios"].items() if ok}
    return {
        "completo": rama["final"]["completo"],
        "criterios_ok": rama["final"]["criterios_ok"],
        "veredicto_final": rama.get("veredicto_final"),
        "rondas": len(rama["rondas"]),
        "reparaciones": len(reparaciones),
        "coste_validar": suma(coste(m) for m in validaciones),
        "coste_reparar": suma(coste(m) for m in reparaciones),
        "minutos": sum((m.get("duracion_s") or 0) for m in validaciones + reparaciones) / 60,
        "estropeados": len(a_ok - final_ok),
        "deteccion_primera": deteccion(rama["rondas"][0]["veredicto"], rama["rondas"][0]["evaluacion_validada"]),
        "validador_toco": any(p.get("validador_toco") for p in rama["rondas"]),
    }


def analizar(lotes: list[str]) -> dict:
    cadenas = []
    for lote in lotes:
        for f in sorted((LAB / "resultados" / lote).glob("*.json")):
            r = json.loads(f.read_text())
            if not r.get("terminada"):
                continue
            impl = r["implementacion"]
            fila = {
                "id": r["id"], "encargo": r["encargo"], "dificultad": dificultad(r["encargo"]), "config": r["config"], "nivel": r["nivel"],
                "A_completo": r["A"]["completo"], "A_criterios": f"{r['A']['criterios_ok']}/{r['A']['criterios_total']}",
                "A_gate": r["A"]["gate_ok"], "coste_implementar": coste(impl), "minutos_implementar": (impl.get("duracion_s") or 0) / 60,
                "B": rama_resumen(r, "B"), "C": rama_resumen(r, "C"),
                "D": deteccion((r.get("D") or {}).get("veredicto"), r["A"]) if r.get("D") else None,
                "D_coste": coste(solo_lo_reanudado(r["D"]["validacion"], impl)) if r.get("D") else None,
            }
            cadenas.append(fila)
    tabla = {}
    presentes = {c["dificultad"] for c in cadenas}
    for dif in [d for d in ("normal", "dificil", "grande") if d in presentes] + ["todas"]:
        por_config = defaultdict(list)
        for c in cadenas:
            if dif == "todas" or c["dificultad"] == dif:
                por_config[c["config"]].append(c)
        tabla[dif] = tabla_por_config(por_config)
    return {"lotes": lotes, "cadenas": cadenas, "por_config": tabla}


def tabla_por_config(por_config: dict) -> dict:
    tabla = {}
    for config in ORDEN:
        cs = por_config.get(config, [])
        if not cs:
            continue
        fila = {"n": len(cs), "A_completos": sum(c["A_completo"] for c in cs),
                "coste_implementar": suma(c["coste_implementar"] for c in cs)}
        for rama in ("B", "C"):
            rs = [c[rama] for c in cs if c[rama]]
            if not rs:
                continue
            arreglados = sum(1 for c in cs if c[rama] and not c["A_completo"] and c[rama]["completo"])
            estropeados = sum(1 for c in cs if c[rama] and c["A_completo"] and not c[rama]["completo"])
            extra = suma((x["coste_validar"] or 0) + (x["coste_reparar"] or 0) if x["coste_validar"] is not None else None for x in rs)
            completos_validados = [c for c in cs if c[rama] and c["A_completo"]]
            fila[rama] = {
                "completos": sum(x["completo"] for x in rs), "arreglados": arreglados, "estropeados": estropeados,
                "coste_extra": extra, "minutos_extra": sum(x["minutos"] for x in rs),
                "pct_extra": (100 * extra / fila["coste_implementar"]) if extra is not None and fila["coste_implementar"] else None,
                # Trabajo que ya estaba completo y por el que el validador pidió cambios: reparaciones que no hacían falta.
                "completos_validados": len(completos_validados),
                "cambios_en_completos": sum(1 for c in completos_validados
                                            if c[rama]["deteccion_primera"]["veredicto"] in ("revise", "block")),
                "reparaciones_en_completos": sum(c[rama]["reparaciones"] for c in completos_validados),
                "coste_por_arreglado": (extra / arreglados) if extra is not None and arreglados else None,
                "compensa": arreglados >= 2 and estropeados == 0 and arreglados > estropeados,
                "deteccion": {k: sum(x["deteccion_primera"][k] for x in rs) for k in ("fallos", "cazados", "falsas_alarmas")},
                "accept_con_fallos": sum(x["deteccion_primera"]["accept_con_fallos"] for x in rs),
                "validador_toco": sum(x["validador_toco"] for x in rs),
            }
        ds = [c["D"] for c in cs if c["D"]]
        if ds:
            fila["D"] = {k: sum(d[k] for d in ds) for k in ("fallos", "cazados", "falsas_alarmas")}
            fila["D"]["accept_con_fallos"] = sum(d["accept_con_fallos"] for d in ds)
            fila["D"]["coste"] = suma(c["D_coste"] for c in cs if c["D"])
            fila["D"]["completos_validados"] = sum(1 for c in cs if c["D"] and c["A_completo"])
            fila["D"]["cambios_en_completos"] = sum(1 for c in cs if c["D"] and c["A_completo"]
                                                    and c["D"]["veredicto"] in ("revise", "block"))
        tabla[config] = fila
    return tabla


def markdown(res: dict) -> str:
    lineas = [f"# Resumen de {', '.join(res['lotes'])}"]
    fmt = lambda v: "—" if v is None else f"{v:.2f} $"  # noqa: E731
    for dif, tabla in res["por_config"].items():
        if not tabla:
            continue
        lineas += ["", f"## Encargos: {dif}", ""]
        lineas += tabla_md(tabla, fmt)
    lineas += ["", "## Cadenas", "", "| Cadena | A | B | C | D |", "|---|---|---|---|---|"]
    for c in res["cadenas"]:
        b = c["B"] and f"{c['B']['criterios_ok']} ({c['B']['veredicto_final']}, {c['B']['reparaciones']} rep.)"
        cc = c["C"] and f"{c['C']['criterios_ok']} ({c['C']['veredicto_final']}, {c['C']['reparaciones']} rep.)"
        d = c["D"] and f"{c['D']['veredicto']} ({c['D']['cazados']}/{c['D']['fallos']})"
        lineas.append(f"| {c['id']} | {c['A_criterios']}{'' if c['A_gate'] else ' (gate ✗)'} | {b or '—'} | {cc or '—'} | {d or '—'} |")
    return "\n".join(lineas) + "\n"


def tabla_md(tabla: dict, fmt) -> list[str]:
    lineas = ["| Config | n | A completos | B completos | B arreglados/estropeados | B coste extra | C completos | C arreglados/estropeados | C coste extra |",
              "|---|---|---|---|---|---|---|---|---|"]
    for config, f in tabla.items():
        b, c = f.get("B", {}), f.get("C", {})
        lineas.append(f"| {config} | {f['n']} | {f['A_completos']} | {b.get('completos', '—')} | "
                      f"{b.get('arreglados', '—')}/{b.get('estropeados', '—')} | {fmt(b.get('coste_extra'))} | "
                      f"{c.get('completos', '—')} | {c.get('arreglados', '—')}/{c.get('estropeados', '—')} | {fmt(c.get('coste_extra'))} |")
    pct = lambda v: "—" if v is None else f"{v:.0f} %"  # noqa: E731
    lineas += ["", "Lo que cuesta validar (B y C, con sus reparaciones):", "",
               "| Config | Cond. | Coste extra | Sobre implementar | Minutos extra | Coste por arreglado | ¿Compensa? | Cambios pedidos en trabajo completo | Reparaciones innecesarias | El validador tocó código |",
               "|---|---|---|---|---|---|---|---|---|---|"]
    for config, f in tabla.items():
        for cond in ("B", "C"):
            d = f.get(cond)
            if not d:
                continue
            lineas.append(f"| {config} | {cond} | {fmt(d['coste_extra'])} | {pct(d['pct_extra'])} | {d['minutos_extra']:.0f} | "
                          f"{fmt(d['coste_por_arreglado'])} | {'sí' if d['compensa'] else 'no'} | "
                          f"{d['cambios_en_completos']}/{d['completos_validados']} | {d['reparaciones_en_completos']} | {d['validador_toco']} |")
    lineas += ["", "Detección (primera validación):", "",
               "| Config | Condición | Fallos | Cazados | Falsas alarmas | accept con fallos |", "|---|---|---|---|---|---|"]
    for config, f in tabla.items():
        for cond in ("D", "B", "C"):
            d = f.get(cond)
            if not d:
                continue
            det = d if cond == "D" else d["deteccion"]
            acf = d["accept_con_fallos"]
            lineas.append(f"| {config} | {cond} | {det['fallos']} | {det['cazados']} | {det['falsas_alarmas']} | {acf} |")
    ds = [(config, f["D"]) for config, f in tabla.items() if f.get("D")]
    if ds:
        lineas += ["", "La misma sesión (D, solo detecta):", "", "| Config | Coste | Cambios pedidos en trabajo completo |", "|---|---|---|"]
        for config, d in ds:
            lineas.append(f"| {config} | {fmt(d['coste'])} | {d['cambios_en_completos']}/{d['completos_validados']} |")
    return lineas


if __name__ == "__main__":
    lotes = sys.argv[1:]
    res = analizar(lotes)
    nombre = "-".join(lotes)
    (LAB / "analisis" / f"{nombre}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    (LAB / "analisis" / f"{nombre}.md").write_text(markdown(res))
    print(markdown(res))
