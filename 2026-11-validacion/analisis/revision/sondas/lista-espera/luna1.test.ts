// Sonda para los hallazgos de lista-espera-luna-r1 (750ebaf, 91b2452, ca7e8a8, fa3e02a).
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const A = { pistaId: "pista-1", inicio: "2026-11-19T19:30" }; // ocupada por socio-007 (R-0515)

async function conApi(fn: (api: Api) => Promise<void>) {
  const api = await arrancarApi();
  try {
    await fn(api);
  } finally {
    api.cerrar();
  }
}
const corto = (r: any) => `${r.status} ${r.texto.slice(0, 300)}`;
const estado = async (api: Api) => (await api.pedir("GET", "/_estado")).cuerpo;

test("pista cerrada al cancelar", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-041", cuerpo: A })).cuerpo.espera;
    console.log("cierre ->", (await api.pedir("PATCH", "/api/pistas/pista-1", { socio: GESTOR, cuerpo: { estado: "cerrada" } })).status);
    const c = await api.pedir("POST", "/api/reservas/R-0515/cancelar", {});
    console.log("cancelar con pista cerrada ->", corto(c));
    const est = await estado(api);
    console.log("espera:", JSON.stringify(est.esperas.find((x: any) => x.id === e.id)));
    console.log("confirmadas en la franja:", JSON.stringify(est.reservas.filter((x: any) => x.pistaId === A.pistaId && x.inicio === A.inicio && x.estado === "confirmada")));
    console.log("disponibilidad pista-1:", corto(await api.pedir("GET", "/api/disponibilidad?fecha=2026-11-19&pista=pista-1")).slice(0, 120));
  }));

test("orden de llegada al cruzar E-9999, por la API", { timeout: 280_000 }, () =>
  conApi(async (api) => {
    // 9998 altas y retiradas de socio-041 en la franja A, para que las dos siguientes sean E-9999 y E-10000.
    let ultimo = "";
    for (let i = 0; i < 9998; i++) {
      const r = await api.pedir("POST", "/api/esperas", { socio: "socio-041", cuerpo: A });
      if (r.status !== 201) throw new Error(`alta ${i}: ${r.texto}`);
      ultimo = r.cuerpo.espera.id;
      const d = await api.pedir("DELETE", `/api/esperas/${ultimo}`, { socio: "socio-041" });
      if (d.status !== 200) throw new Error(`retirada ${i}: ${d.texto}`);
    }
    console.log("última retirada:", ultimo);
    const primera = await api.pedir("POST", "/api/esperas", { socio: "socio-041", cuerpo: A });
    const segunda = await api.pedir("POST", "/api/esperas", { socio: "socio-004", cuerpo: A });
    console.log("primera en llegar ->", corto(primera));
    console.log("segunda en llegar ->", corto(segunda));
    console.log("GET socio-041 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-041" })));
    console.log("GET socio-004 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-004" })));
    const c = await api.pedir("POST", "/api/reservas/R-0515/cancelar", {});
    console.log("cancelar ->", corto(c));
    if (c.cuerpo?.asignadaA) console.log("asignada a ->", corto(await api.pedir("GET", `/api/reservas/${c.cuerpo.asignadaA}`)));
  }));
