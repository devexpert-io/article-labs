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

export type CodigoDescuento = "BIENVENIDA" | "MANANAS" | "CLUB10";

export interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  fin: string;
  estado: EstadoReserva;
  /** Céntimos de euro que paga el socio: importeBase - descuento. */
  importe: number;
  /** Céntimos de euro: el precio de la franja. Lo guardan las reservas creadas por la API, no las de la semilla. */
  importeBase?: number;
  /** Céntimos de euro que se descuentan con el código. Lo guardan las reservas creadas por la API, no las de la semilla. */
  descuento?: number;
  /** El código de descuento usado, en mayúsculas. Solo si se usó uno. */
  codigo?: CodigoDescuento;
  notas: string;
  /** Céntimos cobrados al cancelar fuera de plazo. */
  penalizacion?: number;
  motivoCancelacion?: string;
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
  registro: EntradaRegistro[];
  contador: number;
}
