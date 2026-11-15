// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { finDeFranja, HORAS, precio } from "./semilla.ts";
import type { Estado, EstadoReserva, Partido, Pista, Reserva, Socio } from "./tipos.ts";

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
/** Los partidos abiertos son siempre de 4 jugadores. */
export const JUGADORES_POR_PARTIDO = 4;
/** Un partido que no está completo cuando faltan estas horas o menos para empezar se cancela solo. */
export const HORAS_PARA_COMPLETAR = 6;
/** El nivel de juego de un socio va de 1 a 7, en pasos de 0,5. */
export const NIVEL_MINIMO = 1;
export const NIVEL_MAXIMO = 7;

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

/** Las operaciones que exigen saber quién llama: sin cabecera X-Socio, 401. */
function identificado(quien: Socio | undefined, accion: string): Socio {
  if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", `Para ${accion} hay que identificarse con la cabecera X-Socio`, 401);
  return quien;
}

/** Un nivel de juego válido: un número de 1 a 7 en pasos de 0,5 (3 o 4,5, por ejemplo). */
function esNivel(nivel: unknown): nivel is number {
  return typeof nivel === "number" && nivel >= NIVEL_MINIMO && nivel <= NIVEL_MAXIMO && Number.isInteger(nivel * 2);
}

/** Una fecha AAAA-MM-DD que existe en el calendario. */
function esFecha(texto: string): boolean {
  if (!FECHA.test(texto)) return false;
  const ms = Date.parse(`${texto}T12:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === texto;
}

/** Lo que le toca pagar a cada jugador de un partido: la cuarta parte del importe, redondeada al céntimo hacia arriba. */
export function importePorJugador(importe: number): number {
  return Math.ceil(importe / JUGADORES_POR_PARTIDO);
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

export interface FiltrosPartidos {
  fecha?: string;
  nivel?: string;
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
  const partido = (id: string) => {
    const encontrado = estado.partidos.find((p) => p.id === id);
    if (!encontrado) throw new ErrorDelClub("PARTIDO_NO_ENCONTRADO", `No existe el partido ${id}`, 404);
    return encontrado;
  };
  const ocupada = (pistaId: string, inicio: string) =>
    estado.reservas.some((r) => r.pistaId === pistaId && r.inicio === inicio && r.estado === "confirmada");

  /**
   * Lo que cuenta para el límite de 3 reservas futuras de un socio: sus reservas confirmadas que no han empezado
   * (también las de los partidos que organiza) y los partidos abiertos o completos que no han empezado en los que
   * juega sin ser el organizador.
   */
  const reservasFuturas = (socioId: string) =>
    estado.reservas.filter((r) => r.socioId === socioId && r.estado === "confirmada" && r.inicio > estado.ahora).length +
    estado.partidos.filter((p) =>
      p.estado !== "cancelado" && p.inicio > estado.ahora && p.organizador !== socioId && p.jugadores.includes(socioId)).length;

  const comprobarLimite = (socio: Socio) => {
    if (reservasFuturas(socio.id) >= MAXIMO_RESERVAS_FUTURAS) {
      throw new ErrorDelClub("LIMITE_DE_RESERVAS", `${socio.nombre} ya tiene ${MAXIMO_RESERVAS_FUTURAS} reservas futuras`);
    }
  };

  /**
   * Las comprobaciones de siempre para reservar una franja, en el orden de siempre: la pista existe, la franja es
   * válida, el socio tiene la cuota al día, la pista no está cerrada y la franja no ha empezado.
   */
  const comprobarFranja = (socio: Socio, pistaId: string, inicio: string): Pista => {
    const p = pista(pistaId);
    if (!FECHA_HORA.test(inicio) || !HORAS.includes(inicio.slice(11))) {
      throw new ErrorDelClub("FRANJA_INVALIDA", `inicio debe ser AAAA-MM-DDTHH:MM y empezar a una de estas horas: ${HORAS.join(", ")}`, 400);
    }
    if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
    if (p.estado === "cerrada") throw new ErrorDelClub("PISTA_CERRADA", `${p.nombre} está cerrada`);
    if (inicio <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "Esa franja ya ha empezado o ha pasado");
    return p;
  };

  const nuevaReserva = (socioId: string, p: Pista, inicio: string, notas: string, partidoId?: string): Reserva => {
    estado.contador += 1;
    const nueva: Reserva = {
      id: `R-${String(estado.contador).padStart(4, "0")}`,
      socioId,
      pistaId: p.id,
      inicio,
      fin: finDeFranja(inicio),
      estado: "confirmada",
      importe: precio(p, inicio),
      notas,
      ...(partidoId ? { partidoId } : {}),
    };
    estado.reservas.push(nueva);
    return nueva;
  };

  /** En un partido con rango, el socio tiene que tener nivel y estar dentro del rango, con los extremos incluidos. */
  const comprobarNivel = (socio: Socio, nivelMin: number, nivelMax: number) => {
    if (socio.nivel === null) {
      throw new ErrorDelClub("NIVEL_SIN_DEFINIR", `${socio.nombre} no tiene nivel de juego y el partido es de nivel ${nivelMin} a ${nivelMax}`);
    }
    if (socio.nivel < nivelMin || socio.nivel > nivelMax) {
      throw new ErrorDelClub("NIVEL_FUERA_DE_RANGO", `${socio.nombre} tiene nivel ${socio.nivel} y el partido es de nivel ${nivelMin} a ${nivelMax}`);
    }
  };

  /**
   * Un partido que no está completo cuando faltan 6 horas o menos para empezar se cancela solo, sin penalización para
   * nadie: queda cancelado con motivo "incompleto" y su reserva, cancelada, así que la franja queda libre.
   */
  const cancelarSiNoSeHaLlenado = (p: Partido) => {
    if (p.estado !== "abierto" || horasEntre(estado.ahora, p.inicio) > HORAS_PARA_COMPLETAR) return;
    p.estado = "cancelado";
    p.motivo = "incompleto";
    reserva(p.reservaId).estado = "cancelada";
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

    /** Fija el nivel de juego de un socio o lo quita con null. Puede hacerlo el propio socio o un gestor. */
    fijarNivel(socioId: string, datos: { nivel?: unknown }, quien: Socio | undefined) {
      const yo = identificado(quien, "fijar el nivel de un socio");
      const socio = estado.socios.find((s) => s.id === socioId);
      if (!socio) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
      if (yo.id !== socio.id && yo.rol !== "gestor") {
        throw new ErrorDelClub("SIN_PERMISO", "Solo el propio socio o un gestor pueden fijar el nivel de un socio", 403);
      }
      if (datos.nivel !== null && !esNivel(datos.nivel)) {
        invalido(`nivel debe ser un número de ${NIVEL_MINIMO} a ${NIVEL_MAXIMO} en pasos de 0,5, o null para quitarlo`);
      }
      socio.nivel = datos.nivel as number | null;
      return { socio };
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
      const p = comprobarFranja(socio, pistaId as string, inicio as string);
      if (ocupada(p.id, inicio as string)) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "Esa franja ya está reservada");
      // El límite cuenta también los partidos en los que juega sin organizarlos.
      comprobarLimite(socio);
      return { reserva: nuevaReserva(socio.id, p, inicio as string, (datos.notas as string | undefined) ?? "") };
    },

    cancelarReserva(id: string, datos: { forzar?: unknown; motivo?: unknown }) {
      const r = reserva(id);
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      if (r.partidoId !== undefined) {
        throw new ErrorDelClub("ES_UN_PARTIDO", `La reserva ${r.id} es la del partido ${r.partidoId}: se cancela con el partido`);
      }
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
     * Crea un partido abierto organizado por `quien`: reserva la pista a su nombre con las reglas de siempre y deja
     * las otras 3 plazas libres, si se pide, solo para un rango de nivel. Solo si faltan más de 6 horas para la franja.
     */
    crearPartido(datos: { pistaId?: unknown; inicio?: unknown; nivelMin?: unknown; nivelMax?: unknown }, quien: Socio | undefined) {
      const organizador = identificado(quien, "crear un partido");
      const { pistaId, inicio } = datos;
      if (typeof pistaId !== "string" || typeof inicio !== "string") invalido("pistaId e inicio son obligatorios");
      // nivelMin y nivelMax van los dos o ninguno. Sin rango, también se pueden mandar los dos a null.
      const nivelMin = datos.nivelMin ?? null;
      const nivelMax = datos.nivelMax ?? null;
      if ((nivelMin === null) !== (nivelMax === null)) invalido("nivelMin y nivelMax van los dos o ninguno");
      if (nivelMin !== null && (!esNivel(nivelMin) || !esNivel(nivelMax) || nivelMin > nivelMax)) {
        invalido(`nivelMin y nivelMax deben ser niveles de ${NIVEL_MINIMO} a ${NIVEL_MAXIMO} en pasos de 0,5, con nivelMin menor o igual que nivelMax`);
      }
      const p = comprobarFranja(organizador, pistaId as string, inicio as string);
      if (horasEntre(estado.ahora, inicio as string) <= HORAS_PARA_COMPLETAR) {
        throw new ErrorDelClub("DEMASIADO_TARDE", `Un partido solo se puede crear si faltan más de ${HORAS_PARA_COMPLETAR} horas para su franja`);
      }
      if (ocupada(p.id, inicio as string)) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "Esa franja ya está reservada");
      comprobarLimite(organizador);
      if (nivelMin !== null) comprobarNivel(organizador, nivelMin as number, nivelMax as number);
      const id = `P-${String(estado.partidos.length + 1).padStart(4, "0")}`;
      const r = nuevaReserva(organizador.id, p, inicio as string, "", id);
      const nuevo: Partido = {
        id,
        reservaId: r.id,
        pistaId: p.id,
        inicio: r.inicio,
        fin: r.fin,
        organizador: organizador.id,
        jugadores: [organizador.id],
        plazasLibres: JUGADORES_POR_PARTIDO - 1,
        nivelMin: nivelMin as number | null,
        nivelMax: nivelMax as number | null,
        estado: "abierto",
        importe: r.importe,
        importePorJugador: importePorJugador(r.importe),
        penalizaciones: [],
      };
      estado.partidos.push(nuevo);
      return { partido: nuevo };
    },

    /** Los partidos abiertos que no han empezado, por orden de inicio, de un día y para un nivel si se pide. */
    listarPartidos(filtros: FiltrosPartidos) {
      const { fecha } = filtros;
      if (fecha !== undefined && !esFecha(fecha)) invalido("fecha debe ser una fecha con el formato AAAA-MM-DD");
      const nivel = filtros.nivel === undefined ? undefined : /^\d+(\.\d+)?$/.test(filtros.nivel) ? Number(filtros.nivel) : NaN;
      if (nivel !== undefined && !esNivel(nivel)) invalido(`nivel debe ser un número de ${NIVEL_MINIMO} a ${NIVEL_MAXIMO} en pasos de 0,5`);
      const partidos = estado.partidos
        .filter((p) => p.estado === "abierto" && p.inicio > estado.ahora)
        .filter((p) => fecha === undefined || p.inicio.slice(0, 10) === fecha)
        .filter((p) => nivel === undefined || p.nivelMin === null || p.nivelMax === null || (p.nivelMin <= nivel && nivel <= p.nivelMax))
        .sort((a, b) => a.inicio.localeCompare(b.inicio));
      return { partidos };
    },

    obtenerPartido(id: string) {
      return { partido: partido(id) };
    },

    /** `quien` se une al partido. Con el cuarto jugador, el partido queda completo. */
    unirseAPartido(id: string, quien: Socio | undefined) {
      const socio = identificado(quien, "unirse a un partido");
      const pa = partido(id);
      if (pa.estado === "cancelado") throw new ErrorDelClub("PARTIDO_CANCELADO", `El partido ${pa.id} está cancelado`);
      if (pa.estado === "completo") throw new ErrorDelClub("PARTIDO_COMPLETO", `El partido ${pa.id} ya tiene ${JUGADORES_POR_PARTIDO} jugadores`);
      if (pa.jugadores.includes(socio.id)) throw new ErrorDelClub("YA_APUNTADO", `${socio.nombre} ya juega en el partido ${pa.id}`);
      if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
      if (pa.nivelMin !== null && pa.nivelMax !== null) comprobarNivel(socio, pa.nivelMin, pa.nivelMax);
      comprobarLimite(socio);
      pa.jugadores.push(socio.id);
      pa.plazasLibres -= 1;
      if (pa.plazasLibres === 0) pa.estado = "completo";
      return { partido: pa };
    },

    /**
     * `quien` sale del partido y deja libre su plaza. Con menos de 24 horas, solo con `forzar: true`, y paga su parte.
     * El organizador no puede salir: para dejarlo, lo cancela.
     */
    salirDePartido(id: string, datos: { forzar?: unknown }, quien: Socio | undefined) {
      const socio = identificado(quien, "salir de un partido");
      const pa = partido(id);
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      if (pa.estado === "cancelado") throw new ErrorDelClub("PARTIDO_CANCELADO", `El partido ${pa.id} está cancelado`);
      if (pa.inicio <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "El partido ya ha empezado o ha pasado");
      if (socio.id === pa.organizador) {
        throw new ErrorDelClub("ORGANIZADOR_NO_PUEDE_SALIR", `${socio.nombre} organiza el partido ${pa.id}: para dejarlo, tiene que cancelarlo`);
      }
      if (!pa.jugadores.includes(socio.id)) throw new ErrorDelClub("NO_APUNTADO", `${socio.nombre} no juega en el partido ${pa.id}`);
      const horas = horasEntre(estado.ahora, pa.inicio);
      if (horas < HORAS_CANCELACION_GRATUITA) {
        if (datos.forzar !== true) {
          throw new ErrorDelClub(
            "FUERA_DE_PLAZO",
            `Faltan ${Math.floor(horas)} horas para el partido y salir gratis solo se puede hasta ${HORAS_CANCELACION_GRATUITA} horas antes. ` +
            `Con forzar sale y paga su parte (${pa.importePorJugador} céntimos): solo si el socio la ha aceptado expresamente.`,
          );
        }
        pa.penalizaciones.push({ socioId: socio.id, importe: pa.importePorJugador });
      }
      pa.jugadores.splice(pa.jugadores.indexOf(socio.id), 1);
      pa.plazasLibres += 1;
      pa.estado = "abierto";
      // Si ya faltan 6 horas o menos, el partido ha dejado de estar completo a tiempo y se cancela solo.
      cancelarSiNoSeHaLlenado(pa);
      return { partido: pa };
    },

    /**
     * Cancela un partido y su reserva, así que la franja queda libre. Puede hacerlo quien lo organiza o un gestor. Con
     * menos de 24 horas, solo con `forzar: true`, y la reserva lleva la penalización de siempre, el 100 % del importe.
     */
    cancelarPartido(id: string, datos: { forzar?: unknown }, quien: Socio | undefined) {
      const yo = identificado(quien, "cancelar un partido");
      const pa = partido(id);
      if (yo.id !== pa.organizador && yo.rol !== "gestor") {
        throw new ErrorDelClub("SIN_PERMISO", "Solo quien organiza el partido o un gestor pueden cancelarlo", 403);
      }
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      if (pa.estado === "cancelado") throw new ErrorDelClub("PARTIDO_CANCELADO", `El partido ${pa.id} ya estaba cancelado`);
      if (pa.inicio <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "El partido ya ha empezado o ha pasado");
      const r = reserva(pa.reservaId);
      const horas = horasEntre(estado.ahora, pa.inicio);
      if (horas < HORAS_CANCELACION_GRATUITA) {
        if (datos.forzar !== true) {
          throw new ErrorDelClub(
            "FUERA_DE_PLAZO",
            `Faltan ${Math.floor(horas)} horas para el partido y la cancelación gratuita termina ${HORAS_CANCELACION_GRATUITA} horas antes. ` +
            "Con forzar se cancela con una penalización del 100 % del importe de la reserva: solo si se ha aceptado expresamente.",
          );
        }
        r.penalizacion = r.importe;
      }
      r.estado = "cancelada";
      pa.estado = "cancelado";
      pa.motivo = "organizador";
      return { partido: pa };
    },

    /** Cancela los partidos que no están completos cuando faltan 6 horas o menos. Se llama al mover la hora del club. */
    cancelarPartidosIncompletos() {
      estado.partidos.forEach(cancelarSiNoSeHaLlenado);
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
