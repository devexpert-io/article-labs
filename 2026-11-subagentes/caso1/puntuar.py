"""Puntúa un inventario de variables de entorno del caso 1 contra caso1/referencia.json.

Uso: python3 -I caso1/puntuar.py <respuesta.txt> <carpeta del repo>   (o desde el runner: puntuar(texto, repo))

La respuesta del agente termina con un bloque ```json: una lista de {"nombre", "ficheros", "defecto"}.
- aciertos: nombres que están en la referencia.
- neutras: claves que next.config.ts inyecta en process.env con otro nombre (cloudMode…): no cuentan.
- errores: nombres que no lee el código. Entre ellos, `inventadas` son los que no aparecen en ningún fichero del
  repositorio, y `fuera_del_codigo` los que aparecen (en un Dockerfile, en la documentación…) pero no se leen.
- ficheros (secundario): de los pares variable-fichero de la referencia, cuántos da el agente para las variables
  que acierta, y cuántos ficheros da que no leen esa variable.
- defectos (secundario): de los valores por defecto puntuables de la referencia, cuántos da bien.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REFERENCIA = json.loads((Path(__file__).resolve().parent / "referencia.json").read_text())


def leer_inventario(texto: str) -> list[dict] | None:
    bloques = re.findall(r"```(?:json)?\s*(\[.*?\])\s*```", texto, re.S)
    for bloque in reversed(bloques):
        try:
            datos = json.loads(bloque)
        except json.JSONDecodeError:
            continue
        if isinstance(datos, list):
            return [d for d in datos if isinstance(d, dict)]
    return None


def _nombre(x) -> str:
    n = str(x or "").strip().strip("`'\"")
    n = re.sub(r"^process\.env\.?", "", n).strip("[]'\" ")
    return n


def _ruta(f: str, repo: Path) -> str:
    f = str(f).strip().strip("`")
    f = re.sub(r":\d+(-\d+)?$", "", f)  # ruta:línea
    f = f.removeprefix(str(repo)).lstrip("/")
    return f.removeprefix("./")


def aparece_en_repo(nombre: str, repo: Path) -> bool:
    p = subprocess.run(["grep", "-rqwF", "--exclude-dir=.git", "--exclude-dir=node_modules", nombre, str(repo)])
    return p.returncode == 0


def puntuar(texto: str, repo: Path) -> dict:
    inventario = leer_inventario(texto)
    if inventario is None:
        return {"inventario_legible": False}
    ref = REFERENCIA["variables"]
    neutras = set(REFERENCIA["neutras"])
    dados = {}
    for d in inventario:
        n = _nombre(d.get("nombre"))
        if not n:
            continue
        ficheros = d.get("ficheros") or []
        if isinstance(ficheros, str):
            ficheros = [ficheros]
        e = dados.setdefault(n, {"ficheros": set(), "defecto": []})
        e["ficheros"] |= {_ruta(f, repo) for f in ficheros}
        if d.get("defecto") not in (None, ""):
            e["defecto"].append(str(d.get("defecto")))
    aciertos = sorted(n for n in dados if n in ref)
    neutras_dadas = sorted(n for n in dados if n in neutras)
    errores = sorted(n for n in dados if n not in ref and n not in neutras)
    inventadas = [n for n in errores if not aparece_en_repo(n, repo)]
    pares_total = sum(len(v["ficheros"]) for v in ref.values())
    pares_ok, ficheros_de_mas = 0, 0
    for n in aciertos:
        buenos = set(ref[n]["ficheros"]) | set(ref[n].get("solo_escribe", []))
        pares_ok += len(set(ref[n]["ficheros"]) & dados[n]["ficheros"])
        ficheros_de_mas += len(dados[n]["ficheros"] - buenos)
    con_defecto = {n: v["defecto"] for n, v in ref.items() if v.get("defecto")}
    defectos_ok = sorted(n for n, validos in con_defecto.items()
                         if n in dados and any(v in d for v in validos for d in dados[n]["defecto"]))
    return {
        "inventario_legible": True,
        "dadas": len(dados),
        "referencia": len(ref),
        "aciertos": len(aciertos),
        "recall": round(len(aciertos) / len(ref), 3),
        "faltan": sorted(set(ref) - set(aciertos)),
        "neutras": neutras_dadas,
        "errores": errores,
        "inventadas": inventadas,
        "fuera_del_codigo": [n for n in errores if n not in inventadas],
        "pares_ok": pares_ok,
        "pares_total": pares_total,
        "ficheros_de_mas": ficheros_de_mas,
        "defectos_ok": len(defectos_ok),
        "defectos_total": len(con_defecto),
    }


if __name__ == "__main__":
    print(json.dumps(puntuar(Path(sys.argv[1]).read_text(), Path(sys.argv[2])), ensure_ascii=False, indent=1))
