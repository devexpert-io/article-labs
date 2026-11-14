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

export type ConceptoFactura = "Reserva" | "Penalización";

export interface LineaFactura {
  reservaId: string;
  concepto: ConceptoFactura;
  /** Céntimos de euro, IVA incluido. */
  importe: number;
}

export interface Factura {
  /** `F<año>-<número de 4 cifras>`, correlativo dentro del año del mes facturado. */
  numero: string;
  /** El mes facturado, `AAAA-MM`. */
  mes: string;
  socioId: string;
  /** Una por reserva facturable del socio ese mes, ordenadas por el inicio de la reserva. */
  lineas: LineaFactura[];
  /** Céntimos: la suma de las líneas, IVA incluido. */
  total: number;
  /** Céntimos: `total / 1,21` redondeado al céntimo más cercano (medio céntimo hacia arriba). */
  base: number;
  /** Céntimos: `total - base`. */
  iva: number;
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
  /** Las facturas generadas, en el orden en que se generaron. */
  facturas: Factura[];
  /** Los meses (`AAAA-MM`) ya generados, también los que no tenían nada que facturar. */
  mesesFacturados: string[];
}
