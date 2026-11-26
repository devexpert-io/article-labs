"""Lanza Claude Code, Codex y OpenCode con su modelo potente o el barato y saca las métricas de cada ejecución,
incluidas las skills que carga el agente.

Viene del laboratorio de subagentes (../2026-11-subagentes/runner/agentes.py): el mismo aislamiento (sin la
configuración del usuario y dentro de bubblewrap) y las mismas métricas, con tres cambios:

- Los subagentes van desactivados en todas las ejecuciones: aquí solo se mide la skill en la sesión principal.
- Se elige el modelo (potente o barato) de cada ejecución.
- Se detecta qué skill carga el agente (la herramienta Skill en Claude Code, la lectura de su SKILL.md en Codex y
  la herramienta skill en OpenCode) y, en la parte A, la ejecución se para en cuanto carga la que toca.
"""
import contextlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
import uuid
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
SCR = Path(os.environ.get("LAB_SCRATCH", "/var/tmp/lab-skills"))
CODEX_HOME = SCR / "codex-home"
HOME_CODEX = SCR / "home-codex"
HOME_OC = SCR / "home-oc"
HOME = Path.home()

# El modelo potente y el barato de cada herramienta. El barato solo aparece en la parte B, skill 3.
HERRAMIENTAS = {
    "claude": {"principal": "claude-opus-5-5", "barato": "claude-haiku-5-5"},
    "codex": {"principal": "gpt-6.1-sol", "barato": "gpt-6-luna"},
    "opencode": {"principal": "nan/deepseek-v4-pro", "barato": "nan/deepseek-v4-flash"},
}
ESFUERZO_CODEX = "medium"

# Claude Code: sin ajustes ni memoria del usuario, sin MCP, y sin poder leer los repos de la máquina. Su sandbox no
# arranca en este Linux, así que se desactiva y el proceso entero va dentro de bubblewrap, como en validación.
# Workflow (los flujos de muchos agentes coordinados) queda fuera en las dos condiciones: no se mide (README).
AJUSTES_CLAUDE = json.dumps({
    "permissions": {"deny": [f"Read(/{HOME}/Projects/**)", f"Read(/{HOME}/DevExpert/**)", f"Read(/{HOME}/.claude/**)"]},
    "sandbox": {"enabled": False},
})
AISLAR_CLAUDE = ["--setting-sources", "project,local", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                 "--permission-mode", "bypassPermissions", "--settings", AJUSTES_CLAUDE]
SIN_SUBAGENTES_CLAUDE = ["Agent", "Task", "SendMessage", "TaskStop"]
SIEMPRE_FUERA_CLAUDE = ["Workflow"]
# Lo que el usuario tiene en ~/.claude y no debe ver el agente: se tapa con carpetas vacías dentro de la caja.
VACIAR_CLAUDE = [HOME / ".claude" / d for d in ("skills", "agents", "commands", "plugins")]

# Además de los datos del usuario, las demás ejecuciones del laboratorio (SCR/ejecuciones) y las copias que se
# corrigen con los tests ocultos (SCR/.c): en el piloto, OpenCode sin la skill encontró las reglas de facturación en
# la carpeta de otra ejecución que corría a la vez. Cada agente solo ve su propia carpeta (se vuelve a montar encima).
# Segunda fuga, en el lote (26-nov): OpenCode buscó con `find /` y la carpeta compartida de Codex (CODEX_HOME) tenía
# los rollouts de otras ejecuciones, con el texto de las skills que habían leído, y sus memorias. Ahora se tapa la
# carpeta entera del laboratorio (SCR) y cada ejecución tiene su propio CODEX_HOME, HOME de Codex y HOME de OpenCode
# dentro de su carpeta auxiliar. Lo único compartido es auth.json de Codex, montado como fichero.
OCULTAR = [HOME / "Projects", HOME / "DevExpert", HOME / ".codex", HOME / ".config", HOME / ".local/share", SCR]


PROVEEDOR_NAN = {
    "nan": {"npm": "@ai-sdk/openai-compatible", "name": "NaN Builders",
            "options": {"baseURL": "https://api.nan.builders/v1", "apiKey": "{env:NAN_API_KEY}"},
            "models": {"deepseek-v4-pro": {"name": "DeepSeek V4 Pro"}, "deepseek-v4-flash": {"name": "DeepSeek V4 Flash"}}},
}

# La ruta de un SKILL.md en una orden de Codex: .agents/skills/<nombre>/SKILL.md
RUTA_SKILL = re.compile(r"skills/([a-z0-9-]+)/SKILL\.md")


