"""¿Cazan fallos los tests que escribe el agente? (parte B, skill 3)

Los tests ocultos de reembolsos los pasan casi todas las ejecuciones (piloto), así que no distinguen unas condiciones
de otras. Lo que sí puede cambiar con la skill es la calidad de los tests del agente. Para medirla:

1. Se copia la implementación de referencia (mutantes/referencia) y se le ponen los tests del agente (su carpeta
   test/ entera, con su ayuda.ts).
2. Se pasan con la referencia: los tests que pasan son los que valen (un test que falla con la referencia comprueba
   algo que la spec no pide, o depende de cómo lo implementó el agente).
3. Se pasan con cada mutante (mutantes/mutantes.json, un fallo metido a propósito): el mutante está cazado si alguno
   de los tests que valen falla.
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agentes import LAB, SCR  # noqa: E402
from calificar import ejecutar_en_caja, leer_tap  # noqa: E402

REFERENCIA = LAB / "mutantes" / "referencia"
MUTANTES = json.loads((LAB / "mutantes" / "mutantes.json").read_text())["mutantes"]
NODE_MODULES = LAB / "club" / "node_modules"


def _copia(destino: Path, tests: Path | None) -> None:
    shutil.copytree(REFERENCIA, destino, ignore=shutil.ignore_patterns("node_modules", "test"))
    subprocess.run(["cp", "-al", str(NODE_MODULES), str(destino / "node_modules")], check=True)
    shutil.copytree(tests if tests else REFERENCIA / "test", destino / "test")


def _pasar(repo: Path) -> dict[str, bool]:
    _, salida = ejecutar_en_caja(repo, ["node", "--test", "--test-reporter=tap", "--test-timeout=30000", "--test-force-exit", "test/"], 180)
    return leer_tap(salida)


def cazar(tests_agente: Path, ocultos: Path | None = None) -> dict:
    """`tests_agente`: la carpeta test/ que dejó el agente. Con `ocultos`, se usan esos tests (para comprobar que
    cada mutante es un fallo de verdad)."""
    raiz = SCR / ".c"
    raiz.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=raiz) as tmp:
        base = Path(tmp) / "repo"
        _copia(base, ocultos or tests_agente)
        if ocultos:
            shutil.copy(ocultos.parent / "ayuda.ts", base / "test" / "ayuda.ts")
        en_referencia = _pasar(base)
        validos = sorted(n for n, ok in en_referencia.items() if ok)
        resultado = {"tests": len(en_referencia), "validos": len(validos), "mutantes": {}}
        nucleo = base / "src" / "nucleo.ts"
        original = nucleo.read_text()
        for m in MUTANTES:
            nucleo.write_text(original.replace(m["de"], m["a"], 1))
            tests = _pasar(base)
            caen = [n for n in validos if tests.get(n) is False or n not in tests]
            resultado["mutantes"][m["id"]] = {"cazado": bool(caen), "criterio": m["criterio"], "tests_que_fallan": caen[:5]}
        nucleo.write_text(original)
    resultado["cazados"] = sum(v["cazado"] for v in resultado["mutantes"].values())
    resultado["total"] = len(MUTANTES)
    return resultado


if __name__ == "__main__":
    # Comprobación: con los tests ocultos, la referencia pasa y cada mutante cae.
    r = cazar(Path("-"), ocultos=LAB / "ocultos" / "reembolsos")
    print(json.dumps({k: v for k, v in r.items() if k != "mutantes"}),
          {k: v["cazado"] for k, v in r["mutantes"].items()})
