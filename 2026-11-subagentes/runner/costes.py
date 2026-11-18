"""Coste de una ejecución a precio público de API (analisis/precios.json), por agente y en total.

Claude Code da su propio coste por modelo a precio de lista (modelUsage.costUSD): es el que se usa, y el calculado
con la tabla queda al lado para comprobarlo. Codex y OpenCode no lo dan (OpenCode da uno, pero con sus propios
precios), así que se calcula con la tabla.
"""
import json
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
PRECIOS = json.loads((LAB / "analisis" / "precios.json").read_text())["modelos"]


def precio_de(modelo: str | None) -> dict | None:
    if not modelo:
        return None
    if modelo in PRECIOS:
        return PRECIOS[modelo]
    for nombre, p in PRECIOS.items():
        if modelo.endswith(nombre.split("/")[-1]) or modelo.startswith(nombre):
            return p
    return None


def coste_uso(modelo: str | None, uso: dict, herramienta: str) -> float | None:
    p = precio_de(modelo)
    if not p:
        return None
    escrita_5m = uso.get("cache_escrita_5m", 0)
    escrita_1h = uso.get("cache_escrita_1h", 0)
    sin_cache = max(0, uso.get("entrada", 0) - uso.get("cache_leida", 0) - escrita_5m - escrita_1h)
    salida = uso.get("salida", 0)
    if herramienta == "opencode":
        salida += uso.get("razonamiento", 0)  # OpenCode cuenta el razonamiento aparte; Codex lo incluye en la salida
    if herramienta == "claude":
        escritas = escrita_5m * p["cache_escrita_5m"] + escrita_1h * p["cache_escrita_1h"]
    else:
        # Codex no tiene escrituras; las de OpenCode (DeepSeek no las cobra aparte) se cobran como entrada.
        escritas = (escrita_5m + escrita_1h) * p["entrada"]
    return (sin_cache * p["entrada"] + uso.get("cache_leida", 0) * p["cache_leida"] + escritas + salida * p["salida"]) / 1e6


def costes(m: dict) -> dict:
    """Coste del principal, de los subagentes y total. Para Claude, el total bueno es el de modelUsage."""
    h = m.get("herramienta")
    principal = coste_uso(m["principal"].get("modelo"), m["principal"]["uso"], h)
    subs = [coste_uso(s.get("modelo"), s["uso"], h) for s in m.get("subagentes", [])]
    calculado = None if principal is None or any(c is None for c in subs) else principal + sum(subs)
    r = {"principal_usd": principal, "subagentes_usd": sum(c or 0 for c in subs), "total_calculado_usd": calculado}
    if h == "claude" and m.get("modelUsage"):
        r["por_modelo_herramienta_usd"] = {k: v.get("costUSD") for k, v in m["modelUsage"].items()}
        r["total_usd"] = sum(v.get("costUSD") or 0 for v in m["modelUsage"].values())
    else:
        r["total_usd"] = calculado
    return r
