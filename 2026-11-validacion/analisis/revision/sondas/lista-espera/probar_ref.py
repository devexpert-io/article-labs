"""Ejecuta una prueba propia (un *.test.ts que usa ayuda.ts, como los tests ocultos) contra un estado guardado de una
cadena, dentro de la misma caja que usa el corrector. No toca la carpeta del estado.

Uso:
  python3 -I probar.py <carpeta del estado> <commit> <prueba.test.ts>   # p. ej. .../ejecuciones/completo/<cadena>/B 371bec8
  python3 -I probar.py --base <prueba.test.ts>                         # contra la base del club, sin ninguna feature
"""
import shutil, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, "/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion/runner")
from agentes import LAB, SCR
from calificar import OCULTOS, copiar_estado, ejecutar_en_caja

args = sys.argv[1:]
raiz = SCR / ".c"
raiz.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=raiz) as tmp:
    copia = Path(tmp) / "repo"
    if args[0] == "--base":
        copiar_estado(LAB / "referencias" / "lista-espera", copia)
        if (copia / "node_modules").is_symlink(): (copia / "node_modules").unlink()
        if not (copia / "node_modules").exists(): subprocess.run(["cp", "-al", str(LAB / "club" / "node_modules"), str(copia / "node_modules")], check=True)
        prueba = Path(args[1])
    else:
        estado, commit, prueba = Path(args[0]), args[1], Path(args[2])
        copia.mkdir()
        tar = subprocess.run(["git", "-C", str(estado), "archive", commit], capture_output=True, check=True).stdout
        subprocess.run(["tar", "-x", "-C", str(copia)], input=tar, check=True)
        subprocess.run(["cp", "-al", str(LAB / "club" / "node_modules"), str(copia / "node_modules")], check=True)
    (copia / "test-ocultos").mkdir(exist_ok=True)
    shutil.copy(OCULTOS / "ayuda.ts", copia / "test-ocultos" / "ayuda.ts")
    shutil.copy(prueba, copia / "test-ocultos" / prueba.name)
    rc, salida = ejecutar_en_caja(copia, ["node", "--test", "--test-reporter=spec", "--test-timeout=60000", f"test-ocultos/{prueba.name}"], 300)
    print(salida[-6000:])
    print("rc:", rc)