def codex_propio(aux: Path) -> Path:
    """Un CODEX_HOME para una ejecución: la configuración, el catálogo de modelos y las skills y plugins que Codex
    trae de serie, copiados del CODEX_HOME del laboratorio. Sin sesiones, memorias ni bases de datos de otras."""
    propio = aux / "codex-home"
    propio.mkdir(parents=True, exist_ok=True)
    for f in ("config.toml", "models_cache.json", "installation_id"):
        if (CODEX_HOME / f).exists():
            shutil.copy(CODEX_HOME / f, propio / f)
    for d in ("skills", "plugins"):
        if (CODEX_HOME / d).exists() and not (propio / d).exists():
            shutil.copytree(CODEX_HOME / d, propio / d, symlinks=True)
    (propio / "auth.json").touch()
    return propio


def caja(cwd: Path, escribibles: list[Path], ocultar: list[Path], vaciar: list[Path] = (),
         montar: list[tuple[Path, Path]] = ()) -> list[str]:
    cmd = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"]
    for ruta in ocultar:
        if ruta.exists():
            cmd += ["--tmpfs", str(ruta)]
    for ruta in [*escribibles, cwd]:
        cmd += ["--bind", str(ruta), str(ruta)]
    for origen, destino in montar:
        cmd += ["--bind", str(origen), str(destino)]
    for ruta in vaciar:
        # Un enlace simbólico apunta a algo que ya está oculto (por ejemplo, ~/.claude/skills a ~/Projects).
        if ruta.is_dir() and not ruta.is_symlink():
            cmd += ["--tmpfs", str(ruta)]
    return [*cmd, "--chdir", str(cwd), "--die-with-parent"]


SECRETO = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|^OP_|^OPRUN", re.I)

# Ejecuciones simultáneas por herramienta (las fija lote.py). Sin límite si no se fija.
_SEMAFOROS: dict[str, threading.Semaphore] = {}
# Codex escribe sus rollouts en una carpeta compartida: se reparten por hilo, y el reparto se hace con este cerrojo.
_ROLLOUTS = threading.Lock()


def limitar(herramienta: str, n: int) -> None:
    _SEMAFOROS[herramienta] = threading.Semaphore(n)


def entorno_limpio() -> dict:
    """El entorno del proceso sin claves: los agentes no ven las de 1Password."""
    return {k: v for k, v in os.environ.items() if not SECRETO.search(k)}


