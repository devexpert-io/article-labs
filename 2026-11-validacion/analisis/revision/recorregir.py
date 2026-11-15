"""Vuelve a corregir un commit concreto de una carpeta de estado, varias veces, con la máquina en reposo."""
import subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, "/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion/runner")
from agentes import LAB, SCR
from calificar import evaluar
carpeta, commit, encargo, veces = Path(sys.argv[1]), sys.argv[2], sys.argv[3], int(sys.argv[4])
for i in range(veces):
    with tempfile.TemporaryDirectory(dir=SCR) as t:
        copia = Path(t) / "estado"; copia.mkdir()
        tar = subprocess.run(["git", "-C", str(carpeta), "archive", commit], capture_output=True, check=True).stdout
        subprocess.run(["tar", "-x", "-C", str(copia)], input=tar, check=True)
        subprocess.run(["cp", "-al", str(LAB / "club" / "node_modules"), str(copia / "node_modules")], check=True)
        ev = evaluar(copia, encargo)
        fallan = [n for n, ok in ev["tests"].items() if not ok]
        print(f"  vuelta {i+1}: gate_ok={ev['gate_ok']} completo={ev['completo']} inestables={ev['inestables']} fallan={fallan}", flush=True)
