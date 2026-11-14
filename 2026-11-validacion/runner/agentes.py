"""Lanza Claude Code, Codex y OpenCode sin la configuración del usuario y saca las métricas de cada ejecución.

Cada configuración es un agente con un modelo:
- opus y haiku: Claude Code con Opus 5.5 y Haiku 5.5.
- sol y luna: Codex con gpt-6.1-sol y gpt-6-luna, razonamiento medio.
- deepseek: OpenCode 2 con DeepSeek V4 Flash alojado en NaN Builders.
"""
import contextlib
import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
SCR = Path(os.environ.get("LAB_SCRATCH", "/var/tmp/lab-validacion"))
CODEX_HOME = SCR / "codex-home"
HOME_CODEX = SCR / "home-codex"
HOME_OC = SCR / "home-oc"
HOME = Path.home()

CONFIGS = {
    "opus": {"agente": "claude", "modelo": "claude-opus-5-5", "nivel": "frontera"},
    "haiku": {"agente": "claude", "modelo": "claude-haiku-5-5", "nivel": "barato"},
    "sol": {"agente": "codex", "modelo": "gpt-6.1-sol", "nivel": "frontera"},
    "luna": {"agente": "codex", "modelo": "gpt-6-luna", "nivel": "barato"},
    "deepseek": {"agente": "opencode", "modelo": "nan/deepseek-v4-flash", "nivel": "barato"},
}
# El validador potente de cada configuración barata: el modelo frontera de su mismo agente.
VALIDADOR_FRONTERA = {"haiku": "opus", "luna": "sol"}

# Claude Code: sin ajustes ni memoria del usuario, sin MCP ni skills, y sin poder leer los repos de la máquina,
# donde están los tests ocultos. Su sandbox no arranca en este Linux (no puede aplicar su filtro seccomp en un
# namespace de usuario anidado), así que se desactiva y el proceso entero va dentro de bubblewrap, como OpenCode.
AJUSTES_CLAUDE = json.dumps({
    "permissions": {"deny": [f"Read(/{HOME}/Projects/**)", f"Read(/{HOME}/DevExpert/**)", f"Read(/{HOME}/.claude/**)"]},
    "sandbox": {"enabled": False},
})
AISLAR_CLAUDE = ["--setting-sources", "project,local", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                 "--disable-slash-commands", "--permission-mode", "bypassPermissions", "--settings", AJUSTES_CLAUDE]

# OpenCode no trae sandbox. Claude Code y OpenCode se ejecutan en bubblewrap: el sistema en solo lectura, /tmp
# propio, escritura solo en la carpeta de trabajo y en su configuración, y sin ver los repos ni las claves del usuario.
OCULTAR = [HOME / "Projects", HOME / "DevExpert", HOME / ".codex", HOME / ".config", HOME / ".local/share"]


def caja(cwd: Path, escribibles: list[Path], ocultar: list[Path]) -> list[str]:
    cmd = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"]
    for ruta in ocultar:
        if ruta.exists():
            cmd += ["--tmpfs", str(ruta)]
    for ruta in [*escribibles, cwd]:
        cmd += ["--bind", str(ruta), str(ruta)]
    return [*cmd, "--chdir", str(cwd), "--die-with-parent"]

SECRETO = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|^OP_|^OPRUN", re.I)

# Ejecuciones simultáneas por agente (las fija lote.py). Sin límite si no se fija.
_SEMAFOROS: dict[str, threading.Semaphore] = {}


def limitar(agente: str, n: int) -> None:
    _SEMAFOROS[agente] = threading.Semaphore(n)


def entorno_limpio() -> dict:
    """El entorno del proceso sin claves: los agentes no ven las de 1Password."""
    return {k: v for k, v in os.environ.items() if not SECRETO.search(k)}


