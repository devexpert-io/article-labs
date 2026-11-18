"""Búsqueda mecánica de las variables de entorno que lee el repositorio del caso 1.

Uso: python3 -I caso1/extraer.py <carpeta del repo>  > candidatos.json

Saca cada lectura de una variable con su fichero, su línea y el texto de alrededor, para revisarlas a mano y
escribir la referencia (caso1/referencia.json). Busca:
- process.env.NOMBRE y process.env['NOMBRE'], en cualquier fichero de código (.ts, .tsx, .js, .mjs, .cjs);
- env('NOMBRE') (el ayudante de Prisma en prisma.config.ts);
- desestructuraciones de process.env: const { A, B } = process.env;
- lecturas a través de una variable que es process.env (env.NOMBRE cuando env = process.env);
- listas de nombres que se leen con process.env[clave] (por ejemplo, scripts/check-env.js).
Los dos últimos casos se marcan con "revisar" y se confirman a mano.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
DIRECTA = re.compile(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)|process\.env\[\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\s*\]")
PRISMA = re.compile(r"\benv\(\s*['\"]([A-Z_][A-Z0-9_]*)['\"]\s*\)")
DESESTRUCTURA = re.compile(r"\{([^}]*)\}\s*=\s*process\.env")
ALIAS = re.compile(r"\b(\w+)\s*(?::\s*\w+)?\s*=\s*process\.env\b(?!\s*[.\[])")


def main(raiz: Path) -> None:
    lecturas = defaultdict(list)
    for f in sorted(raiz.rglob("*")):
        if f.suffix not in EXT or "node_modules" in f.parts or ".git" in f.parts or not f.is_file():
            continue
        rel = str(f.relative_to(raiz))
        lineas = f.read_text(errors="replace").splitlines()
        alias = set()
        for i, linea in enumerate(lineas, 1):
            for m in DIRECTA.finditer(linea):
                lecturas[m.group(1) or m.group(2)].append({"fichero": rel, "linea": i, "texto": linea.strip()[:200]})
            for m in PRISMA.finditer(linea):
                lecturas[m.group(1)].append({"fichero": rel, "linea": i, "texto": linea.strip()[:200]})
            for m in DESESTRUCTURA.finditer(linea):
                for nombre in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*(?:[:=,]|$)", m.group(1)):
                    lecturas[nombre].append({"fichero": rel, "linea": i, "texto": linea.strip()[:200], "revisar": "desestructura"})
            for m in ALIAS.finditer(linea):
                alias.add(m.group(1))
        for nombre_alias in alias:
            patron = re.compile(rf"\b{re.escape(nombre_alias)}\.([A-Z_][A-Z0-9_]*)")
            for i, linea in enumerate(lineas, 1):
                for m in patron.finditer(linea):
                    lecturas[m.group(1)].append({"fichero": rel, "linea": i, "texto": linea.strip()[:200], "revisar": f"alias {nombre_alias}"})
        if any(re.search(r"process\.env\[\s*[a-z]\w*\s*\]", l) for l in lineas):
            for i, linea in enumerate(lineas, 1):
                for m in re.finditer(r"['\"]([A-Z][A-Z0-9_]{2,})['\"]", linea):
                    lecturas[m.group(1)].append({"fichero": rel, "linea": i, "texto": linea.strip()[:200], "revisar": "clave dinámica"})
    json.dump(dict(sorted(lecturas.items())), sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
