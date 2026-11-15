"""¿Alguna implementación o reparación cambió los datos de la semilla? Compara el /_estado recién arrancado de cada
estado con el de la base, solo en los campos que ya tenía la base."""
import json, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, "/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion/runner")
from agentes import LAB, SCR
from calificar import OCULTOS, copiar_estado, ejecutar_en_caja
AQUI = Path(__file__).parent
EJ = SCR / "ejecuciones" / "completo"

def estado(carpeta: Path | None) -> dict | str:
    with tempfile.TemporaryDirectory(dir=SCR / ".c") as tmp:
        copia = Path(tmp) / "repo"
        if carpeta is None:
            copiar_estado(LAB / "club", copia)
        else:
            copia.mkdir()
            tar = subprocess.run(["git", "-C", str(carpeta), "archive", "HEAD"], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(copia)], input=tar, check=True)
            subprocess.run(["cp", "-al", str(LAB / "club" / "node_modules"), str(copia / "node_modules")], check=True)
        (copia / "test-ocultos").mkdir(exist_ok=True)
        shutil.copy(OCULTOS / "ayuda.ts", copia / "test-ocultos" / "ayuda.ts")
        shutil.copy(AQUI / "inicial.test.ts", copia / "test-ocultos" / "inicial.test.ts")
        rc, salida = ejecutar_en_caja(copia, ["node", "--test", "--test-reporter=spec", "test-ocultos/inicial.test.ts"], 120)
        m = re.search(r"@@INICIO@@(.*?)@@FIN@@", salida, re.S)
        return json.loads(m.group(1)) if m else f"sin estado (rc {rc}): {salida[-300:]}"

def diferencias(base: dict, otro: dict) -> list[str]:
    difs = []
    for clave, valor in base.items():
        if clave not in otro:
            difs.append(f"falta {clave}"); continue
        if isinstance(valor, list) and valor and isinstance(valor[0], dict) and "id" in valor[0]:
            suyos = {x.get("id"): x for x in otro[clave] if isinstance(x, dict)}
            claves_de_la_base = {k for x in valor for k in x}
            for x in valor:
                y = suyos.get(x["id"])
                if y is None:
                    difs.append(f"{clave}: falta {x['id']}"); continue
                for k in claves_de_la_base:
                    if y.get(k) != x.get(k):
                        difs.append(f"{clave} {x['id']}.{k}: {x.get(k)!r} -> {y.get(k)!r}")
            nuevas = {}
            for x in valor:
                y = suyos.get(x["id"]) or {}
                for k in set(y) - claves_de_la_base:
                    nuevas.setdefault(k, []).append(y[k])
            for k, vs in nuevas.items():
                distintos = sorted({json.dumps(v) for v in vs})
                difs.append(f"{clave}: campo nuevo {k} en {len(vs)} de {len(valor)} (valores {distintos[:4]})")
            extra = set(suyos) - {x["id"] for x in valor}
            if extra:
                difs.append(f"{clave}: {len(extra)} de más ({sorted(extra)[:3]})")
        elif otro[clave] != valor:
            difs.append(f"{clave}: {str(valor)[:60]} -> {str(otro[clave])[:60]}")
    return difs

base = estado(None)
assert isinstance(base, dict), base
carpetas = sorted(p for c in EJ.iterdir() for p in (c / "impl", c / "B", c / "C") if (p / ".git").exists())
with ThreadPoolExecutor(4) as ex:
    estados = list(ex.map(estado, carpetas))
limpios = 0
for carpeta, e in zip(carpetas, estados):
    nombre = f"{carpeta.parent.name}/{carpeta.name}"
    if isinstance(e, str):
        print(f"{nombre}: {e}"); continue
    d = diferencias(base, e)
    if d:
        print(f"{nombre}: {len(d)} diferencias: {d[:4]}")
    else:
        limpios += 1
print(f"{limpios} de {len(carpetas)} estados con la semilla intacta")
