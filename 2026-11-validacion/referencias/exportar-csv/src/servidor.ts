// API HTTP del club. Guarda el estado en memoria y es la única puerta que toca los datos.
//   PORT=4800 node src/servidor.ts               (PORT=0 elige un puerto libre y lo imprime como PUERTO=<n>)
//   AHORA=2026-11-20T09:00 node src/servidor.ts  (cambia la hora del club; por defecto, 2026-11-18T10:00)
import { createServer, type IncomingMessage } from "node:http";
import { crearClub, ErrorDelClub, type ExportacionCsv, type FiltrosExportacion, type FiltrosReservas } from "./nucleo.ts";
import { crearSemilla } from "./semilla.ts";
import type { Socio } from "./tipos.ts";

const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const estado = crearSemilla();
if (process.env.AHORA) {
  if (!FECHA_HORA.test(process.env.AHORA)) throw new Error("AHORA debe tener el formato AAAA-MM-DDTHH:MM");
  estado.ahora = process.env.AHORA;
}
const club = crearClub(estado);

async function leerCuerpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  const trozos: Buffer[] = [];
  for await (const trozo of req) trozos.push(trozo as Buffer);
  const texto = Buffer.concat(trozos).toString("utf8").trim();
  if (!texto) return {};
  try {
    const datos: unknown = JSON.parse(texto);
    if (typeof datos !== "object" || datos === null || Array.isArray(datos)) throw new Error("no es un objeto");
    return datos as Record<string, unknown>;
  } catch {
    throw new ErrorDelClub("DATOS_INVALIDOS", "El cuerpo debe ser un objeto JSON", 400);
  }
}

function numero(valor: string | null): number | undefined {
  return valor === null ? undefined : Number(valor);
}

/** Quién hace la petición: la cabecera X-Socio lleva el id de un socio. Sin cabecera, undefined. */
function identificar(req: IncomingMessage): Socio | undefined {
  const id = req.headers["x-socio"];
  if (id === undefined) return undefined;
  const socio = typeof id === "string" ? estado.socios.find((s) => s.id === id) : undefined;
  if (!socio) throw new ErrorDelClub("NO_IDENTIFICADO", "La cabecera X-Socio no corresponde a ningún socio", 401);
  return socio;
}

type Operacion = { nombre: string; argumentos: unknown; ejecutar: () => unknown };

