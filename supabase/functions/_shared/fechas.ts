/**
 * Fechas y husos horarios.
 *
 * Los flujos n8n construían los rangos sumando 5 horas a mano
 * (`getTime() + 5 * 60 * 60 * 1000`) porque Colombia es UTC-5. Se replica ese
 * comportamiento aquí, en un solo sitio y con nombre, en lugar de repartirlo
 * por catorce expresiones dentro de URLs.
 *
 * Colombia no aplica horario de verano, así que el desfase es constante. Aun
 * así se deja configurable por si un cliente opera en otro huso.
 */

const DESFASE_HORAS = Number(Deno.env.get("ZONA_HORARIA_DESFASE") ?? "-5");
const DESFASE_MS = DESFASE_HORAS * 60 * 60 * 1000;

/** `2026-08-22` + `14:30` locales → instante UTC correspondiente. */
export function instanteLocal(fecha: string, hora?: string | null): Date {
  const [anio, mes, dia] = String(fecha).split("-").map(Number);
  if (!anio || !mes || !dia) throw new Error(`Fecha inválida: ${fecha}`);

  let horas = 0;
  let minutos = 0;
  if (hora) {
    const partes = String(hora).split(":");
    horas = Number(partes[0]) || 0;
    minutos = Number(partes[1]) || 0;
  }

  const comoUtc = Date.UTC(anio, mes - 1, dia, horas, minutos, 0, 0);
  return new Date(comoUtc - DESFASE_MS);
}

/** Inicio del día local, en UTC. */
export function inicioDelDia(fecha: string): Date {
  return instanteLocal(fecha, "00:00");
}

/** Fin del día local (23:59:59.999), en UTC. */
export function finDelDia(fecha: string): Date {
  const d = instanteLocal(fecha, "00:00");
  return new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Rango de un turno. Si la hora de fin es menor que la de inicio, el turno
 * cruza la medianoche y termina al día siguiente — caso real de los turnos
 * de noche, que en los flujos n8n se resolvía sumando 104400000 ms a mano.
 */
export function rangoTurno(
  fecha: string,
  horaInicio?: string | null,
  horaFin?: string | null,
): { desde: Date; hasta: Date } {
  const desde = horaInicio ? instanteLocal(fecha, horaInicio) : inicioDelDia(fecha);

  if (!horaFin) return { desde, hasta: finDelDia(fecha) };

  let hasta = instanteLocal(fecha, horaFin);
  if (hasta.getTime() <= desde.getTime()) {
    hasta = new Date(hasta.getTime() + 24 * 60 * 60 * 1000);
  }
  return { desde, hasta };
}

/** Rango de N días hacia atrás y M hacia adelante desde hoy (catálogos). */
export function rangoRelativo(diasAtras: number, diasAdelante: number): { desde: Date; hasta: Date } {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - diasAtras * 24 * 60 * 60 * 1000);
  const hasta = new Date(hoy.getTime() + diasAdelante * 24 * 60 * 60 * 1000);
  desde.setUTCHours(0, 0, 0, 0);
  hasta.setUTCHours(23, 59, 59, 999);
  return { desde, hasta };
}

export function iso(fecha: Date): string {
  return fecha.toISOString();
}

/** `YYYY-MM-DD` del día local actual. */
export function hoyLocal(): string {
  const ahora = new Date(Date.now() + DESFASE_MS);
  return ahora.toISOString().slice(0, 10);
}

/** Valida `YYYY-MM-DD`. */
export function esFechaValida(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}
