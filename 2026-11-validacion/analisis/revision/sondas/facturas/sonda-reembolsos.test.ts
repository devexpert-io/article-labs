// Sonda de revisión para los hallazgos de `reembolsos`. Imprime lo que responde la API en cada caso.
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";

function ver(etiqueta: string, valor: unknown) {
  console.log(`SONDA ${etiqueta} => ${typeof valor === "string" ? valor : JSON.stringify(valor)}`);
}

async function conApi(entorno: Record<string, string>, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ TZ: "UTC", ...entorno });
  try {
    await prueba(api);
  } catch (error) {
    ver("ERROR", String(error));
  } finally {
    api.cerrar();
  }
}

const reloj = (api: Api, ahora: string) => api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
const reservar = async (api: Api, socioId: string, pistaId: string, inicio: string) =>
  (await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } })).cuerpo?.reserva;
const cancelar = (api: Api, id: string, cuerpo: Record<string, unknown>, socio?: string) =>
  api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo, socio });
const corto = (r: { status: number; cuerpo: any }) => ({
  status: r.status,
  codigo: r.cuerpo?.error?.codigo,
  penalizacion: r.cuerpo?.reserva?.penalizacion,
  motivo: r.cuerpo?.reserva?.motivoCancelacion,
  reembolso: r.cuerpo?.reembolso,
});

/** Instante real de una hora local de Madrid en 2027, con los dos cambios de hora de ese año (28-mar y 31-oct a la 01:00 UTC). */
function instanteReal(local: string): number {
  const comoUtc = Date.parse(`${local}:00Z`);
  const verano = Date.parse("2027-03-28T01:00:00Z");
  const invierno = Date.parse("2027-10-31T01:00:00Z");
  // Con +2 (CEST): instante = local - 2 h; vale si cae en [verano, invierno). Si no, +1 (CET).
  const conVerano = comoUtc - 2 * 3_600_000;
  if (conVerano >= verano && conVerano < invierno) return conVerano;
  return comoUtc - 3_600_000;
}

function tramo(horas: number): number {
  return horas >= 48 ? 0 : horas >= 24 ? 25 : 50;
}

test("sonda reembolsos", { timeout: 300_000 }, async () => {
  // R1: motivo con espacios alrededor.
  await conApi({ AHORA: "2027-02-01T10:00" }, async (api) => {
    for (const motivo of ["Lesionado ", " Lesionado", "          ", "Lesionado.", "  Lesionado.  "]) {
      const r = await reservar(api, "socio-041", "pista-1", "2027-02-09T13:30");
      const c = await cancelar(api, r.id, { exento: true, motivo }, GESTOR);
      ver(`R1 motivo=${JSON.stringify(motivo)} (${motivo.length} caracteres)`, corto(c));
      if (c.status !== 200) await cancelar(api, r.id, {}, undefined);
    }
  });

  // R4: informe con un mes fuera de 01-12, y la convención de la base con fechas imposibles en los filtros.
  await conApi({}, async (api) => {
    for (const mes of ["2026-99", "2026-00", "2026-13"]) {
      const r = await api.pedir("GET", `/api/informes/caja?mes=${mes}`, { socio: GESTOR });
      ver(`R4 informe mes=${mes}`, { status: r.status, codigo: r.cuerpo?.error?.codigo, total: r.cuerpo?.total });
    }
    for (const ruta of ["/api/reservas?fecha=2026-99-99", "/api/disponibilidad?fecha=2026-99-99"]) {
      const r = await api.pedir("GET", ruta);
      ver(`R4 base ${ruta}`, { status: r.status, codigo: r.cuerpo?.error?.codigo });
    }
  });

  // R10: precedencia de errores al pedir la exención.
  await conApi({ AHORA: "2027-02-01T10:00" }, async (api) => {
    const r = await reservar(api, "socio-041", "pista-1", "2027-02-09T13:30");
    for (const [quien, cuerpo] of [
      ["socio-003", { exento: true }],
      ["socio-003", { exento: true, motivo: "corto" }],
      ["socio-003", { exento: true, motivo: "Lesión de rodilla" }],
      [undefined, { exento: true }],
      [undefined, { exento: true, motivo: "Lesión de rodilla" }],
      [GESTOR, { exento: true }],
    ] as const) {
      ver(`R10 ${quien ?? "anonimo"} ${JSON.stringify(cuerpo)}`, corto(await cancelar(api, r.id, cuerpo, quien)));
    }
  });

  // C6: una reserva que ya ha empezado, con exento.
  await conApi({ AHORA: "2027-02-01T10:00" }, async (api) => {
    const r = await reservar(api, "socio-041", "pista-2", "2027-02-10T12:00");
    for (const ahora of ["2027-02-10T12:00", "2027-02-10T12:45"]) {
      await reloj(api, ahora);
      ver(`C6 exento a ${ahora}`, corto(await cancelar(api, r.id, { exento: true, motivo: "Lesión de rodilla" }, GESTOR)));
      ver(`C6 forzar a ${ahora}`, corto(await cancelar(api, r.id, { forzar: true }, undefined)));
    }
  });

  // C3: el reloj del club entre la 01:00 y la 01:59 de las dos noches del cambio de hora de 2027, contra todas las franjas
  // de los tres días siguientes. Compara la penalización con la que sale de las horas reales.
  const HORAS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];
  for (const [noche, dias] of [["2027-03-28", ["2027-03-28", "2027-03-29", "2027-03-30"]], ["2027-10-31", ["2027-10-31", "2027-11-01", "2027-11-02"]]] as const) {
    await conApi({ AHORA: `${noche}T00:00` }, async (api) => {
      let casos = 0;
      const distintos: unknown[] = [];
      let minimaDistancia = Infinity;
      for (const minuto of ["00", "15", "30", "45", "59"]) {
        const ahora = `${noche}T01:${minuto}`;
        for (const dia of dias) {
          for (const hora of HORAS) {
            const inicio = `${dia}T${hora}`;
            await reloj(api, ahora);
            const r = await reservar(api, "socio-041", "pista-1", inicio);
            if (!r) { distintos.push({ ahora, inicio, error: "no se pudo reservar" }); continue; }
            const c = await cancelar(api, r.id, { forzar: true }, undefined);
            const horas = (instanteReal(inicio) - instanteReal(ahora)) / 3_600_000;
            minimaDistancia = Math.min(minimaDistancia, Math.abs(horas - 24), Math.abs(horas - 48));
            const esperada = (r.importe * tramo(horas)) / 100;
            const obtenida = c.cuerpo?.reserva?.penalizacion ?? 0;
            casos += 1;
            if (c.status !== 200 || obtenida !== esperada) distintos.push({ ahora, inicio, horas, esperada, obtenida, status: c.status });
          }
        }
      }
      ver(`C3 noche ${noche}: casos`, { casos, distintos, minimaDistanciaA24o48: minimaDistancia });
    });
  }

  // C3: el ejemplo de la spec y la vuelta al horario de invierno, como comprobación.
  await conApi({ AHORA: "2027-03-20T10:00" }, async (api) => {
    const r = await reservar(api, "socio-041", "pista-1", "2027-03-28T21:00");
    await reloj(api, "2027-03-26T20:30");
    ver("C3 ejemplo de la spec (47,5 h)", corto(await cancelar(api, r.id, {}, undefined)));
  });
});
