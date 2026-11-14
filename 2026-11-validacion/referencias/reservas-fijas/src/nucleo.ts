// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { finDeFranja, HORAS, precio } from "./semilla.ts";
import type { Estado, EstadoReserva, Pista, Reserva, SemanaSaltada, Serie, Socio } from "./tipos.ts";

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
export const LIMITE_MAXIMO = 100;
export const LIMITE_POR_DEFECTO = 50;
export const MAXIMO_RESERVAS_FUTURAS = 3;
export const HORAS_CANCELACION_GRATUITA = 24;
/** Una serie de reservas fijas dura de 2 a 12 semanas seguidas, contando la primera. */
export const SEMANAS_MINIMAS_SERIE = 2;
export const SEMANAS_MAXIMAS_SERIE = 12;
/** En las series de estas semanas o más, cada reserva lleva descuento. */
export const SEMANAS_CON_DESCUENTO = 8;
/** Porcentaje que se descuenta del precio normal en las series largas. */
export const DESCUENTO_SERIE = 10;

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

/** Solo los gestores pueden hacer `accion`: 401 si no se sabe quién llama y 403 si no es gestor. */
function exigirGestor(quien: Socio | undefined, accion: string): void {
  if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", `Para ${accion} hay que identificarse con la cabecera X-Socio`, 401);
  if (quien.rol !== "gestor") throw new ErrorDelClub("SIN_PERMISO", `Solo un gestor puede ${accion}`, 403);
}

/**
 * La misma hora local del club `dias` días después. Se suman días del calendario, no horas, así que el cambio de
 * hora no la mueve: del martes 23 de marzo de 2027 a las 19:30, siete días después es el martes 30 a las 19:30.
 */
