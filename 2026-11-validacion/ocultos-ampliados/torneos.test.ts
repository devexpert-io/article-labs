// Tests ampliados de la spec `torneos`: una clase de defecto de comportamiento que los tests ocultos no miran.
// Caja negra: solo la API HTTP, más /_estado para comprobar. Cada prueba arranca su propia API, con el reloj fijado.
//
// X1 · franjas con una fecha que no existe (mes 13, día 32, mes 00 o día 00). torneos-deepseek-r1 (A y B, el mismo commit)
//      responde 500 al crear el torneo, porque valida la fecha con new Date(...).toISOString(), que lanza con una fecha
//      inválida. La base acepta esas fechas al reservar (201) y no responde 500. Lo encontró la revisión, fuera del paquete.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00: las fechas de las pruebas son todas posteriores, también como texto. */
const ENERO = "2027-01-04T10:00";

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>) {
  test(nombre, { timeout: 60_000 }, async () => {
    const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC" });
    abiertas.add(api);
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

/** Cuántos torneos hay, por el listado de la API (C5) o, si el listado no sirve, por /_estado. */
async function cuantosTorneos(api: Api): Promise<number | undefined> {
  const listado = await api.pedir("GET", "/api/torneos");
  if (Array.isArray(listado.cuerpo?.torneos)) return listado.cuerpo.torneos.length;
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  return Array.isArray(estado?.torneos) ? estado.torneos.length : undefined;
}

prueba("X1 · una franja con una fecha que no existe se rechaza con 400 FRANJA_INVALIDA sin crear nada o se acepta tal cual, nunca con un 500 (C2)", async (api) => {
  // Con el formato AAAA-MM-DDTHH:MM y la hora de una franja, pero con un día que no existe. Las cuatro primeras no son ni
  // siquiera una fecha para Date (mes 13, día 32, mes 00 y día 00) y las dos últimas pasan al mes siguiente (30 de febrero y
  // 31 de abril). Cada una en un día distinto, así que no chocan entre sí aunque se creen.
  const casos = ["2027-13-01T09:00", "2027-02-32T10:30", "2028-00-10T12:00", "2027-06-00T09:00", "2027-02-30T09:00", "2027-04-31T09:00"];
  for (const inicio of casos) {
    const antes = await cuantosTorneos(api);
    const r = await api.pedir("POST", "/api/torneos", {
      socio: GESTOR,
      cuerpo: { nombre: "Torneo de prueba", pistas: ["pista-1"], franjas: [inicio], plazas: 8, cuota: 0 },
    });
    assert.notEqual(r.status, 500, `franjas = ["${inicio}"]: respondió 500 ${r.texto.slice(0, 300)}`);
    if (r.status >= 200 && r.status < 300) {
      // Si se acepta, como la base acepta esa fecha al reservar, el torneo la guarda tal cual: sin pasarla a otro día.
      const torneo = r.cuerpo?.torneo ?? r.cuerpo;
      assert.deepEqual(torneo?.franjas, [inicio], `franjas = ["${inicio}"]: el torneo creado trae ${JSON.stringify(torneo?.franjas)}`);
    } else {
      assert.equal(r.status, 400, `franjas = ["${inicio}"]: esperaba 400 FRANJA_INVALIDA o un 201 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
      assert.equal(r.cuerpo?.error?.codigo, "FRANJA_INVALIDA", `franjas = ["${inicio}"]: ${r.texto.slice(0, 300)}`);
      assert.equal(await cuantosTorneos(api), antes, `franjas = ["${inicio}"]: con el error no se crea ningún torneo`);
    }
  }
});