def comando(config: str, prompt: str, cwd: Path, reanudar: str | None, persistir: bool) -> tuple[list[str], dict, str | None]:
    c = CONFIGS[config]
    env = entorno_limpio()
    sesion = None
    if c["agente"] == "claude":
        env["DISABLE_AUTOUPDATER"] = "1"  # que no cambie de versión a mitad de lote
        escribibles = [HOME / ".claude", HOME / ".claude.json"]
        cmd = [*caja(cwd, escribibles, OCULTAR),
               "claude", "-p", prompt, "--model", c["modelo"], "--output-format", "stream-json", "--verbose", *AISLAR_CLAUDE]
        if reanudar:
            cmd += ["--resume", reanudar, "--fork-session"]
        elif persistir:
            sesion = str(uuid.uuid4())
            cmd += ["--session-id", sesion]
        else:
            cmd += ["--no-session-persistence"]
    elif c["agente"] == "codex":
        comunes = ["--json", "--skip-git-repo-check", "-m", c["modelo"], "-c", 'model_reasoning_effort="medium"']
        if reanudar:
            cmd = ["codex", "exec", "resume", reanudar, *comunes, prompt]
        else:
            cmd = ["codex", "exec", *comunes, "-C", str(cwd), *([] if persistir else ["--ephemeral"]), prompt]
        env.update({"HOME": str(HOME_CODEX), "CODEX_HOME": str(CODEX_HOME)})
    else:
        clave = os.environ.get("NAN_API_KEY")
        if not clave:
            raise RuntimeError("OpenCode necesita NAN_API_KEY: lanza el runner con oprun")
        dentro = {
            "HOME": str(HOME_OC), "PATH": env["PATH"], "LANG": "C.UTF-8", "NAN_API_KEY": clave,
            "XDG_CONFIG_HOME": str(HOME_OC / ".config"), "XDG_DATA_HOME": str(HOME_OC / ".local/share"),
            "XDG_CACHE_HOME": str(HOME_OC / ".cache"), "XDG_STATE_HOME": str(HOME_OC / ".local/state"),
            "OPENCODE_DISABLE_CLAUDE_CODE": "1",
        }
        cmd = [*caja(cwd, [HOME_OC], [*OCULTAR, HOME / ".claude"]), "env", "-i", *[f"{k}={v}" for k, v in dentro.items()],
               "opencode", "run", "--standalone", "--auto", "--archived", "--format", "json", "-m", c["modelo"]]
        if reanudar:
            cmd += ["--session", reanudar, "--fork"]
        cmd.append(prompt)
        env = {"PATH": env["PATH"]}
    return cmd, env, sesion


def lanzar(config: str, prompt: str, cwd: Path, log: Path, *, reanudar: str | None = None, persistir: bool = False,
           limite_s: int = 40 * 60, silencio_s: int = 10 * 60) -> dict:
    """Ejecuta una vez el agente de `config` con `prompt` en `cwd` y devuelve sus métricas.

    persistir: guarda la sesión para poder reanudarla después (la implementación).
    reanudar: id de la sesión que se continúa (la misma sesión revisa su trabajo).
    """
    cmd, env, sesion = comando(config, prompt, cwd, reanudar, persistir)
    log.parent.mkdir(parents=True, exist_ok=True)
    errores = log.with_suffix(".err")
    semaforo = _SEMAFOROS.get(CONFIGS[config]["agente"]) or contextlib.nullcontext()
    with semaforo:
        return _ejecutar(cmd, env, cwd, log, errores, config, reanudar, sesion, limite_s, silencio_s)


def _ejecutar(cmd, env, cwd, log, errores, config, reanudar, sesion, limite_s, silencio_s) -> dict:
    inicio = time.time()
    with open(log, "w") as out, open(errores, "w") as err_out:
        p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err_out,
                             start_new_session=True)
        rc = None
        while rc is None:
            try:
                rc = p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                ahora = time.time()
                motivo = ("timeout" if ahora - inicio > limite_s
                          else "estancado" if ahora - max(log.stat().st_mtime, inicio) > silencio_s
                          else None)
                if motivo:
                    os.killpg(p.pid, signal.SIGKILL)
                    p.wait()
                    rc = motivo
    m = {"config": config, **CONFIGS[config], "duracion_s": round(time.time() - inicio, 1), "rc": rc,
         "reanuda": reanudar, "stderr": errores.read_text(errors="replace")[-1500:]}
    agente = CONFIGS[config]["agente"]
    m.update(metricas_claude(log) if agente == "claude" else metricas_codex(log) if agente == "codex" else metricas_opencode(log))
    if sesion and not m.get("sesion"):
        m["sesion"] = sesion
    return m


def eventos(log: Path):
    for linea in log.read_text(errors="replace").splitlines():
        try:
            e = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if isinstance(e, dict):
            yield e


def _base() -> dict:
    return {"peticiones": 0, "entrada": 0, "entrada_cache_leida": 0, "entrada_cache_escrita": 0, "salida": 0,
            "razonamiento": 0, "herramientas": {}, "ordenes": [], "respuesta_final": "", "sesion": None}


