"""Lanza un lote de ejecuciones en paralelo, con un límite de ejecuciones simultáneas por herramienta.

Es reanudable: una ejecución ya terminada (resultados/<lote>/<id>.json con terminada = true) no se repite. Las que
fallan por algo ajeno al experimento (cuota, red, autenticación) se anotan como AJENO, no se guardan y se repiten al
relanzar el lote.

Uso (OpenCode necesita NAN_API_KEY, que pone oprun):
  oprun python3 -I runner/lote.py lote --partes A,B
  oprun python3 -I runner/lote.py piloto --partes A --reps 1 --peticiones fac-n1,con-i1,tst-p1
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
    partes = args.partes.split(",")
    peticiones = args.peticiones.split(",") if args.peticiones else list(casos.PETICIONES)
    skills = args.skills.split(",") if args.skills else list(casos.PARTE_B)
    for rep in range(1, args.reps + 1):
        if "A" in partes:
            for pid in peticiones:
                for d in ("vaga", "concreta"):
                    for inst in args.instalaciones.split(","):
                        for h in herramientas:
                            lista.append(("A", h, pid, d, inst, rep))
        if "B" in partes:
            for sk in skills:
                for cond in casos.PARTE_B[sk]["condiciones"]:
                    for h in herramientas:
                        lista.append(("B", h, sk, cond, rep))
    # Primero las repeticiones bajas: si el lote se corta, quedan repeticiones completas de todo.
    return sorted(lista, key=lambda t: (t[-1], t[0]))


def ejecutar(lote: str, t: tuple) -> dict:
    return casos.activacion(lote, *t[1:]) if t[0] == "A" else casos.efecto(lote, *t[1:])


def ident(t: tuple) -> str:
    return casos.ident_a(*t[1:]) if t[0] == "A" else casos.ident_b(*t[1:])


def describir(r: dict) -> str:
    e = r["ejecucion"]
    base = f"{e['duracion_s']:.0f}s {e['costes'].get('total_usd') or 0:.3f}$ rc={e.get('rc')} skills={e.get('skills_cargadas')}"
    if r["parte"] == "A":
        a = r["activacion"]
        return base + f" acierto={a['acierto']} fp={a['falsos_positivos']}"
    c = r["correccion"]
    if r["skill"] == "consultas-club":
        return base + f" consultas={c['aciertos']}/4"
    enc = next(iter(c["encargos"].values()))
    mut = r.get("mutantes")
    return base + (f" gate={c['gate_ok']} criterios={enc['criterios_ok']}/{enc['criterios_total']}"
                   + (f" mutantes={mut['cazados']}/{mut['total']} (validos {mut['validos']}/{mut['tests']})" if mut else ""))


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("lote")
    a.add_argument("--partes", default="A,B")
    a.add_argument("--peticiones", default="", help="ids de activacion/peticiones.json (por defecto, todas)")
    a.add_argument("--skills", default="", help="skills de la parte B (por defecto, las tres)")
    a.add_argument("--instalaciones", default="pocas,muchas", help="parte A: 3 skills (pocas) o 33 (muchas)")
    a.add_argument("--herramientas", default="claude,codex,opencode")
    a.add_argument("--reps", type=int, default=2)
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
        r = ejecutar(args.lote, t)
        with cerrojo:
            gastado[0] += r["ejecucion"]["costes"].get("total_usd") or 0
        return r

    sincronizar_auth_codex()
    anotar(f"lote {args.lote}: {len(lista)} ejecuciones")
    with ThreadPoolExecutor(args.hilos) as ex:
        futuros = {ex.submit(una, t): t for t in lista}
        for f in as_completed(futuros):
            cid = ident(futuros[f])
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