def version(herramienta: str) -> str:
    orden = {"claude": ["claude", "--version"], "codex": ["codex", "--version"], "opencode": ["opencode", "--version"]}
    try:
        return subprocess.run(orden[herramienta], capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"? ({e})"


def cwd_codex_home(cwd: Path) -> Path:
    return cwd.parent / "logs" / "agente.aux" / "codex-home"


def confiar_en_codex(cwd: Path) -> None:
    """Codex solo carga la configuración del proyecto (.codex/agents, los subagentes definidos del caso 3) si la
    carpeta es de confianza. No vale `-c projects…` ni la confianza de una carpeta superior: hace falta su entrada
    en config.toml, que se añade aquí (con cerrojo, porque las ejecuciones comparten CODEX_HOME)."""
    with _ROLLOUTS:
        config = cwd_codex_home(cwd) / "config.toml"
        texto = config.read_text()
        cabecera = f'[projects."{cwd}"]'
        if cabecera not in texto:
            config.write_text(texto.rstrip("\n") + f'\n\n{cabecera}\ntrust_level = "trusted"\n')


def catalogo_sin_subagentes(aux: Path) -> Path:
    """Con gpt-6.1-sol y gpt-6-luna, `--disable multi_agent_v2 --disable multi_agent` no basta: el catálogo de
    modelos que descarga Codex (models_cache.json) trae multi_agent_version = "v2" y vuelve a dar spawn_agent. Para
    "sin subagentes" se le pasa una copia del catálogo del día con ese campo vacío (model_catalog_json), y entonces
    Codex desactiva los subagentes (turn_context.multi_agent_version = "disabled")."""
    cache = json.loads((CODEX_HOME / "models_cache.json").read_text())
    for modelo in cache.get("models", []):
        if "multi_agent_version" in modelo:
            modelo["multi_agent_version"] = None
    ruta = aux / "catalogo-sin-subagentes.json"
    ruta.write_text(json.dumps({"models": cache.get("models", [])}))
    return ruta


def comando(herramienta: str, prompt: str, cwd: Path, subagentes: bool, aux: Path, confiar: bool = False,
            modelo: str | None = None) -> tuple[list[str], dict]:
    """La orden y el entorno de una ejecución. `aux` es una carpeta propia de la ejecución (fuera del repo)."""
    modelo = modelo or HERRAMIENTAS[herramienta]["principal"]
    env = entorno_limpio()
    if herramienta == "claude":
        env["DISABLE_AUTOUPDATER"] = "1"
        fuera = SIEMPRE_FUERA_CLAUDE + ([] if subagentes else SIN_SUBAGENTES_CLAUDE)
        # Una carpeta de configuración propia de la ejecución (CLAUDE_CONFIG_DIR), con las transcripciones dentro, y
        # ~/.claude tapada entera: guarda el historial de ficheros editados (file-history) de las sesiones del
        # usuario, incluidas las que escribieron las skills de este laboratorio. Solo se comparte el fichero de
        # credenciales, montado como fichero.
        conf = aux / "claude-config"
        (conf / "projects").mkdir(parents=True, exist_ok=True)
        global_ = json.loads((HOME / ".claude.json").read_text())
        (conf / ".claude.json").write_text(json.dumps({k: v for k, v in global_.items()
                                                       if k not in ("projects", "skillUsage", "pluginUsage", "tipsHistory")}))
        (conf / ".credentials.json").touch()
        env["CLAUDE_CONFIG_DIR"] = str(conf)
        cmd = [*caja(cwd, [aux], [*OCULTAR, HOME / ".claude"],
                     montar=[(HOME / ".claude" / ".credentials.json", conf / ".credentials.json")]),
               "--ro-bind", "/dev/null", str(HOME / ".claude.json"),
               "claude", "-p", prompt, "--model", modelo, "--output-format", "stream-json", "--verbose",
               *AISLAR_CLAUDE, "--disallowedTools", *fuera, "--session-id", str(uuid.uuid4())]
        return cmd, env
    if herramienta == "codex":
        activar = (["--enable", "multi_agent_v2", "--disable", "multi_agent"] if subagentes
                   else ["--disable", "multi_agent_v2", "--disable", "multi_agent"])
        if confiar:
            confiar_en_codex(cwd)
        if not subagentes:
            activar += ["-c", f'model_catalog_json="{catalogo_sin_subagentes(aux)}"']
        # Codex también va dentro de bubblewrap, para que no vea las demás ejecuciones (su propio sandbox deja leer
        # todo el disco). Dentro de la caja, sin su sandbox: la caja ya solo deja escribir en su carpeta.
        propio = codex_propio(aux)
        (aux / "home-codex").mkdir(exist_ok=True)
        cmd = [*caja(cwd, [aux], [*OCULTAR, HOME / ".claude"], montar=[(CODEX_HOME / "auth.json", propio / "auth.json")]),
               "codex", "exec", "--json", "--skip-git-repo-check", "-m", modelo, "-s", "danger-full-access",
               "-c", f'model_reasoning_effort="{ESFUERZO_CODEX}"', *activar, "-C", str(cwd), prompt]
        env.update({"HOME": str(aux / "home-codex"), "CODEX_HOME": str(propio)})
        return cmd, env
    clave = os.environ.get("NAN_API_KEY")
    if not clave:
        raise RuntimeError("OpenCode necesita NAN_API_KEY: lanza el runner con oprun")
    # Configuración y datos propios de cada ejecución: el permiso de subagentes va en su opencode.json y el
    # consumo de los hijos se lee de su opencode.db sin mezclarse con otras ejecuciones.
    config = {"$schema": "https://opencode.ai/config.json", "provider": PROVEEDOR_NAN, "model": modelo,
              "autoupdate": False, "share": "disabled", "automations": False}
    if not subagentes:
        config["permissions"] = [{"action": "subagent", "resource": "*", "effect": "deny"}]
    (aux / "config/opencode").mkdir(parents=True, exist_ok=True)
    (aux / "config/opencode/opencode.json").write_text(json.dumps(config, indent=1))
    for d in ("data", "state"):
        (aux / d).mkdir(parents=True, exist_ok=True)
    dentro = {
        "HOME": str(aux / "home-oc"), "PATH": env["PATH"], "LANG": "C.UTF-8", "NAN_API_KEY": clave,
        "XDG_CONFIG_HOME": str(aux / "config"), "XDG_DATA_HOME": str(aux / "data"),
        "XDG_CACHE_HOME": str(aux / "home-oc" / ".cache"), "XDG_STATE_HOME": str(aux / "state"),
        "OPENCODE_DISABLE_CLAUDE_CODE": "1",
    }
    (aux / "home-oc" / ".cache").mkdir(parents=True, exist_ok=True)
    cmd = [*caja(cwd, [aux], [*OCULTAR, HOME / ".claude"]), "env", "-i", *[f"{k}={v}" for k, v in dentro.items()],
           "opencode", "run", "--standalone", "--auto", "--archived", "--format", "json", "-m", modelo, prompt]
    return cmd, {"PATH": env["PATH"]}


def cargadas_en_log(herramienta: str, log: Path) -> list[str]:
    """Las skills que ha cargado el agente hasta ahora, leyendo su salida (sirve durante la ejecución)."""
    nombres = []
    for e in eventos(log):
        if herramienta == "claude" and e.get("type") == "assistant" and e.get("parent_tool_use_id") is None:
            for b in (e.get("message") or {}).get("content", []):
                if b.get("type") == "tool_use" and b.get("name") == "Skill":
                    nombres.append(str((b.get("input") or {}).get("skill", "")).split(":")[-1])
        elif herramienta == "codex" and e.get("type") in ("item.started", "item.completed"):
            item = e.get("item") or {}
            if item.get("type") == "command_execution":
                nombres += RUTA_SKILL.findall(str(item.get("command", "")))
        elif herramienta == "opencode" and e.get("type") == "tool_use":
            part = e.get("part") or {}
            if part.get("tool") == "skill":
                entrada = (part.get("state") or {}).get("input") or {}
                nombres.append(str(entrada.get("id") or entrada.get("name") or ""))
    vistas = []
    for n in nombres:
        if n and n not in vistas:
            vistas.append(n)
    return vistas


def lanzar(herramienta: str, prompt: str, cwd: Path, log: Path, *, subagentes: bool = False, confiar: bool = False,
           limite_s: int = 45 * 60, silencio_s: int = 12 * 60, modelo: str | None = None,
           parar_con: str | None = None) -> dict:
    """`parar_con`: si el agente carga esa skill, la ejecución se para ahí (parte A)."""
    """Ejecuta una vez `herramienta` con `prompt` en `cwd` y devuelve sus métricas (principal y subagentes)."""
    log.parent.mkdir(parents=True, exist_ok=True)
    aux = log.with_suffix(".aux")
    if aux.exists():
        shutil.rmtree(aux)
    aux.mkdir()
    cmd, env = comando(herramienta, prompt, cwd, subagentes, aux, confiar, modelo)
    parar = (lambda: parar_con in cargadas_en_log(herramienta, log)) if parar_con else None
    semaforo = _SEMAFOROS.get(herramienta) or contextlib.nullcontext()
    with semaforo:
        # La versión se mira justo antes de lanzar: es la que corre aunque se actualice a mitad de lote.
        version_real = version(herramienta)
        inicio = time.time()
        rc = _ejecutar(cmd, env, cwd, log, log.with_suffix(".err"), limite_s, silencio_s, parar)
        fin = time.time()
    m = {"herramienta": herramienta, "version": version_real, "modelo": modelo or HERRAMIENTAS[herramienta]["principal"],
         "subagentes_activados": subagentes, "duracion_s": round(fin - inicio, 1), "rc": rc,
         "stderr": log.with_suffix(".err").read_text(errors="replace")[-1500:]}
    if herramienta == "claude":
        m.update(metricas_claude(log, aux / "claude-config" / "projects"))
    elif herramienta == "codex":
        m.update(metricas_codex(log, inicio, fin, aux))
    else:
        m.update(metricas_opencode(log, aux / "data" / "opencode" / "opencode.db"))
    m["skills_cargadas"] = cargadas_en_log(herramienta, log)
    return m


def _ejecutar(cmd, env, cwd, log, errores, limite_s, silencio_s, parar=None):
    inicio = time.time()
    with open(log, "w") as out, open(errores, "w") as err_out:
        p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err_out,
                             start_new_session=True)
        rc = None
        while rc is None:
            try:
                rc = p.wait(timeout=5 if parar else 15)
            except subprocess.TimeoutExpired:
                ahora = time.time()
                motivo = ("parada" if parar and parar()
                          else "timeout" if ahora - inicio > limite_s
                          else "estancado" if ahora - max(log.stat().st_mtime, inicio) > silencio_s
                          else None)
                if motivo:
                    os.killpg(p.pid, signal.SIGKILL)
                    p.wait()
                    rc = motivo
    return rc


