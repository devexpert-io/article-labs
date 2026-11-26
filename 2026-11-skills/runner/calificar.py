"""Corrige un estado del club (casos 2 y 3): el gate del proyecto (npm run check) y los tests ocultos.

Igual que en el laboratorio de validación: cada test oculto empieza por el número de su criterio ("C3 · …"), un
criterio se cumple si pasan todos sus tests y un encargo está completo si se cumplen todos sus criterios. Los tests
se copian junto al estado, en una carpeta temporal, justo antes de corregir.

En el caso 2 hay tres encargos en el mismo estado: el gate se pasa una vez y los tests ocultos de cada encargo, por
separado (los números de criterio se repiten entre encargos).
"""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from agentes import HOME, LAB, OCULTAR, SCR, caja

OCULTOS = LAB / "ocultos"
SPECS = LAB / "club" / "docs" / "specs"


def criterios_de(encargo: str) -> list[int]:
    texto = (SPECS / f"{encargo}.md").read_text()
    seccion = texto.split("## Criterios de aceptación", 1)[1].split("\n## ", 1)[0]
    return [int(n) for n in re.findall(r"^(\d+)\. \*\*", seccion, re.M)]


def copiar_estado(origen: Path, destino: Path) -> None:
    """Copia el repositorio sin node_modules y enlaza node_modules con enlaces duros (mismo disco, sin coste)."""
    shutil.copytree(origen, destino, symlinks=True, ignore=shutil.ignore_patterns("node_modules", "test-ocultos"))
    if (origen / "node_modules").exists():
        subprocess.run(["cp", "-al", str(origen / "node_modules"), str(destino / "node_modules")], check=True)


def ejecutar_en_caja(cwd: Path, orden: list[str], limite_s: int) -> tuple[int | str, str]:
    cmd = [*caja(cwd, [], [*OCULTAR, HOME / ".claude"]), *orden]
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=limite_s,
                           env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(cwd), "LANG": "C.UTF-8"})
        return p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        salida = (e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        return "timeout", salida


def leer_tap(salida: str) -> dict[str, bool]:
    tests = {}
    for linea in salida.splitlines():
        m = re.match(r"^(not ok|ok) \d+ - (.*?)(?: # .*)?$", linea)
        if m:
            tests[m.group(2).strip()] = m.group(1) == "ok"
    return tests


def fallos_tap(salida: str) -> str:
    trozos, dentro = [], False
    for linea in salida.splitlines():
        if linea.startswith("not ok "):
            dentro = True
        elif linea.startswith(("ok ", "# ")):
            dentro = False
        if dentro:
            trozos.append(linea)
    return "\n".join(trozos)[-4000:]


def _ocultos(copia: Path, encargo: str) -> dict:
    carpeta = copia / "test-ocultos"
    if carpeta.exists():
        shutil.rmtree(carpeta)
    carpeta.mkdir()
    shutil.copy(OCULTOS / "ayuda.ts", carpeta / "ayuda.ts")
    for f in sorted((OCULTOS / encargo).glob("*.test.ts")):
        shutil.copy(f, carpeta / f.name)
    orden = ["node", "--test", "--test-reporter=tap", "--test-timeout=60000", "test-ocultos/"]
    rc, salida = ejecutar_en_caja(copia, orden, 600)
    tests = leer_tap(salida)
    inestables = []
    if not tests or not all(tests.values()):
        # Un test que falla se repite una vez, como en validación: cuenta como pasado si pasa en alguna.
        _, salida2 = ejecutar_en_caja(copia, orden, 600)
        segunda = leer_tap(salida2)
        inestables = [n for n, ok in tests.items() if not ok and segunda.get(n)]
        tests = {n: ok or bool(segunda.get(n)) for n, ok in {**segunda, **tests}.items()}
        salida = salida + "\n--- segunda pasada ---\n" + salida2
    criterios = {}
    for n in criterios_de(encargo):
        suyos = [ok for nombre, ok in tests.items() if re.match(rf"^C{n}\b", nombre)]
        criterios[n] = bool(suyos) and all(suyos)
    return {"tests": tests, "criterios": criterios, "criterios_ok": sum(criterios.values()),
            "criterios_total": len(criterios), "completo": all(criterios.values()), "ocultos_rc": rc,
            "inestables": inestables, "ocultos_salida": fallos_tap(salida) if not all(criterios.values()) else ""}


def evaluar(estado: Path, encargos: list[str]) -> dict:
    """El gate y los tests ocultos de cada encargo sobre una copia del estado, dentro de bubblewrap."""
    raiz = SCR / ".c"
    raiz.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=raiz) as tmp:
        copia = Path(tmp) / "repo"
        copiar_estado(estado, copia)
        rc_gate, salida_gate = ejecutar_en_caja(copia, ["npm", "run", "check"], 300)
        por_encargo = {e: _ocultos(copia, e) for e in encargos}
    return {
        "gate_ok": rc_gate == 0,
        "gate_rc": rc_gate,
        "gate_salida": salida_gate[-1500:],
        "encargos": por_encargo,
        "completos": sum(r["completo"] for r in por_encargo.values()),
        "total": len(encargos),
    }
