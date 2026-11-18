"""Sonda: ¿puede un subagente lanzar a su vez otro subagente? Una ejecución por herramienta, en una carpeta vacía."""
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runner"))
import agentes  # noqa: E402

PROMPT = ("Prueba de subagentes, sin tocar ficheros. Lanza un subagente con este encargo literal: "
          "'Lanza tú a tu vez un subagente que responda solo la palabra PING, espera su respuesta y devuélvemela. "
          "Si no tienes ninguna herramienta para lanzar subagentes, responde SIN_HERRAMIENTA y lista las herramientas que tienes.' "
          "Espera a que termine y dime exactamente qué devolvió.")
salida = Path(__file__).parent / "resultados"  # en el repo solo se guardan los .json, los logs van a $LAB_SCRATCH/sondas
salida.mkdir(exist_ok=True)
for h in sys.argv[1:]:
    with tempfile.TemporaryDirectory(dir=agentes.SCR) as d:
        cwd = Path(d) / "vacio"; cwd.mkdir()
        m = agentes.lanzar(h, PROMPT, cwd, salida / f"anidar-{h}.log", subagentes=True, confiar=(h == "codex"), limite_s=900)
        r = {"herramienta": h, "version": m["version"], "n_subagentes": m.get("n_subagentes"),
             "subagentes": [{"id": s.get("id"), "padre": s.get("padre"), "rol": s.get("rol")} for s in m.get("subagentes", [])],
             "coste": m.get("costes"), "respuesta": m.get("respuesta_final")}
        (salida / f"anidar-{h}.json").write_text(json.dumps(r, indent=1, ensure_ascii=False))
        print(json.dumps(r, ensure_ascii=False)[:1500], flush=True)