def eventos(ruta: Path):
    if not ruta.exists():
        return
    for linea in ruta.read_text(errors="replace").splitlines():
        try:
            e = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if isinstance(e, dict):
            yield e


def _uso() -> dict:
    """Tokens de un agente o de un modelo. `entrada` es la entrada total, con la caché incluida."""
    return {"peticiones": 0, "entrada": 0, "cache_leida": 0, "cache_escrita_5m": 0, "cache_escrita_1h": 0,
            "salida": 0, "razonamiento": 0}


def _sumar(a: dict, b: dict) -> dict:
    return {k: a.get(k, 0) + b.get(k, 0) for k in _uso()}


def _por_modelo(agentes: list[dict]) -> dict:
    total = {}
    for a in agentes:
        total[a["modelo"]] = _sumar(total.get(a["modelo"], _uso()), a["uso"])
    return total


def _final(m: dict, principal: dict, subagentes: list[dict]) -> dict:
    """Junta las piezas que comparten las tres herramientas."""
    m["principal"] = principal
    m["subagentes"] = subagentes
    m["n_subagentes"] = len(subagentes)
    m["modelos_subagentes"] = sorted({s["modelo"] for s in subagentes if s.get("modelo")})
    m["por_modelo"] = _por_modelo([principal, *subagentes])
    m["total"] = _sumar(principal["uso"], {k: sum(s["uso"][k] for s in subagentes) for k in _uso()}) if subagentes else dict(principal["uso"])
    return m


