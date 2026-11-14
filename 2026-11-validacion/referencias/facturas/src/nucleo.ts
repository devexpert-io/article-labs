// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { finDeFranja, HORAS, precio } from "./semilla.ts";
import type { Estado, EstadoReserva, Factura, LineaFactura, Reserva, Socio } from "./tipos.ts";

export class ErrorDelClub extends Error {
  codigo: string;
  http: number;
  constructor(codigo: string, mensaje: string, http = 409) {
    super(mensaje);
    this.codigo = codigo;
    this.http = http;
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const LIMITE_MAXIMO = 100;
export const LIMITE_POR_DEFECTO = 50;
export const MAXIMO_RESERVAS_FUTURAS = 3;
export const HORAS_CANCELACION_GRATUITA = 24;
/** El IVA (en %) que llevan incluido todos los importes del club. */
export const IVA = 21;

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function horasEntre(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}:00Z`) - Date.parse(`${desde}:00Z`)) / 3_600_000;
}

/** Solo los gestores pueden hacer `accion`: 401 si no se sabe quién llama y 403 si no es gestor. */
function exigirGestor(quien: Socio | undefined, accion: string): void {
  if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", `Para ${accion} hay que identificarse con la cabecera X-Socio`, 401);
  if (quien.rol !== "gestor") throw new ErrorDelClub("SIN_PERMISO", `Solo un gestor puede ${accion}`, 403);
}

function validarMes(mes: unknown): string {
  if (typeof mes !== "string" || !MES.test(mes)) invalido("mes es obligatorio, con el formato AAAA-MM");
  return mes;
}

/** `a / b` redondeado al entero más cercano, con medio hacia arriba, para enteros `a >= 0` y `b > 0`. Sin coma flotante. */
function dividirRedondeando(a: number, b: number): number {
  const n = 2 * a + b;
  return (n - (n % (2 * b))) / (2 * b);
}

/** La base imponible de un total con el IVA incluido: `total / 1,21` redondeado al céntimo más cercano (medio céntimo hacia arriba). */
export function baseImponible(total: number): number {
  return dividirRedondeando(total * 100, 100 + IVA);
}

/** Lo que se factura de una reserva: confirmadas y no presentadas por su importe, canceladas por su penalización. */
function lineaDe(r: Reserva): LineaFactura | undefined {
  if (r.estado === "confirmada" || r.estado === "no_presentada") return { reservaId: r.id, concepto: "Reserva", importe: r.importe };
  if (r.estado === "cancelada" && (r.penalizacion ?? 0) > 0) return { reservaId: r.id, concepto: "Penalización", importe: r.penalizacion! };
  return undefined;
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface FiltrosReservas {
  fecha?: string;
  desde?: string;
  hasta?: string;
  socioId?: string;
  pistaId?: string;
  estado?: string;
  limite?: number;
  pagina?: number;
}

export function crearClub(estado: Estado) {
  const pista = (id: string) => {
    const encontrada = estado.pistas.find((p) => p.id === id);
    if (!encontrada) throw new ErrorDelClub("PISTA_NO_ENCONTRADA", `No existe la pista ${id}`, 404);
    return encontrada;
  };
  const reserva = (id: string) => {
    const encontrada = estado.reservas.find((r) => r.id === id);
    if (!encontrada) throw new ErrorDelClub("RESERVA_NO_ENCONTRADA", `No existe la reserva ${id}`, 404);
    return encontrada;
  };
  const facturasDelMes = (mes: string) =>
    estado.facturas.filter((f) => f.mes === mes).sort((a, b) => compararTexto(a.socioId, b.socioId));
  const ocupada = (pistaId: string, inicio: string) =>
    estado.reservas.some((r) => r.pistaId === pistaId && r.inicio === inicio && r.estado === "confirmada");

  return {
    listarPistas() {
      return { pistas: estado.pistas };
    },

    cambiarEstadoPista(pistaId: string, nuevo: unknown) {
      if (nuevo !== "operativa" && nuevo !== "cerrada") invalido('estado debe ser "operativa" o "cerrada"');
      const p = pista(pistaId);
      p.estado = nuevo as "operativa" | "cerrada";
      return { pista: p };
    },

    disponibilidad(fecha: unknown, pistaId?: string) {
      if (typeof fecha !== "string" || !FECHA.test(fecha)) invalido("fecha es obligatoria, con el formato AAAA-MM-DD");
      const pistas = pistaId ? [pista(pistaId)] : estado.pistas;
      return {
        fecha,
        pistas: pistas.map((p) => ({
          pistaId: p.id,
          nombre: p.nombre,
          cubierta: p.cubierta,
          estado: p.estado,
          franjas: HORAS.map((hora) => {
            const inicio = `${fecha}T${hora}`;
            return {
              inicio,
              fin: finDeFranja(inicio),
              estado: p.estado === "cerrada" ? "cerrada" : ocupada(p.id, inicio) ? "reservada" : "libre",
              precio: precio(p, inicio),
            };
          }),
        })),
      };
    },

    buscarSocios(texto: unknown) {
      if (typeof texto !== "string" || texto.trim().length < 2) invalido("texto es obligatorio, con dos letras o más");
      const buscado = sinAcentos(texto.trim());
      const socios = estado.socios.filter((s) => sinAcentos(s.nombre).includes(buscado) || s.email.includes(buscado) || s.id === buscado);
      return { socios: socios.slice(0, 20) };
    },

    listarReservas(f: FiltrosReservas) {
      for (const campo of ["fecha", "desde", "hasta"] as const) {
        if (f[campo] !== undefined && !FECHA.test(f[campo]!)) invalido(`${campo} debe tener el formato AAAA-MM-DD`);
      }
      if (f.estado !== undefined && !["confirmada", "cancelada", "no_presentada"].includes(f.estado)) {
        invalido('estado debe ser "confirmada", "cancelada" o "no_presentada"');
      }
      const limite = f.limite ?? LIMITE_POR_DEFECTO;
      const pagina = f.pagina ?? 1;
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) invalido(`limite debe estar entre 1 y ${LIMITE_MAXIMO}`);
      if (!Number.isInteger(pagina) || pagina < 1) invalido("pagina debe ser 1 o más");
      const desde = f.fecha ?? f.desde;
      const hasta = f.fecha ?? f.hasta;
      const todas = estado.reservas.filter((r) =>
        (!desde || r.inicio.slice(0, 10) >= desde) &&
        (!hasta || r.inicio.slice(0, 10) <= hasta) &&
        (!f.socioId || r.socioId === f.socioId) &&
        (!f.pistaId || r.pistaId === f.pistaId) &&
        (!f.estado || r.estado === (f.estado as EstadoReserva)));
      const paginas = Math.max(1, Math.ceil(todas.length / limite));
      return { total: todas.length, pagina, paginas, reservas: todas.slice((pagina - 1) * limite, pagina * limite) };
    },

    obtenerReserva(id: string) {
      return { reserva: reserva(id) };
    },

    crearReserva(datos: { socioId?: unknown; pistaId?: unknown; inicio?: unknown; notas?: unknown }) {
      const { socioId, pistaId, inicio } = datos;
      if (typeof socioId !== "string" || typeof pistaId !== "string" || typeof inicio !== "string") {
        invalido("socioId, pistaId e inicio son obligatorios");
      }
      if (datos.notas !== undefined && typeof datos.notas !== "string") invalido("notas debe ser un texto");
      const socio = estado.socios.find((s) => s.id === socioId);
      if (!socio) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
      const p = pista(pistaId as string);
      if (!FECHA_HORA.test(inicio as string) || !HORAS.includes((inicio as string).slice(11))) {
        throw new ErrorDelClub("FRANJA_INVALIDA", `inicio debe ser AAAA-MM-DDTHH:MM y empezar a una de estas horas: ${HORAS.join(", ")}`, 400);
      }
      if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
      if (p.estado === "cerrada") throw new ErrorDelClub("PISTA_CERRADA", `${p.nombre} está cerrada`);
      if ((inicio as string) <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "Esa franja ya ha empezado o ha pasado");
      if (ocupada(p.id, inicio as string)) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "Esa franja ya está reservada");
      const futuras = estado.reservas.filter((r) => r.socioId === socio.id && r.estado === "confirmada" && r.inicio > estado.ahora);
      if (futuras.length >= MAXIMO_RESERVAS_FUTURAS) {
        throw new ErrorDelClub("LIMITE_DE_RESERVAS", `${socio.nombre} ya tiene ${MAXIMO_RESERVAS_FUTURAS} reservas futuras`);
      }
      estado.contador += 1;
      const nueva: Reserva = {
        id: `R-${String(estado.contador).padStart(4, "0")}`,
        socioId: socio.id,
        pistaId: p.id,
        inicio: inicio as string,
        fin: finDeFranja(inicio as string),
        estado: "confirmada",
        importe: precio(p, inicio as string),
        notas: (datos.notas as string | undefined) ?? "",
      };
      estado.reservas.push(nueva);
      return { reserva: nueva };
    },

    cancelarReserva(id: string, datos: { forzar?: unknown; motivo?: unknown }) {
      const r = reserva(id);
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      if (r.estado === "cancelada") throw new ErrorDelClub("YA_CANCELADA", "La reserva ya estaba cancelada");
      if (r.inicio <= estado.ahora) throw new ErrorDelClub("RESERVA_PASADA", "La reserva ya ha empezado o ha pasado");
      const horas = horasEntre(estado.ahora, r.inicio);
      if (horas < HORAS_CANCELACION_GRATUITA) {
        if (datos.forzar !== true) {
          throw new ErrorDelClub(
            "FUERA_DE_PLAZO",
            `Faltan ${Math.floor(horas)} horas para la reserva y la cancelación gratuita termina ${HORAS_CANCELACION_GRATUITA} horas antes. ` +
            "Con forzar se cancela con una penalización del 100 % del importe: solo si el socio ha aceptado expresamente la penalización.",
          );
        }
        r.penalizacion = r.importe;
      }
      r.estado = "cancelada";
      if (typeof datos.motivo === "string") r.motivoCancelacion = datos.motivo;
      return { reserva: r };
    },

    /**
     * Genera las facturas de un mes cerrado: una por socio con algo que facturar, ordenadas por socio y numeradas
     * a continuación de la última factura del año del mes. Si el mes ya estaba generado, devuelve las mismas
     * (`nuevas: false`) sin crear ninguna. Solo para gestores.
     */
    generarFacturas(mes: unknown, quien: Socio | undefined): { nuevas: boolean; facturas: Factura[] } {
      exigirGestor(quien, "generar facturas");
      const m = validarMes(mes);
      if (m >= estado.ahora.slice(0, 7)) {
        throw new ErrorDelClub("MES_ABIERTO", `${m} todavía no ha terminado: solo se factura un mes cerrado`);
      }
      if (estado.mesesFacturados.includes(m)) return { nuevas: false, facturas: facturasDelMes(m) };

      const porSocio = new Map<string, Reserva[]>();
      for (const r of estado.reservas) {
        if (r.inicio.slice(0, 7) !== m || !lineaDe(r)) continue;
        porSocio.set(r.socioId, [...(porSocio.get(r.socioId) ?? []), r]);
      }
      const año = m.slice(0, 4);
      // Los números son correlativos y sin huecos dentro del año, así que el último es cuántas hay ya de ese año.
      let numero = estado.facturas.filter((f) => f.mes.slice(0, 4) === año).length;
      const nuevas = [...porSocio.keys()].sort(compararTexto).map((socioId): Factura => {
        const lineas = porSocio.get(socioId)!
          .sort((a, b) => compararTexto(a.inicio, b.inicio) || compararTexto(a.id, b.id))
          .map((r) => lineaDe(r)!);
        const total = lineas.reduce((suma, l) => suma + l.importe, 0);
        const base = baseImponible(total);
        numero += 1;
        return { numero: `F${año}-${String(numero).padStart(4, "0")}`, mes: m, socioId, lineas, total, base, iva: total - base };
      });
      estado.facturas.push(...nuevas);
      estado.mesesFacturados.push(m);
      return { nuevas: true, facturas: nuevas };
    },

    /** Las facturas de un mes ya generado, ordenadas por socio. Si el mes no se ha generado, ninguna. Solo para gestores. */
    listarFacturas(mes: unknown, quien: Socio | undefined) {
      exigirGestor(quien, "consultar facturas");
      return { facturas: facturasDelMes(validarMes(mes)) };
    },

    /** Una factura por su número. Solo para gestores. */
    obtenerFactura(numero: string, quien: Socio | undefined) {
      exigirGestor(quien, "consultar facturas");
      const factura = estado.facturas.find((f) => f.numero === numero);
      if (!factura) throw new ErrorDelClub("FACTURA_NO_ENCONTRADA", `No existe la factura ${numero}`, 404);
      return { factura };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
