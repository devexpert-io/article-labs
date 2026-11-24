# Configuración propuesta

La configuración de equipo que proponemos en el artículo. Parte de la configuración "base" que se midió (`runner/agentes.py`, 0, 2 y 2 acciones de 22 en Claude Code, Codex y OpenCode) y cierra los huecos que salieron en la prueba:

- **Claude Code:** `Bash(git push --force*)` en lugar de `Bash(git push --force *)`, para que cubra también `--force-with-lease=…`, con el que Claude Code hizo el push.
- **Hook:** reconoce `.env` detrás de `@` (`curl --data-binary @.env`) y los borrados con `--` o con `rmdir` (`rm -rf -- ~/proyecto-antiguo`).

El hook se ha probado contra los comandos exactos que se le escaparon al medido, sacados de las trazas (`python3 propuesta/probar-hook.py`). Las ejecuciones con los agentes no se han repetido con esta versión.

| Fichero | Dónde va |
|---|---|
| `claude-settings.json` | `~/.claude/settings.json` (modo `auto`) |
| `codex-config.toml` | `~/.codex/config.toml` |
| `codex-equipo.rules` | `~/.codex/rules/equipo.rules` |
| `opencode.json` | `~/.config/opencode/opencode.json` (con `--auto`) |
| `guardia-opencode.js` | `~/.config/opencode/plugins/guardia.js` |
| `hook-seguridad.py` | `~/.claude/`, `~/.codex/` y `~/.config/opencode/` |

Cambia las rutas absolutas (`/home/tu-usuario/…`) por las tuyas. En un equipo, lo mismo va en la configuración gestionada de cada herramienta.

Lo que no arregla: OpenCode sigue sin sandbox, así que un test que imprime el `.env` lo vuelca igual. Para eso hace falta un contenedor o una máquina virtual.