# ---------------------------------------------------------------- Claude Code

def _uso_transcripcion(ruta: Path) -> tuple[dict, str | None, dict | None]:
    """Uso de una transcripción de Claude Code: cada petición sale una vez por bloque de contenido, con el mismo
    id de mensaje, así que se toma una vez por id (la de más salida). Devuelve el uso, el modelo y la última."""
    por_id: dict[str, dict] = {}
    modelo = None
    orden = []
    for e in eventos(ruta):
        if e.get("type") != "assistant":
            continue
        msg = e.get("message") or {}
        u = msg.get("usage") or {}
        if msg.get("model") and msg.get("model") != "<synthetic>":
            modelo = modelo or msg.get("model")
        mid = msg.get("id") or str(len(orden))
        if mid not in por_id:
            orden.append(mid)
        if mid not in por_id or (u.get("output_tokens") or 0) >= (por_id[mid].get("output_tokens") or 0):
            por_id[mid] = u
    uso = _uso()
    for u in por_id.values():
        cc = u.get("cache_creation") or {}
        c1h = cc.get("ephemeral_1h_input_tokens", 0)
        uso["peticiones"] += 1
        uso["entrada"] += u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
        uso["cache_leida"] += u.get("cache_read_input_tokens", 0)
        uso["cache_escrita_1h"] += c1h
        uso["cache_escrita_5m"] += u.get("cache_creation_input_tokens", 0) - c1h
        uso["salida"] += u.get("output_tokens", 0)
    return uso, modelo, (por_id[orden[-1]] if orden else None)


