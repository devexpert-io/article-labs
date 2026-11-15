export interface Pista {
  id: string;
  nombre: string;
  tipo: "cristal" | "muro";
  cubierta: boolean;
  estado: "operativa" | "cerrada";
  /** Céntimos de euro por franja. */
  precioValle: number;
  precioPunta: number;
}

export interface Socio {
  id: string;
  nombre: string;
  email: string;
  cuotaActiva: boolean;
  rol: "socio" | "gestor";
}

export type EstadoReserva = "confirmada" | "cancelada" | "no_presentada";

export interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  fin: string;
  estado: EstadoReserva;
  /** Céntimos de euro. */
  importe: number;
  notas: string;
  /** Céntimos cobrados al cancelar fuera de plazo. */
  penalizacion?: number;
  motivoCancelacion?: string;
}

export type EstadoTorneo = "inscripcion" | "en_juego" | "terminado" | "cancelado";

/** Una pareja apuntada a un torneo. */
export interface Inscripcion {
  id: string;
  /** Los ids de los dos socios de la pareja. */
  socios: [string, string];
  estado: "inscrita" | "baja";
  /** La cuota del torneo, en céntimos. Solo se anota: no se cobra. */
  importe: number;
}

/** Un partido del cuadro de un torneo. */
export interface Partido {
  id: string;
  /** La primera ronda es la 1. */
  ronda: number;
  /** Su orden dentro de la ronda, desde 1. */
  numero: number;
  /** Los ids de las dos inscripciones que lo juegan, con null mientras no se sepa cuál es. */
  parejas: [string | null, string | null];
  estado: "pendiente" | "jugado" | "descanso";
  /** El id de la inscripción que gana. En los descansos, la pareja que pasa sin jugar. */
  ganadora: string | null;
  marcador: string | null;
  /** La pista y el inicio de la franja en que se juega. Los descansos no tienen. */
  pistaId: string | null;
  inicio: string | null;
}

/** Un torneo de parejas por eliminación directa. */
export interface Torneo {
  id: string;
  nombre: string;
  /** Los ids de las pistas que usa, en el orden en que se dieron. */
  pistas: string[];
  /** Los inicios de las franjas que usa en todas sus pistas, en orden cronológico. */
  franjas: string[];
  /** Número máximo de parejas. */
  plazas: number;
  /** Lo que paga cada pareja, en céntimos. */
  cuota: number;
  estado: EstadoTorneo;
  /** Por orden de inscripción. */
  inscripciones: Inscripcion[];
  /** Por ronda y, dentro de cada ronda, por número. Se crean todos al cerrar la inscripción. */
  partidos: Partido[];
  /** El id de la inscripción que gana el torneo, o null. */
  campeona: string | null;
}

export interface EntradaRegistro {
  n: number;
  operacion: string;
  argumentos: unknown;
  ok: boolean;
  codigo?: string;
}

export interface Estado {
  ahora: string;
  pistas: Pista[];
  socios: Socio[];
  reservas: Reserva[];
  torneos: Torneo[];
  registro: EntradaRegistro[];
  contador: number;
}
