"""Lanza un lote de cadenas en paralelo, con un límite de ejecuciones simultáneas por agente.

Uso (OpenCode necesita NAN_API_KEY, que pone oprun):
  oprun python3 -I runner/lote.py <lote> --encargos exportar-csv,lista-espera --configs opus,sol,haiku,luna,deepseek --reps 1
"""
import argparse
import json
import shutil
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agentes  # noqa: E402
import cadena  # noqa: E402


def sincronizar_auth_codex() -> None:
    """Codex renueva su token en la copia del laboratorio: la más reciente se copia a la otra."""
    principal = Path.home() / ".codex" / "auth.json"
    copia = agentes.CODEX_HOME / "auth.json"
    if not principal.exists() or not copia.exists():
        return
    fecha = lambda p: json.loads(p.read_text()).get("last_refresh") or ""  # noqa: E731
    origen, destino = (copia, principal) if fecha(copia) > fecha(principal) else (principal, copia)
    if fecha(origen) != fecha(destino):
        tmp = destino.with_suffix(".tmp")
        shutil.copy2(origen, tmp)
        tmp.replace(destino)


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("lote")
    a.add_argument("--encargos", required=True)
    a.add_argument("--configs", required=True)
    a.add_argument("--reps", default="1", help="número de repeticiones (1..N) o lista: 2,3")
    a.add_argument("--condiciones", default="ABCD")
    a.add_argument("--hilos", type=int, default=6)
    a.add_argument("--claude", type=int, default=2)
    a.add_argument("--codex", type=int, default=2)
    a.add_argument("--opencode", type=int, default=2)
    args = a.parse_args()
    agentes.limitar("claude", args.claude)
    agentes.limitar("codex", args.codex)
    agentes.limitar("opencode", args.opencode)
    reps = [int(x) for x in args.reps.split(",")] if "," in args.reps else list(range(1, int(args.reps) + 1))
    trabajos = [(e, c, r) for r in reps for e in args.encargos.split(",") for c in args.configs.split(",")]
    registro = agentes.SCR / "lotes" / f"{args.lote}.log"
    registro.parent.mkdir(parents=True, exist_ok=True)

    def anotar(texto: str) -> None:
        linea = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {texto}"
        print(linea, flush=True)
        with open(registro, "a") as f:
            f.write(linea + "\n")

    sincronizar_auth_codex()
    anotar(f"lote {args.lote}: {len(trabajos)} cadenas")
    with ThreadPoolExecutor(args.hilos) as ex:
        futuros = {ex.submit(cadena.ejecutar, args.lote, e, c, r, args.condiciones): (e, c, r) for e, c, r in trabajos}
        for f in as_completed(futuros):
            e, c, r = futuros[f]
            try:
                res = f.result()
                fin = {k: (res.get(k) or {}).get("final", {}).get("completo") for k in ("B", "C")}
                anotar(f"ok {e}-{c}-r{r}: A {res['A']['criterios_ok']}/{res['A']['criterios_total']} "
                       f"D {((res.get('D') or {}).get('veredicto') or {}).get('veredicto')} "
                       f"B {(res.get('B') or {}).get('veredicto_final')}->{fin['B']} "
                       f"C {(res.get('C') or {}).get('veredicto_final')}->{fin['C']}")
            except Exception:
                anotar(f"ERROR {e}-{c}-r{r}: {traceback.format_exc()[-1500:]}")
    sincronizar_auth_codex()
    anotar("lote terminado")


if __name__ == "__main__":
    main()