// `quien` es el socio que hace la petición (cabecera X-Socio). Solo lo usa la exportación, que es para gestores.
async function resolver(req: IncomingMessage, url: URL, quien: Socio | undefined): Promise<Operacion> {
  const metodo = req.method ?? "GET";
  const partes = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;
  if (partes[0] !== "api") throw new ErrorDelClub("RUTA_NO_ENCONTRADA", `No existe ${url.pathname}`, 404);
  const [, recurso, id, accion] = partes;

  if (recurso === "pistas" && !id && metodo === "GET") {
    return { nombre: "listarPistas", argumentos: {}, ejecutar: () => club.listarPistas() };
  }
  if (recurso === "pistas" && id && !accion && metodo === "PATCH") {
    const cuerpo = await leerCuerpo(req);
    return { nombre: "cambiarEstadoPista", argumentos: { pistaId: id, ...cuerpo }, ejecutar: () => club.cambiarEstadoPista(id, cuerpo.estado) };
  }
  if (recurso === "disponibilidad" && !id && metodo === "GET") {
    const argumentos = { fecha: q.get("fecha") ?? undefined, pistaId: q.get("pista") ?? undefined };
    return { nombre: "disponibilidad", argumentos, ejecutar: () => club.disponibilidad(argumentos.fecha, argumentos.pistaId) };
  }
  if (recurso === "socios" && !id && metodo === "GET") {
    const texto = q.get("texto") ?? undefined;
    return { nombre: "buscarSocios", argumentos: { texto }, ejecutar: () => club.buscarSocios(texto) };
  }
  if (recurso === "reservas" && !id && metodo === "GET") {
    const filtros: FiltrosReservas = {
      fecha: q.get("fecha") ?? undefined,
      desde: q.get("desde") ?? undefined,
      hasta: q.get("hasta") ?? undefined,
      socioId: q.get("socio") ?? undefined,
      pistaId: q.get("pista") ?? undefined,
      estado: q.get("estado") ?? undefined,
      limite: numero(q.get("limite")),
      pagina: numero(q.get("pagina")),
    };
    return { nombre: "listarReservas", argumentos: filtros, ejecutar: () => club.listarReservas(filtros) };
  }
  if (recurso === "reservas" && !id && metodo === "POST") {
    const cuerpo = await leerCuerpo(req);
    return { nombre: "crearReserva", argumentos: cuerpo, ejecutar: () => club.crearReserva(cuerpo) };
  }
  // Antes que GET /api/reservas/:id, para que "exportar" no se tome por el id de una reserva.
  if (recurso === "reservas" && id === "exportar" && !accion && metodo === "GET") {
    const filtros: FiltrosExportacion = {
      desde: q.get("desde") ?? undefined,
      hasta: q.get("hasta") ?? undefined,
      estado: q.get("estado") ?? undefined,
    };
    return { nombre: "exportarReservas", argumentos: filtros, ejecutar: () => club.exportarReservas(quien, filtros) };
  }
  if (recurso === "reservas" && id && !accion && metodo === "GET") {
    return { nombre: "obtenerReserva", argumentos: { reservaId: id }, ejecutar: () => club.obtenerReserva(id) };
  }
  if (recurso === "reservas" && id && accion === "cancelar" && metodo === "POST") {
    const cuerpo = await leerCuerpo(req);
    return { nombre: "cancelarReserva", argumentos: { reservaId: id, ...cuerpo }, ejecutar: () => club.cancelarReserva(id, cuerpo) };
  }
  throw new ErrorDelClub("RUTA_NO_ENCONTRADA", `No existe ${metodo} ${url.pathname}`, 404);
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://club.local");
  const responder = (http: number, datos: unknown) => {
    res.writeHead(http, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(datos));
  };
  const responderCsv = ({ fichero, csv }: ExportacionCsv) => {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fichero}"` });
    res.end(csv);
  };

  // Solo para pruebas: el estado completo y el reloj del club.
  if (url.pathname === "/_estado" && req.method === "GET") return responder(200, estado);
  if (url.pathname === "/_reloj" && req.method === "POST") {
    try {
      const { ahora } = await leerCuerpo(req);
      if (typeof ahora !== "string" || !FECHA_HORA.test(ahora)) {
        return responder(400, { error: { codigo: "DATOS_INVALIDOS", mensaje: "ahora debe tener el formato AAAA-MM-DDTHH:MM" } });
      }
      estado.ahora = ahora;
      return responder(200, { ahora });
    } catch {
      return responder(400, { error: { codigo: "DATOS_INVALIDOS", mensaje: "El cuerpo debe ser un objeto JSON" } });
    }
  }

  let operacion: Operacion | undefined;
  const anotar = (ok: boolean, codigo?: string) => {
    estado.registro.push({
      n: estado.registro.length + 1,
      operacion: operacion?.nombre ?? `${req.method} ${url.pathname}`,
      argumentos: operacion?.argumentos ?? {},
      ok,
      ...(codigo ? { codigo } : {}),
    });
  };
  try {
    const quien = identificar(req);
    operacion = await resolver(req, url, quien);
    const resultado = operacion.ejecutar();
    anotar(true);
    if (operacion.nombre === "exportarReservas") responderCsv(resultado as ExportacionCsv);
    else responder(operacion.nombre === "crearReserva" ? 201 : 200, resultado);
  } catch (error) {
    if (error instanceof ErrorDelClub) {
      anotar(false, error.codigo);
      responder(error.http, { error: { codigo: error.codigo, mensaje: error.message } });
    } else {
      anotar(false, "ERROR_INTERNO");
      console.error(error);
      responder(500, { error: { codigo: "ERROR_INTERNO", mensaje: "Error inesperado" } });
    }
  }
});

servidor.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const direccion = servidor.address();
  if (direccion && typeof direccion === "object") console.log(`PUERTO=${direccion.port}`);
});

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
