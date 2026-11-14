"""Corrige un estado del repositorio: el gate del proyecto (npm run check) y los tests ocultos de su encargo.

Los tests ocultos son la verdad de referencia: cada test empieza por el número de su criterio ("C3 · …") y un
criterio se da por cumplido si pasan todos sus tests. El agente no los ve nunca: se copian a una carpeta aparte,
con el estado, justo antes de corregir, y se borran después.
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
    """Los números de los criterios de aceptación de la spec."""
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
    """Resultados de los tests de primer nivel en la salida TAP de node --test."""
    tests = {}
    for linea in salida.splitlines():
        m = re.match(r"^(not ok|ok) \d+ - (.*?)(?: # .*)?$", linea)
        if m:
            tests[m.group(2).strip()] = m.group(1) == "ok"
    return tests


def evaluar(estado: Path, encargo: str) -> dict:
    """El gate y los tests ocultos sobre una copia del estado, dentro de bubblewrap."""
    raiz = SCR / ".c"
    raiz.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=raiz) as tmp:
        copia = Path(tmp) / "repo"
        copiar_estado(estado, copia)
        rc_gate, salida_gate = ejecutar_en_caja(copia, ["npm", "run", "check"], 300)
        ocultos = copia / "test-ocultos"
        ocultos.mkdir()
        shutil.copy(OCULTOS / "ayuda.ts", ocultos / "ayuda.ts")
        for f in sorted((OCULTOS / encargo).glob("*.test.ts")):
            shutil.copy(f, ocultos / f.name)
        orden = ["node", "--test", "--test-reporter=tap", "--test-timeout=60000", "test-ocultos/"]
        rc_ocultos, salida = ejecutar_en_caja(copia, orden, 600)
        tests = leer_tap(salida)
        inestables = []
        if not tests or not all(tests.values()):
            # Un test que falla se repite una vez, para no confundir un fallo por carga de la máquina con un
            # fallo de la implementación. Cuenta como pasado si pasa en alguna de las dos.
            rc2, salida2 = ejecutar_en_caja(copia, orden, 600)
            segunda = leer_tap(salida2)
            inestables = [n for n, ok in tests.items() if not ok and segunda.get(n)]
            tests = {n: ok or bool(segunda.get(n)) for n, ok in {**segunda, **tests}.items()}
            salida = salida + "\n--- segunda pasada ---\n" + salida2
    criterios = {}
    for n in criterios_de(encargo):
        suyos = [ok for nombre, ok in tests.items() if re.match(rf"^C{n}\b", nombre)]
        criterios[n] = bool(suyos) and all(suyos)
    return {
        "gate_ok": rc_gate == 0,
        "gate_rc": rc_gate,
        "gate_salida": salida_gate[-1500:],
        "tests": tests,
        "criterios": criterios,
        "criterios_ok": sum(criterios.values()),
        "criterios_total": len(criterios),
        "completo": all(criterios.values()),
        "ocultos_rc": rc_ocultos,
        "inestables": inestables,
        "ocultos_salida": fallos_tap(salida) if not all(criterios.values()) else "",
    }


def fallos_tap(salida: str) -> str:
    """Las líneas de los tests que fallan y su diagnóstico, para saber por qué."""
    trozos, dentro = [], False
    for linea in salida.splitlines():
        if linea.startswith("not ok "):
            dentro = True
        elif linea.startswith(("ok ", "# ")):
            dentro = False
        if dentro:
            trozos.append(linea)
    return "\n".join(trozos)[-4000:]