function sumarDias(inicio: string, dias: number): string {
  const fecha = new Date(`${inicio.slice(0, 10)}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return `${fecha.toISOString().slice(0, 10)}${inicio.slice(10)}`;
}

/** El precio de una reserva de una serie: el normal o, en las series largas, un 10 % menos, redondeado al céntimo hacia abajo. */
function precioEnSerie(pista: Pista, inicio: string, semanas: number): number {
  const normal = precio(pista, inicio);
  return semanas >= SEMANAS_CON_DESCUENTO ? Math.floor((normal * (100 - DESCUENTO_SERIE)) / 100) : normal;
}

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function horasEntre(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}:00Z`) - Date.parse(`${desde}:00Z`)) / 3_600_000;
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
  const serie = (id: string) => {
    const encontrada = estado.series.find((s) => s.id === id);
    if (!encontrada) throw new ErrorDelClub("SERIE_NO_ENCONTRADA", `No existe la serie ${id}`, 404);
    return encontrada;
  };
  /** Las reservas de una serie, por orden de fecha. */
  const reservasDeLaSerie = (s: Serie) => s.reservas.map(reserva).sort((a, b) => a.inicio.localeCompare(b.inicio));

  /**
   * Las reglas de siempre para reservar `inicio`, salvo la disponibilidad y el límite de reservas futuras: el socio y
   * la pista existen, la franja es válida, el socio tiene la cuota al día, la pista no está cerrada y la franja no ha empezado.
   */
  const comprobarReglas = (socioId: string, pistaId: string, inicio: string) => {
    const socio = estado.socios.find((s) => s.id === socioId);
    if (!socio) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
    const p = pista(pistaId);
    if (!FECHA_HORA.test(inicio) || !HORAS.includes(inicio.slice(11))) {
      throw new ErrorDelClub("FRANJA_INVALIDA", `inicio debe ser AAAA-MM-DDTHH:MM y empezar a una de estas horas: ${HORAS.join(", ")}`, 400);
    }
    if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
    if (p.estado === "cerrada") throw new ErrorDelClub("PISTA_CERRADA", `${p.nombre} está cerrada`);
    if (inicio <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "Esa franja ya ha empezado o ha pasado");
    return { socio, pista: p };
  };

  const anadirReserva = (datos: { socio: Socio; pista: Pista; inicio: string; importe: number; notas: string; serieId?: string }) => {
    estado.contador += 1;
    const nueva: Reserva = {
      id: `R-${String(estado.contador).padStart(4, "0")}`,
      socioId: datos.socio.id,
      pistaId: datos.pista.id,
      inicio: datos.inicio,
      fin: finDeFranja(datos.inicio),
      estado: "confirmada",
      importe: datos.importe,
      notas: datos.notas,
      ...(datos.serieId ? { serieId: datos.serieId } : {}),
    };
    estado.reservas.push(nueva);
    return nueva;
  };

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
      const { socio, pista: p } = comprobarReglas(socioId as string, pistaId as string, inicio as string);
      if (ocupada(p.id, inicio as string)) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "Esa franja ya está reservada");
      // El límite solo cuenta las reservas normales: las de las series de reservas fijas quedan fuera.
      const futuras = estado.reservas.filter((r) =>
        r.socioId === socio.id && r.estado === "confirmada" && r.inicio > estado.ahora && r.serieId === undefined);
      if (futuras.length >= MAXIMO_RESERVAS_FUTURAS) {
        throw new ErrorDelClub("LIMITE_DE_RESERVAS", `${socio.nombre} ya tiene ${MAXIMO_RESERVAS_FUTURAS} reservas futuras`);
      }
      const nueva = anadirReserva({ socio, pista: p, inicio: inicio as string, importe: precio(p, inicio as string), notas: (datos.notas as string | undefined) ?? "" });
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
     * Crea una serie de reservas fijas: una reserva cada 7 días, en la misma pista y a la misma hora local, durante
     * `semanas` semanas contando la primera. Las semanas con la franja ocupada se saltan. Las reservas de la serie no
     * cuentan para el límite de reservas futuras y, en las series de 8 semanas o más, llevan un 10 % de descuento.
     * Solo para gestores (`quien` es el socio de la cabecera X-Socio).
     */
    crearSerie(datos: { socioId?: unknown; pistaId?: unknown; inicio?: unknown; semanas?: unknown }, quien: Socio | undefined) {
      exigirGestor(quien, "crear series de reservas fijas");
      const { socioId, pistaId, inicio, semanas } = datos;
      if (typeof socioId !== "string" || typeof pistaId !== "string" || typeof inicio !== "string") {
        invalido("socioId, pistaId, inicio y semanas son obligatorios");
      }
      if (typeof semanas !== "number" || !Number.isInteger(semanas) || semanas < SEMANAS_MINIMAS_SERIE || semanas > SEMANAS_MAXIMAS_SERIE) {
        invalido(`semanas debe ser un número entero entre ${SEMANAS_MINIMAS_SERIE} y ${SEMANAS_MAXIMAS_SERIE}`);
      }
      // La cuota, la pista y la franja se comprueban una vez para toda la serie: si fallan, no se crea nada.
      const { socio, pista: p } = comprobarReglas(socioId as string, pistaId as string, inicio as string);
      const libres: string[] = [];
      const saltadas: SemanaSaltada[] = [];
      for (let semana = 0; semana < (semanas as number); semana++) {
        const inicioSemana = sumarDias(inicio as string, 7 * semana);
        if (ocupada(p.id, inicioSemana)) saltadas.push({ inicio: inicioSemana, codigo: "FRANJA_NO_DISPONIBLE" });
        else libres.push(inicioSemana);
      }
      if (libres.length === 0) {
        throw new ErrorDelClub("SERIE_VACIA", "La franja está reservada todas las semanas de la serie: no se ha creado nada");
      }
      const id = `S-${String(estado.series.length + 1).padStart(4, "0")}`;
      const reservas = libres.map((inicioSemana) =>
        anadirReserva({ socio, pista: p, inicio: inicioSemana, importe: precioEnSerie(p, inicioSemana, semanas as number), notas: "", serieId: id }).id);
      const nueva: Serie = { id, socioId: socio.id, pistaId: p.id, inicio: inicio as string, semanas: semanas as number, reservas, saltadas };
      estado.series.push(nueva);
      return { serie: nueva };
    },

    /** Una serie con sus reservas completas, por orden de fecha. Solo para gestores. */
    obtenerSerie(id: string, quien: Socio | undefined) {
      exigirGestor(quien, "consultar series de reservas fijas");
      const s = serie(id);
      return { serie: { ...s, reservas: reservasDeLaSerie(s) } };
    },

    /**
     * Cancela una serie: sin penalización, las reservas confirmadas a las que les faltan 24 horas o más (`canceladas`).
     * Las que empiezan en menos de 24 horas siguen confirmadas (`pendientes`), salvo con `forzar: true`, que las cancela
     * con la penalización de siempre, el 100 % del importe. Las que ya han empezado, las canceladas y las no presentadas
     * no se tocan. Solo para gestores.
     */
    cancelarSerie(id: string, datos: { forzar?: unknown }, quien: Socio | undefined) {
      exigirGestor(quien, "cancelar series de reservas fijas");
      const s = serie(id);
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      const canceladas: Reserva[] = [];
      const pendientes: Reserva[] = [];
      for (const r of reservasDeLaSerie(s)) {
        if (r.estado !== "confirmada" || r.inicio <= estado.ahora) continue;
        if (horasEntre(estado.ahora, r.inicio) >= HORAS_CANCELACION_GRATUITA) {
          r.estado = "cancelada";
          canceladas.push(r);
        } else if (datos.forzar === true) {
          r.estado = "cancelada";
          r.penalizacion = r.importe;
          canceladas.push(r);
        } else {
          pendientes.push(r);
        }
      }
      return { serie: s, canceladas, pendientes };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
