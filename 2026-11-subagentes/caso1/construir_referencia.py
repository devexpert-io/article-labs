"""Construye caso1/referencia.json a partir de la búsqueda mecánica (extraer.py) y de la revisión a mano.

Uso: python3 -I caso1/construir_referencia.py <carpeta del repo en el commit fijado>

La revisión a mano (18-nov-2026) está escrita aquí, en REVISION, con el motivo de cada decisión.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent

# Lo que se decidió a mano al revisar cada lectura de la búsqueda mecánica.
REVISION = {
    # Claves que next.config.ts inyecta en process.env con otro nombre (bloque `env:`). No son variables de
    # entorno: salen de API_URL, BASE_PATH, CLOUD_MODE… o de package.json. Si un agente las da, no cuentan ni
    # como acierto ni como error.
    "neutras": ["apiUrl", "basePath", "cloudMode", "cloudUrl", "currentVersion", "defaultCurrency", "defaultLocale",
                "selfRecord", "selfTrack"],
    # Apariciones que no son lecturas: comentarios y nombres de test.
    "no_son_lectura": [
        {"nombre": "UMAMI_API_KEY", "fichero": "packages/api-client/src/client.ts", "motivo": "ejemplo en un comentario JSDoc"},
        {"nombre": "DATABASE_URL", "fichero": "src/lib/db.test.ts", "motivo": "texto del nombre de un test"},
    ],
    # Valores por defecto que se puntúan: solo los que no son vacíos y son claros (un valor literal en el código).
    # Para cada uno, los textos que se aceptan (basta con que la respuesta contenga uno).
    "defectos": {
        "API_COVERAGE": ["enforce"],
        "CORS_MAX_AGE": ["86400"],
        "ERRORS_PER_MINUTE": ["120"],
        "GEOLITE_DB_PATH": ["GeoLite2-City.mmdb"],
        "HOSTNAME": ["0.0.0.0"],
        "PORT": ["3000"],
        "KAFKA_SASL_MECHANISM": ["plain"],
        "COLLECT_API_ENDPOINT": ["/api/send"],
        "PLAYWRIGHT_WEB_SERVER_COMMAND": ["pnpm dev"],
        "UMAMI_USER": ["admin"],
        "UMAMI_PASSWORD": ["umami-e2e-password"],
        "UMAMI_TEST_PORT": ["3100"],
        "COMPOSE_PROJECT_NAME": ["umami-api-test", "umami-e2e-test"],
        "UMAMI_USER_ID": ["41e2b680-648e-4b09-bcd7-3e2b10c06264"],
    },
}

ESCRITURA = re.compile(r"^\s*(delete\s+process\.env\.\w+|process\.env\.\w+\s*=[^=])")


def main(repo: Path) -> None:
    salida = subprocess.run([sys.executable, "-I", str(AQUI / "extraer.py"), str(repo)], capture_output=True, text=True, check=True).stdout
    candidatos = json.loads(salida)
    fuera = {(x["nombre"], x["fichero"]) for x in REVISION["no_son_lectura"]}
    variables = {}
    for nombre, lecturas in candidatos.items():
        if nombre in REVISION["neutras"]:
            continue
        lecturas = [x for x in lecturas if (nombre, x["fichero"]) not in fuera]
        # Las listas de check-env.js (clave dinámica) sí son lecturas: process.env[key] con esos nombres.
        lee = sorted({x["fichero"] for x in lecturas if not ESCRITURA.match(x["texto"])})
        escribe = sorted({x["fichero"] for x in lecturas if ESCRITURA.match(x["texto"])} - set(lee))
        if not lee:
            continue
        variables[nombre] = {"ficheros": lee, **({"solo_escribe": escribe} if escribe else {})}
        if nombre in REVISION["defectos"]:
            variables[nombre]["defecto"] = REVISION["defectos"][nombre]
    ref = {"repo": "umami-software/umami", "commit": subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                                                                    capture_output=True, text=True).stdout.strip() or None,
           "revisado": "2026-11-18", "neutras": REVISION["neutras"], "no_son_lectura": REVISION["no_son_lectura"],
           "variables": variables}
    (AQUI / "referencia.json").write_text(json.dumps(ref, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(variables)} variables, {sum(len(v['ficheros']) for v in variables.values())} pares variable-fichero")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
