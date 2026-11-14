/// <reference lib="esnext.temporal" />
// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { finDeFranja, HORAS, precio } from "./semilla.ts";
import type { CifrasCaja, Estado, EstadoReserva, InformeCaja, Reserva, Socio } from "./tipos.ts";

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
export const ZONA_DEL_CLUB = "Europe/Madrid";

/** Política de cancelación: con esta antelación (o más) no hay penalización. */
export const HORAS_SIN_PENALIZACION = 48;
/** Con menos de esta antelación solo se cancela con `forzar: true`. */
export const HORAS_SIN_FORZAR = 24;
/** Porcentaje del importe que se cobra con 24 horas o más, y menos de 48. */
export const PENALIZACION_TARDIA = 25;
/** Porcentaje del importe que se cobra con menos de 24 horas. */
export const PENALIZACION_FORZADA = 50;
/** Caracteres mínimos del motivo para eximir de la penalización. */
export const MOTIVO_MINIMO_EXENCION = 10;

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** El instante real de una hora local del club, en milisegundos. */
function instante(local: string): number {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(ZONA_DEL_CLUB).epochMilliseconds;
}

/** Minutos reales entre dos horas locales del club, contando el cambio de hora. */
function minutosEntre(desde: string, hasta: string): number {
  return (instante(hasta) - instante(desde)) / 60_000;
}

/** Solo los gestores pueden hacer `accion`: 401 si no se sabe quién llama y 403 si no es gestor. */
function exigirGestor(quien: Socio | undefined, accion: string): void {
  if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", `Para ${accion} hay que identificarse con la cabecera X-Socio`, 401);
  if (quien.rol !== "gestor") throw new ErrorDelClub("SIN_PERMISO", `Solo un gestor puede ${accion}`, 403);
}

function cifrasVacias(): CifrasCaja {
  return { reservas: 0, ingresos: 0, penalizaciones: 0, total: 0 };
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

    /**
     * Cancela con la política escalonada: 48 horas o más de antelación, sin penalización; 24 horas o más, el 25 %;
     * menos de 24 horas, solo con `forzar` y el 50 %. Un gestor puede eximir de la penalización con un motivo.
     * `quien` es el socio de la cabecera X-Socio (solo hace falta para eximir).
     */
    cancelarReserva(id: string, datos: { forzar?: unknown; motivo?: unknown; exento?: unknown }, quien: Socio | undefined) {
      const r = reserva(id);
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      if (datos.exento !== undefined && typeof datos.exento !== "boolean") invalido("exento debe ser true o false");
      const exento = datos.exento === true;
      if (exento) {
        exigirGestor(quien, "eximir de la penalización");
        if (typeof datos.motivo !== "string" || [...datos.motivo.trim()].length < MOTIVO_MINIMO_EXENCION) {
          invalido(`Para eximir de la penalización hace falta un motivo de al menos ${MOTIVO_MINIMO_EXENCION} caracteres`);
        }
      }
      if (r.estado === "cancelada") throw new ErrorDelClub("YA_CANCELADA", "La reserva ya estaba cancelada");
      if (r.inicio <= estado.ahora) throw new ErrorDelClub("RESERVA_PASADA", "La reserva ya ha empezado o ha pasado");
      const minutos = minutosEntre(estado.ahora, r.inicio);
      let porcentaje = 0;
      if (!exento && minutos < HORAS_SIN_FORZAR * 60) {
        if (datos.forzar !== true) {
          throw new ErrorDelClub(
            "FUERA_DE_PLAZO",
            `Faltan ${Math.floor(minutos / 60)} horas para la reserva y sin forzar solo se cancela con ${HORAS_SIN_FORZAR} horas o más de antelación. ` +
            `Con forzar se cancela con una penalización del ${PENALIZACION_FORZADA} % del importe: solo si el socio ha aceptado expresamente la penalización.`,
          );
        }
        porcentaje = PENALIZACION_FORZADA;
      } else if (!exento && minutos < HORAS_SIN_PENALIZACION * 60) {
        porcentaje = PENALIZACION_TARDIA;
      }
      r.estado = "cancelada";
      if (porcentaje > 0) r.penalizacion = Math.round((r.importe * porcentaje) / 100);
      if (typeof datos.motivo === "string") r.motivoCancelacion = datos.motivo;
      return { reserva: r, reembolso: r.importe - (r.penalizacion ?? 0) };
    },

    /** Lo cobrado en un mes por pista, contando las reservas por su fecha de inicio. Solo para gestores. */
    informeCaja(mes: unknown, quien: Socio | undefined): InformeCaja {
      exigirGestor(quien, "consultar el informe de caja");
      if (typeof mes !== "string" || !MES.test(mes)) invalido("mes es obligatorio, con el formato AAAA-MM");
      const total = cifrasVacias();
      const pistas = [...estado.pistas]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((p) => {
          const fila = { pistaId: p.id, ...cifrasVacias() };
          for (const r of estado.reservas) {
            if (r.pistaId !== p.id || r.inicio.slice(0, 7) !== mes) continue;
            if (r.estado === "confirmada" || r.estado === "no_presentada") {
              fila.reservas += 1;
              fila.ingresos += r.importe;
            } else if (r.estado === "cancelada") {
              fila.penalizaciones += r.penalizacion ?? 0;
            }
          }
          fila.total = fila.ingresos + fila.penalizaciones;
          total.reservas += fila.reservas;
          total.ingresos += fila.ingresos;
          total.penalizaciones += fila.penalizaciones;
          total.total += fila.total;
          return fila;
        });
      return { mes, pistas, total };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