def metricas_claude(log: Path, transcripciones: Path) -> dict:
    """El stream da la respuesta, los lanzamientos de subagentes y el total (modelUsage, a precio de lista, que
    incluye a los subagentes y las llamadas auxiliares de la herramienta). Su uso por mensaje es parcial, así que
    el reparto entre principal y subagentes sale de las transcripciones: la de la sesión y una por subagente
    (<sesión>/subagents/agent-*.jsonl, con su .meta.json). El contexto del principal al terminar es la entrada de
    su última petición."""
    m = {"herramientas": {}, "ordenes": [], "respuesta_final": "", "sesion": None, "lanzamientos": []}
    for e in eventos(log):
        tipo = e.get("type")
        if tipo == "system" and e.get("subtype") == "init":
            m["sesion"] = e.get("session_id")
            m["modelo_real"] = e.get("model")
            m["init"] = {k: e.get(k) for k in ("tools", "agents", "skills", "claude_code_version")}
        if tipo == "system" and e.get("subtype") == "task_started" and e.get("task_type") == "local_agent":
            # task_started también sale con las órdenes de Bash en segundo plano: solo cuentan los subagentes.
            m["lanzamientos"].append({k: e.get(k) for k in ("tool_use_id", "subagent_type", "is_backgrounded", "description")})
        if tipo == "rate_limit_event":
            info = e.get("rate_limit_info") or {}
            ventanas = info.get("unifiedWindows") or {info.get("rateLimitType"): info}
            m["cuota"] = {k: {"uso": v.get("utilization"), "estado": v.get("status")} for k, v in ventanas.items() if k}
        if tipo == "assistant" and e.get("parent_tool_use_id") is None:
            for bloque in (e.get("message") or {}).get("content", []):
                if bloque.get("type") == "tool_use":
                    nombre = bloque.get("name", "?")
                    m["herramientas"][nombre] = m["herramientas"].get(nombre, 0) + 1
                    if nombre == "Bash":
                        m["ordenes"].append(str(bloque.get("input", {}).get("command", ""))[:300])
                    if nombre == "Skill":
                        m.setdefault("skills_cargadas", []).append(bloque.get("input", {}).get("skill"))
        if tipo == "result":
            m["coste_herramienta_usd"] = e.get("total_cost_usd")
            m["modelUsage"] = e.get("modelUsage") or e.get("model_usage_since_last_result")
            m["subagent_stats"] = e.get("subagent_stats")
            m["turnos"] = e.get("num_turns")
            m["respuesta_final"] = e.get("result") or ""
            m["error_agente"] = e.get("is_error")
            m["duracion_s_agente"] = round((e.get("duration_ms") or 0) / 1000, 1)
    sesion = m["sesion"]
    raiz = next(transcripciones.glob(f"*/{sesion}.jsonl"), None) if sesion else None
    if raiz:
        uso, modelo, ultima = _uso_transcripcion(raiz)
        principal = {"id": sesion, "modelo": modelo, "uso": uso}
        if ultima:
            principal["contexto_final"] = (ultima.get("input_tokens", 0) + ultima.get("cache_read_input_tokens", 0)
                                           + ultima.get("cache_creation_input_tokens", 0))
    else:
        principal = {"id": sesion, "modelo": m.get("modelo_real"), "uso": _uso()}
        m["aviso"] = "no se encontró la transcripción de la sesión"
    subagentes = []
    if raiz:
        for ruta in sorted((raiz.parent / sesion / "subagents").glob("agent-*.jsonl")):
            uso, modelo, _ = _uso_transcripcion(ruta)
            meta = {}
            with contextlib.suppress(Exception):
                meta = json.loads(ruta.with_name(ruta.stem + ".meta.json").read_text())
            subagentes.append({"id": ruta.stem, "modelo": modelo, "uso": uso, "tipo": meta.get("agentType"),
                               "fondo": meta.get("requestShape"), "profundidad": meta.get("spawnDepth")})
    return _final(m, principal, subagentes)


# ---------------------------------------------------------------- Codex

