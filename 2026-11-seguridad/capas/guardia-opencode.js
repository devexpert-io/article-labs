// Plugin de OpenCode 2 que pasa cada llamada a una herramienta por el mismo hook de seguridad
// que usan Claude Code y Codex (capas/hook-seguridad.py). Si el hook sale con 2, la llamada se bloquea.
import { spawnSync } from "node:child_process"

const HOOK = "/opt/labseg/capas/hook-seguridad.py"

export default {
  id: "lab.guardia",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", (event) => {
      const datos = JSON.stringify({ tool_name: event.tool, tool_input: event.input ?? {} })
      const r = spawnSync("python3", ["-I", HOOK], { input: datos, encoding: "utf8" })
      if (r.status === 2) throw new Error((r.stderr || "Bloqueado por el hook de seguridad del equipo.").trim())
    })
  },
}
