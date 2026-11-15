"""Ejecuta un fichero de tests ampliados de un encargo contra todos sus estados: la implementación (A), el estado final
de B y el de C de cada cadena del lote completo, más la base y la implementación de referencia. Corre en la misma caja que
el corrector y, como él, repite una vez los tests que fallan (cuenta como pasado si pasa en alguna de las dos).

Uso: python3 -I ampliar.py <encargo> <ampliados.test.ts> <salida.json>   (LOTE=grande para otro lote; completo por defecto)
"""
import json, os, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, "/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion/runner")
from agentes import LAB, SCR
from calificar import OCULTOS, copiar_estado, ejecutar_en_caja, leer_tap

encargo, prueba, salida = sys.argv[1], Path(sys.argv[2]).resolve(), Path(sys.argv[3])
EJ = SCR / "ejecuciones" / os.environ.get("LOTE", "completo")
estados = [("base", LAB / "club", None), ("referencia", LAB / "referencias" / encargo, None)]
for c in sorted(EJ.glob(f"{encargo}-*-r*")):
    for nombre, sub in (("A", "impl"), ("B", "B"), ("C", "C")):
        if (c / sub / ".git").exists():
            estados.append((f"{c.name}/{nombre}", c / sub, "HEAD"))

def correr(e):
    nombre, carpeta, commit = e
    (SCR / ".c").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=SCR / ".c") as tmp:
        copia = Path(tmp) / "repo"
        if commit is None:
            copiar_estado(carpeta, copia)
            if (copia / "node_modules").is_symlink() or not (copia / "node_modules").exists():
                if (copia / "node_modules").is_symlink():
                    (copia / "node_modules").unlink()
                subprocess.run(["cp", "-al", str(LAB / "club" / "node_modules"), str(copia / "node_modules")], check=True)
        else:
            copia.mkdir()
            tar = subprocess.run(["git", "-C", str(carpeta), "archive", commit], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(copia)], input=tar, check=True)
            subprocess.run(["cp", "-al", str(LAB / "club" / "node_modules"), str(copia / "node_modules")], check=True)
        (copia / "test-ocultos").mkdir(exist_ok=True)
        shutil.copy(OCULTOS / "ayuda.ts", copia / "test-ocultos" / "ayuda.ts")
        shutil.copy(prueba, copia / "test-ocultos" / prueba.name)
        orden = ["node", "--test", "--test-reporter=tap", "--test-timeout=60000", f"test-ocultos/{prueba.name}"]
        rc, out = ejecutar_en_caja(copia, orden, 600)
        tests = leer_tap(out)
        if not tests or not all(tests.values()):
            rc2, out2 = ejecutar_en_caja(copia, orden, 600)
            segunda = leer_tap(out2)
            tests = {n: ok or bool(segunda.get(n)) for n, ok in {**segunda, **tests}.items()}
        return nombre, tests or {"(no arrancó)": False}

with ThreadPoolExecutor(4) as ex:
    resultados = dict(ex.map(correr, estados))
salida.write_text(json.dumps(resultados, ensure_ascii=False, indent=1))
nombres = sorted({n for t in resultados.values() for n in t})
for i, n in enumerate(nombres, 1):
    print(f"T{i} = {n}")
print(f"{'estado':34} " + " ".join(f"T{i:<2}" for i in range(1, len(nombres) + 1)))
for e, t in resultados.items():
    print(f"{e:34} " + " ".join((" ok" if t.get(n) else (" --" if n not in t else " ✗ ")) for n in nombres))