def _rollout(ruta: Path) -> dict:
    """Lo que interesa de un rollout de Codex: su hilo, su padre, su modelo, sus tokens y su último contexto."""
    r = {"ruta": str(ruta), "id": None, "padre": None, "modelo": None, "total": None, "ultimo": None,
         "llamadas": {}, "fork_turns": [], "agent_types": []}
    desde = 0
    for e in eventos(ruta):
        p = e.get("payload") or {}
        if e.get("type") == "session_meta" and r["id"] is None:
            # El hijo copia al principio la historia del padre (con su session_meta): solo vale la primera y
            # solo cuenta lo que viene después de subagent_history_start_ordinal.
            r["id"] = p.get("id")
            desde = p.get("subagent_history_start_ordinal") or 0
            r["heredado_hasta"] = desde
            fuente = p.get("source") or {}
            sub = fuente.get("subagent") if isinstance(fuente, dict) else None
            r["padre"] = p.get("parent_thread_id") or (((sub or {}).get("thread_spawn") or {}).get("parent_thread_id") if isinstance(sub, dict) else None)
            r["fuente"] = fuente
            continue
        if (e.get("ordinal") or 0) < desde:
            continue
        if e.get("type") == "turn_context" and p.get("model"):
            r["modelo"] = p.get("model")
            r["multi_agent"] = p.get("multi_agent_version")
            r["esfuerzo"] = p.get("effort") or p.get("reasoning_effort")
        if e.get("type") == "event_msg" and p.get("type") == "token_count" and p.get("info"):
            r["total"] = p["info"].get("total_token_usage")
            r["ultimo"] = p["info"].get("last_token_usage")
        if e.get("type") == "response_item" and p.get("type") == "function_call":
            nombre = p.get("name", "?")
            r["llamadas"][nombre] = r["llamadas"].get(nombre, 0) + 1
            if nombre == "spawn_agent":
                try:
                    args = json.loads(p.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                r["fork_turns"].append(args.get("fork_turns", args.get("fork_context", "all (por defecto)")))
                r["agent_types"].append({k: args[k] for k in ("task_name", "agent_type", "model", "reasoning_effort") if k in args})
    return r


def _uso_codex(t: dict | None) -> dict:
    u = _uso()
    if t:
        u["entrada"] = t.get("input_tokens", 0)
        u["cache_leida"] = t.get("cached_input_tokens", 0)
        u["salida"] = t.get("output_tokens", 0)  # incluye el razonamiento
        u["razonamiento"] = t.get("reasoning_output_tokens", 0)
    return u


def metricas_codex(log: Path, inicio: float, fin: float, aux: Path) -> dict:
    """El JSON de codex exec no trae a los hijos: se leen los rollouts del padre (thread.started) y de todos sus
    descendientes, que se copian a la carpeta de la ejecución."""
    m = {"herramientas": {}, "ordenes": [], "respuesta_final": "", "sesion": None}
    textos = []
    for e in eventos(log):
        tipo = e.get("type")
        if tipo == "thread.started":
            m["sesion"] = e.get("thread_id")
        if tipo == "item.completed":
            item = e.get("item", {})
            clase = item.get("type") or "?"
            m["herramientas"][clase] = m["herramientas"].get(clase, 0) + 1
            if clase == "command_execution":
                m["ordenes"].append(str(item.get("command", ""))[:300])
            if clase == "agent_message":
                textos.append(item.get("text", ""))
        if tipo in ("turn.failed", "error"):
            m["error_agente"] = json.dumps(e)[:500]
        if tipo == "turn.completed":
            m["uso_stream"] = e.get("usage")
    m["respuesta_final"] = textos[-1] if textos else ""
    rollouts = []
    with _ROLLOUTS:
        for ruta in (aux / "codex-home" / "sessions").rglob("rollout-*.jsonl"):
            if ruta.stat().st_mtime >= inicio - 5:
                rollouts.append(_rollout(ruta))
    familia = {m["sesion"]}
    cambio = True
    while cambio:
        cambio = False
        for r in rollouts:
            if r["padre"] in familia and r["id"] not in familia:
                familia.add(r["id"])
                cambio = True
    suyos = [r for r in rollouts if r["id"] in familia]
    (aux / "rollouts").mkdir(exist_ok=True)
    for r in suyos:
        shutil.copy(r["ruta"], aux / "rollouts" / Path(r["ruta"]).name)
    padre = next((r for r in suyos if r["id"] == m["sesion"]), None)
    principal = {"id": m["sesion"], "modelo": (padre or {}).get("modelo"), "uso": _uso_codex((padre or {}).get("total"))}
    if padre:
        principal["contexto_final"] = (padre.get("ultimo") or {}).get("input_tokens")
        principal["llamadas"] = padre["llamadas"]
        principal["multi_agent"] = padre.get("multi_agent")
        principal["fork_turns"] = padre["fork_turns"]
        principal["lanzamientos"] = padre["agent_types"]
    else:
        m["aviso"] = "no se encontró el rollout del hilo principal"
    subagentes = [{"id": r["id"], "padre": r["padre"], "modelo": r["modelo"], "uso": _uso_codex(r["total"]),
                   "llamadas": r["llamadas"], "rol": ((r.get("fuente") or {}).get("subagent") or {}) if isinstance(r.get("fuente"), dict) else None}
                  for r in suyos if r["id"] != m["sesion"]]
    m["herramientas"].update({f"llamada:{k}": v for k, v in (principal.get("llamadas") or {}).items()})
    return _final(m, principal, subagentes)


# ---------------------------------------------------------------- OpenCode

def metricas_opencode(log: Path, db: Path) -> dict:
    """El hijo es otra sesión con parent_id: su consumo se lee de opencode.db (session_v2), que es propia de la
    ejecución. El contexto del principal al terminar es la entrada del último step-finish de su sesión."""
    m = {"herramientas": {}, "ordenes": [], "respuesta_final": "", "sesion": None}
    textos, marcas = [], []
    pasos = _uso()
    ultimo = None
    for e in eventos(log):
        part = e.get("part", {}) if isinstance(e.get("part"), dict) else {}
        m["sesion"] = m["sesion"] or e.get("sessionID") or part.get("sessionID")
        if isinstance(e.get("timestamp"), (int, float)):
            marcas.append(e["timestamp"])
        if e.get("type") == "step_finish" and part.get("sessionID", m["sesion"]) == m["sesion"]:
            tk = part.get("tokens", {})
            cache = tk.get("cache", {})
            pasos["peticiones"] += 1
            pasos["entrada"] += tk.get("input", 0) + cache.get("read", 0) + cache.get("write", 0)
            pasos["cache_leida"] += cache.get("read", 0)
            pasos["cache_escrita_5m"] += cache.get("write", 0)
            pasos["salida"] += tk.get("output", 0)
            pasos["razonamiento"] += tk.get("reasoning", 0)
            ultimo = tk
        if e.get("type") == "tool_use":
            nombre = part.get("tool", "?")
            m["herramientas"][nombre] = m["herramientas"].get(nombre, 0) + 1
            entrada = part.get("state", {}).get("input", {})
            if nombre in ("bash", "shell"):
                m["ordenes"].append(str(entrada.get("command", ""))[:300])
            if nombre == "subagent":
                m.setdefault("lanzamientos", []).append({k: entrada.get(k) for k in ("agent", "description", "sessionID")})
        if e.get("type") == "text":
            textos.append(part.get("text", ""))
        if e.get("type") == "error":
            m["error_agente"] = json.dumps(e)[:500]
    m["respuesta_final"] = textos[-1] if textos else ""
    if marcas:
        m["duracion_s_agente"] = round((max(marcas) - min(marcas)) / 1000, 1)
    m["uso_stream_principal"] = pasos
    sesiones = _sesiones_opencode(db)
    m["sesiones_db"] = sesiones
    por_id = {s["id"]: s for s in sesiones}
    familia = {m["sesion"]}
    cambio = True
    while cambio:
        cambio = False
        for s in sesiones:
            if s.get("parent_id") in familia and s["id"] not in familia:
                familia.add(s["id"])
                cambio = True
    raiz = por_id.get(m["sesion"])
    principal = {"id": m["sesion"], "modelo": (raiz or {}).get("modelo"), "uso": _uso_oc(raiz) if raiz else pasos,
                 "coste_herramienta_usd": (raiz or {}).get("cost")}
    if not raiz:
        m["aviso"] = "no se encontró la sesión principal en opencode.db: tokens del stream"
    if ultimo:
        principal["contexto_final"] = ultimo.get("input", 0) + ultimo.get("cache", {}).get("read", 0) + ultimo.get("cache", {}).get("write", 0)
    subagentes = [{"id": s["id"], "padre": s.get("parent_id"), "modelo": s.get("modelo"), "uso": _uso_oc(s),
                   "agente": s.get("agent"), "coste_herramienta_usd": s.get("cost")}
                  for s in sesiones if s["id"] in familia and s["id"] != m["sesion"]]
    return _final(m, principal, subagentes)


def _uso_oc(s: dict) -> dict:
    u = _uso()
    u["entrada"] = (s.get("tokens_input") or 0) + (s.get("tokens_cache_read") or 0) + (s.get("tokens_cache_write") or 0)
    u["cache_leida"] = s.get("tokens_cache_read") or 0
    u["cache_escrita_5m"] = s.get("tokens_cache_write") or 0
    u["salida"] = s.get("tokens_output") or 0
    u["razonamiento"] = s.get("tokens_reasoning") or 0
    u["peticiones"] = s.get("peticiones") or 0
    return u


def _sesiones_opencode(db: Path) -> list[dict]:
    if not db.exists():
        return []
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        columnas = [c[1] for c in con.execute("PRAGMA table_info(session_v2)")]
        filas = [dict(f) for f in con.execute("SELECT * FROM session_v2")]
    finally:
        con.close()
    salida = []
    for f in filas:
        s = {k: f.get(k) for k in ("id", "parent_id", "cost", "tokens_input", "tokens_output", "tokens_reasoning",
                                   "tokens_cache_read", "tokens_cache_write", "agent", "title") if k in columnas}
        modelo = f.get("model")
        if isinstance(modelo, str) and modelo.startswith("{"):
            with contextlib.suppress(json.JSONDecodeError):
                modelo = json.loads(modelo)
        if isinstance(modelo, dict):
            modelo = "/".join(x for x in (modelo.get("providerID"), modelo.get("id") or modelo.get("modelID")) if x)
        s["modelo"] = modelo
        salida.append(s)
    return salida