def metricas_claude(log: Path) -> dict:
    m = _base()
    vistos = set()
    for e in eventos(log):
        if e.get("type") == "system" and e.get("subtype") == "init":
            m["modelo_real"] = e.get("model")
            m["sesion"] = e.get("session_id")
        if e.get("type") == "rate_limit_event":
            # Cuánto lleva gastado la cuenta de su cuota: sirve para planificar los lotes, no entra en los resultados.
            info = e.get("rate_limit_info") or {}
            ventanas = info.get("unifiedWindows") or {info.get("rateLimitType"): info}
            m["cuota"] = {k: {"uso": v.get("utilization"), "estado": v.get("status")} for k, v in ventanas.items() if k}
        if e.get("type") == "assistant":
            msg = e.get("message", {})
            if msg.get("id") not in vistos:
                vistos.add(msg.get("id"))
                u = msg.get("usage", {})
                m["peticiones"] += 1
                m["entrada"] += u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
                m["entrada_cache_leida"] += u.get("cache_read_input_tokens", 0)
                m["entrada_cache_escrita"] += u.get("cache_creation_input_tokens", 0)
                m["salida"] += u.get("output_tokens", 0)
            for bloque in msg.get("content", []):
                if bloque.get("type") == "tool_use":
                    nombre = bloque.get("name", "?")
                    m["herramientas"][nombre] = m["herramientas"].get(nombre, 0) + 1
                    if nombre == "Bash":
                        m["ordenes"].append(str(bloque.get("input", {}).get("command", ""))[:300])
        if e.get("type") == "result":
            # Los mensajes del stream llevan el uso parcial: el total bueno es el del resultado.
            u = e.get("usage") or {}
            if u:
                m["entrada"] = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
                m["entrada_cache_leida"] = u.get("cache_read_input_tokens", 0)
                m["entrada_cache_escrita"] = u.get("cache_creation_input_tokens", 0)
                m["salida"] = u.get("output_tokens", 0)
            m["coste_usd"] = e.get("total_cost_usd")
            m["turnos"] = e.get("num_turns")
            m["respuesta_final"] = e.get("result") or ""
            m["error_agente"] = e.get("is_error")
            m["sesion"] = e.get("session_id") or m["sesion"]
    return m


def metricas_codex(log: Path) -> dict:
    m = _base()
    textos = []
    for e in eventos(log):
        tipo = e.get("type")
        if tipo == "thread.started":
            m["sesion"] = e.get("thread_id")
        if tipo == "turn.completed":
            u = e.get("usage", {})
            m["peticiones"] += 1
            m["entrada"] += u.get("input_tokens", 0)
            m["entrada_cache_leida"] += u.get("cached_input_tokens", 0)
            m["salida"] += u.get("output_tokens", 0)
            m["razonamiento"] += u.get("reasoning_output_tokens", 0)
        if tipo == "item.completed":
            item = e.get("item", {})
            clase = item.get("type") or item.get("item_type") or "?"
            m["herramientas"][clase] = m["herramientas"].get(clase, 0) + 1
            if clase == "command_execution":
                m["ordenes"].append(str(item.get("command", ""))[:300])
            if clase == "agent_message":
                textos.append(item.get("text", ""))
        if tipo in ("turn.failed", "error"):
            m["error_agente"] = json.dumps(e)[:500]
    m["respuesta_final"] = textos[-1] if textos else ""
    return m


def metricas_opencode(log: Path) -> dict:
    m = _base()
    textos = []
    marcas = []
    for e in eventos(log):
        part = e.get("part", {}) if isinstance(e.get("part"), dict) else {}
        m["sesion"] = m["sesion"] or e.get("sessionID") or part.get("sessionID")
        if isinstance(e.get("timestamp"), (int, float)):
            marcas.append(e["timestamp"])
        if e.get("type") == "step_finish":
            tk = part.get("tokens", {})
            cache = tk.get("cache", {})
            m["peticiones"] += 1
            m["entrada"] += tk.get("input", 0) + cache.get("read", 0) + cache.get("write", 0)
            m["entrada_cache_leida"] += cache.get("read", 0)
            m["entrada_cache_escrita"] += cache.get("write", 0)
            m["salida"] += tk.get("output", 0)
            m["razonamiento"] += tk.get("reasoning", 0)
        if e.get("type") == "tool_use":
            nombre = part.get("tool", "?")
            m["herramientas"][nombre] = m["herramientas"].get(nombre, 0) + 1
            entrada = part.get("state", {}).get("input", {})
            if nombre in ("bash", "shell"):
                m["ordenes"].append(str(entrada.get("command", ""))[:300])
        if e.get("type") == "text":
            textos.append(part.get("text", ""))
        if e.get("type") == "error":
            m["error_agente"] = json.dumps(e)[:500]
    m["respuesta_final"] = textos[-1] if textos else ""
    if marcas:
        m["duracion_s_agente"] = round((max(marcas) - min(marcas)) / 1000, 1)
    return m
