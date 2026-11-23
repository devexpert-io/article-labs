"""Una ejecución de la parte A y el lote completo.

Uso (en tmux, porque el lote dura horas):
  oprun python3 -I runner/ejecutar.py <lote> --agentes claude,codex,opencode --configs serie,... --encargos ... --reps 2 --hilos 2

Cada ejecución deja resultados/<lote>/<id>.json (efectos, metadatos) y resultados/<lote>/trazas/<id>.jsonl
(la salida del agente, sin credenciales). Si el JSON ya existe, la ejecución se salta: el lote se puede reanudar.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agentes  # noqa: E402
import comprobar  # noqa: E402
import encargos  # noqa: E402
import entorno  # noqa: E402

RESULTADOS = entorno.LAB / "resultados"
AUTH_CODEX = Path.home() / ".codex/auth.json"
_lock_auth = threading.Lock()


def escribir_como_labseg(ruta: Path, contenido: str) -> None:
    subprocess.run(["sudo", "-n", "-u", "labseg", "mkdir", "-p", str(ruta.parent)], check=True)
    subprocess.run(["sudo", "-n", "-u", "labseg", "tee", str(ruta)], input=contenido, text=True,
                   check=True, capture_output=True)


def leer_como_labseg(ruta: Path) -> str:
    r = subprocess.run(["sudo", "-n", "-u", "labseg", "cat", str(ruta)], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def secretos_reales() -> list[str]:
    """Credenciales de verdad que no pueden acabar en las trazas publicadas."""
    s = [Path("~/.config/labseg/claude-token").expanduser().read_text().strip()]
    if os.environ.get("NAN_API_KEY"):
        s.append(os.environ["NAN_API_KEY"])
    try:
        tokens = json.loads(AUTH_CODEX.read_text()).get("tokens", {})
        s += [v for v in tokens.values() if isinstance(v, str) and len(v) > 20]
    except Exception:
        pass
    return [x for x in s if x]


def redactar(texto: str, secretos: list[str]) -> str:
    for x in secretos:
        texto = texto.replace(x, "<credencial-redactada>")
    return re.sub(r"sk-ant-oat01-[A-Za-z0-9_-]+", "<credencial-redactada>", texto)


def sincronizar_auth_codex(copia: str | None) -> None:
    """Codex puede renovar su token en la copia: si es más reciente, vuelve a la principal."""
    if not copia:
        return
    with _lock_auth:
        try:
            nueva = json.loads(copia)
            actual = json.loads(AUTH_CODEX.read_text())
        except Exception:
            return
        if (nueva.get("last_refresh") or "") > (actual.get("last_refresh") or ""):
            tmp = AUTH_CODEX.with_suffix(".tmp")
            tmp.write_text(copia)
            tmp.replace(AUTH_CODEX)


def una(lote: str, encargo: str, agente: str, config: str, rep: int, limite_s: int = 600) -> dict | None:
    run_id = f"{lote}-{encargo}-{agente}-{config}-r{rep}"
    destino = RESULTADOS / lote / f"{run_id}.json"
    if destino.exists():
        return None
    run = entorno.preparar(run_id)
    for rel, contenido in agentes.ficheros(run, agente, config).items():
        escribir_como_labseg(run["home"] / rel, contenido)
    if agente == "codex":
        with _lock_auth:
            escribir_como_labseg(run["home"] / ".codex/auth.json", AUTH_CODEX.read_text())
    prompt = encargos.prompt(encargo, run, entorno.ESCUCHA)
    cmd, env = agentes.comando(run, agente, config, prompt)
    completo = ["sudo", "-n", "-u", "labseg", "env", "-i", "-C", str(run["app"]), *[f"{k}={v}" for k, v in env.items()], *cmd]
    t0 = time.time()
    try:
        p = subprocess.run(completo, capture_output=True, text=True, timeout=limite_s,
                           stdin=subprocess.DEVNULL)
        salida, error, codigo, agotado = p.stdout, p.stderr, p.returncode, False
    except subprocess.TimeoutExpired as e:
        salida = (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        error = (e.stderr or b"").decode("utf-8", "replace") if isinstance(e.stderr, bytes) else (e.stderr or "")
        codigo, agotado = None, True
        subprocess.run(["sudo", "-n", "pkill", "-u", "labseg", "-f", run_id], capture_output=True)
    duracion = time.time() - t0
    time.sleep(1)  # que lleguen las peticiones al servidor de escucha
    traza = salida + "\n" + error
    ef = comprobar.efectos(run, traza, t0)
    hook_log = leer_como_labseg(run["home"] / ".hook-seguridad.log")
    if agente == "codex":
        sincronizar_auth_codex(leer_como_labseg(run["home"] / ".codex/auth.json") or None)
        registro_codex = subprocess.run(["sudo", "-n", "-u", "labseg", "sh", "-c",
                                         f"cat {run['home']}/.codex/sessions/*/*/*/*.jsonl 2>/dev/null"],
                                        capture_output=True, text=True).stdout
    secretos = secretos_reales()
    res = {
        "id": run_id, "lote": lote, "encargo": encargo, "agente": agente, "config": config, "rep": rep,
        "modelo": agentes.MODELOS[agente], "prompt": prompt, "inicio": t0, "duracion_s": round(duracion, 1),
        "codigo_salida": codigo, "agotado": agotado,
        "hecho": ef[comprobar.EFECTO_DEL_ENCARGO[encargo]], "efectos": ef,
        "hook": [json.loads(x) for x in hook_log.splitlines() if x.strip()],
        "canarios": run["canarios"], "ssh_canario": run["ssh_canario"],
    }
    trazas = RESULTADOS / lote / "trazas"
    trazas.mkdir(parents=True, exist_ok=True)
    (trazas / f"{run_id}.out").write_text(redactar(salida, secretos))
    (trazas / f"{run_id}.err").write_text(redactar(error, secretos))
    if agente == "codex":
        (trazas / f"{run_id}.sesion.jsonl").write_text(redactar(registro_codex, secretos))
    destino.write_text(json.dumps(res, indent=2, ensure_ascii=False))
    if os.environ.get("LAB_CONSERVAR") != "1":
        entorno.limpiar(run_id)
    return res


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("lote")
    a.add_argument("--agentes", default="claude,codex,opencode")
    a.add_argument("--configs", default=",".join(agentes.CONFIGS))
    a.add_argument("--encargos", default=",".join(encargos.ENCARGOS))
    a.add_argument("--reps", type=int, default=1)
    a.add_argument("--hilos", type=int, default=2, help="ejecuciones simultáneas por agente")
    args = a.parse_args()
    tareas: dict[str, list] = {}
    for rep in range(1, args.reps + 1):
        for agente in args.agentes.split(","):
            for config in args.configs.split(","):
                if not agentes.aplicable(agente, config):
                    continue
                for encargo in args.encargos.split(","):
                    tareas.setdefault(agente, []).append((args.lote, encargo, agente, config, rep))

    def correr(t):
        try:
            r = una(*t)
            if r:
                print(f"{r['id']}: hecho={r['hecho']} {r['duracion_s']}s", flush=True)
        except Exception as e:  # una ejecución rota no para el lote
            print(f"ERROR {t}: {e!r}", flush=True)

    with ThreadPoolExecutor(max_workers=args.hilos * len(tareas)) as ex:
        # Intercala agentes para que cada uno tenga sus hilos ocupados.
        colas = list(tareas.values())
        orden = [t for grupo in zip(*[c + [None] * (max(map(len, colas)) - len(c)) for c in colas]) for t in grupo if t]
        list(ex.map(correr, orden))


if __name__ == "__main__":
    main()
