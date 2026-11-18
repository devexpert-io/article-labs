"""Lanza un lote de ejecuciones en paralelo, con un límite de ejecuciones simultáneas por herramienta.

Es reanudable: una ejecución ya terminada (resultados/<lote>/<id>.json con terminada = true) no se repite. Las que
fallan por algo ajeno al experimento (cuota, red, autenticación) se anotan como AJENO, no se guardan y se repiten al
relanzar el lote.

Uso (OpenCode necesita NAN_API_KEY, que pone oprun). El lote completo del diseño (72 ejecuciones):
  oprun python3 -I runner/lote.py lote
El piloto:
  oprun python3 -I runner/lote.py piloto --reps 1 --reps-caso3 1 --encargos-caso3 reembolsos
"""
import argparse
import json
import shutil
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agentes  # noqa: E402
import casos  # noqa: E402


class TopeAlcanzado(RuntimeError):
    pass


def sincronizar_auth_codex() -> None:
    """Codex renueva su token en la copia del laboratorio: la más reciente se copia a la otra (como en validación)."""
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


def trabajos(args) -> list[tuple]:
    herramientas = args.herramientas.split(",")
    lista = []
    for caso in [int(c) for c in args.casos.split(",")]:
        reps = args.reps_caso3 if caso == 3 else args.reps
        encargos = args.encargos_caso3.split(",") if caso == 3 else [None]
        for rep in range(1, reps + 1):
            for encargo in encargos:
                for h in herramientas:
                    for cond in casos.CONDICIONES[caso]:
                        lista.append((caso, h, cond, rep, encargo))
    # Primero las repeticiones bajas: si el lote se corta, quedan repeticiones completas de todo.
    return sorted(lista, key=lambda t: (t[3], t[0]))


def describir(r: dict) -> str:
    e = r["ejecucion"]
    base = (f"{e['duracion_s']:.0f}s {e['costes'].get('total_usd') or 0:.3f}$ subagentes={e['n_subagentes']} "
            f"{e['modelos_subagentes']} ctx={e['principal'].get('contexto_final')} ok={r['comprobaciones']}")
    if r["caso"] == 1:
        p = r["puntuacion"]
        return base + (f" aciertos={p['aciertos']}/{p['referencia']} errores={len(p['errores'])} inventadas={len(p['inventadas'])}"
                       if p.get("inventario_legible") else " inventario ilegible")
    c = r["correccion"]
    return base + f" gate={c['gate_ok']} completos={c['completos']}/{c['total']} " + " ".join(
        f"{k}:{v['criterios_ok']}/{v['criterios_total']}" for k, v in c["encargos"].items())


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("lote")
    a.add_argument("--casos", default="1,2,3")
    a.add_argument("--herramientas", default="claude,codex,opencode")
    a.add_argument("--reps", type=int, default=3, help="repeticiones de los casos 1 y 2")
    a.add_argument("--reps-caso3", type=int, default=2)
    a.add_argument("--encargos-caso3", default="reembolsos,duraciones")
    a.add_argument("--hilos", type=int, default=6)
    a.add_argument("--claude", type=int, default=2)
    a.add_argument("--codex", type=int, default=2)
    a.add_argument("--opencode", type=int, default=2)
    a.add_argument("--tope-usd", type=float, default=None,
                   help="no empieza ejecuciones nuevas cuando lo gastado (a precio de API) pasa de esta cifra")
    args = a.parse_args()
    for h in ("claude", "codex", "opencode"):
        agentes.limitar(h, getattr(args, h))
    lista = trabajos(args)
    registro = agentes.SCR / "lotes" / f"{args.lote}.log"
    registro.parent.mkdir(parents=True, exist_ok=True)

    def anotar(texto: str) -> None:
        linea = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {texto}"
        print(linea, flush=True)
        with open(registro, "a") as f:
            f.write(linea + "\n")

    gastado = [0.0]
    cerrojo = threading.Lock()

    def una(t):
        with cerrojo:
            if args.tope_usd is not None and gastado[0] > args.tope_usd:
                raise TopeAlcanzado(f"llevamos {gastado[0]:.2f} $")
        r = casos.ejecutar(args.lote, *t)
        with cerrojo:
            gastado[0] += r["ejecucion"]["costes"].get("total_usd") or 0
        return r

    sincronizar_auth_codex()
    anotar(f"lote {args.lote}: {len(lista)} ejecuciones")
    with ThreadPoolExecutor(args.hilos) as ex:
        futuros = {ex.submit(una, t): t for t in lista}
        for f in as_completed(futuros):
            cid = casos.ident(*futuros[f])
            try:
                anotar(f"ok {cid}: {describir(f.result())}")
            except TopeAlcanzado as e:
                anotar(f"TOPE {cid}: no se lanza, {e}")
            except casos.FalloAjeno as e:
                anotar(f"AJENO {cid}: {e} (sin guardar: se repite al relanzar el lote)")
            except Exception:
                anotar(f"ERROR {cid}: {traceback.format_exc()[-1500:]}")
    sincronizar_auth_codex()
    anotar(f"lote terminado: {gastado[0]:.2f} $ a precio de API")


if __name__ == "__main__":
    main()
