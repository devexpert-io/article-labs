// luna-r2 D1/h1: ¿cancelar una reserva no_presentada procesa la lista? Solo se puede cancelar con el reloj hacia atrás.
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

const corto = (r: any) => `${r.status} ${r.texto.slice(0, 300)}`;
const sumarDias = (fh: string, d: number) => new Date(Date.parse(`${fh}:00Z`) + d * 86_400_000).toISOString().slice(0, 16);

test("no_presentada con el reloj hacia atrás", async () => {
  const api = await arrancarApi();
  try {
    const est0 = (await api.pedir("GET", "/_estado")).cuerpo;
    // Cuántas no_presentada hay en el futuro con el reloj normal: ninguna.
    console.log("no_presentada futuras con el reloj normal:", est0.reservas.filter((r: any) => r.estado === "no_presentada" && r.inicio > est0.ahora).length);
    const np = est0.reservas.filter((r: any) => r.estado === "no_presentada" && r.pistaId !== "pista-4").at(-1);
    console.log("no_presentada elegida:", JSON.stringify(np));
    const ahora = sumarDias(np.inicio.slice(0, 10) + "T00:00", -1);
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
    const est = (await api.pedir("GET", "/_estado")).cuerpo;
    const futuras = (id: string) => est.reservas.filter((r: any) => r.socioId === id && r.estado === "confirmada" && r.inicio > ahora).length;
    const libres = est.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva && futuras(s.id) === 0).map((s: any) => s.id);
    console.log("reloj:", ahora, "socios sin reservas futuras:", libres.slice(0, 5).join(","));
    const [titular, espera] = libres;
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: titular, pistaId: np.pistaId, inicio: np.inicio } });
    console.log("reservar la franja de la no_presentada ->", corto(r));
    const e = await api.pedir("POST", "/api/esperas", { socio: espera, cuerpo: { pistaId: np.pistaId, inicio: np.inicio } });
    console.log("espera ->", corto(e));
    const c = await api.pedir("POST", `/api/reservas/${np.id}/cancelar`, {});
    console.log("cancelar la no_presentada ->", corto(c));
    const fin = (await api.pedir("GET", "/_estado")).cuerpo;
    console.log("no_presentada tras cancelar:", JSON.stringify(fin.reservas.find((x: any) => x.id === np.id)));
    console.log("espera tras cancelar:", JSON.stringify((fin.esperas ?? []).find((x: any) => x.id === e.cuerpo?.espera?.id)));
    console.log("confirmadas en la franja:", JSON.stringify(fin.reservas.filter((x: any) => x.pistaId === np.pistaId && x.inicio === np.inicio && x.estado === "confirmada").map((x: any) => [x.id, x.socioId])));
  } finally {
    api.cerrar();
  }
});
