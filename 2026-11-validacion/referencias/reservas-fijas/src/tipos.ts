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
  /** La serie de reservas fijas de la que sale la reserva. Las reservas normales no lo llevan. */
  serieId?: string;
}

/** Una semana de una serie que no se pudo reservar. */
export interface SemanaSaltada {
  inicio: string;
  codigo: string;
}

/** Una serie de reservas fijas: la misma pista a la misma hora local, una vez por semana. */
export interface Serie {
  id: string;
  socioId: string;
  pistaId: string;
  /** La primera semana de la serie. */
  inicio: string;
  /** Cuántas semanas seguidas, contando la primera. */
  semanas: number;
  /** Los ids de las reservas que se crearon, por orden de fecha. */
  reservas: string[];
  /** Las semanas que no se pudieron reservar. */
  saltadas: SemanaSaltada[];
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
  series: Serie[];
  registro: EntradaRegistro[];
  contador: number;
}
