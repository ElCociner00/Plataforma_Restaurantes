import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, errores, responderError } from "../_shared/errores.ts";
import { cabeceraAuth, resolverContexto } from "../_shared/tenant.ts";

const ETIQUETA = "nomina-consultar";

function horasADecimal(horaStr: string) {
  if (!horaStr || horaStr === "00:00") return 0;
  const [h, m] = horaStr.split(":").map(Number);
  return h + (m / 60);
}

function formatoHoras(horasDecimal: number) {
  const horas = Math.floor(horasDecimal);
  const minutos = Math.round((horasDecimal - horas) * 60);
  return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
}

function minutosAHoras(minutos: number) {
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  return `${horas.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Para la longitud de horas laboradas por turno
function calcularHoras(inicio: string, fin: string) {
  if (!inicio || !fin) return "00:00";
  // Convert 12h to 24h
  const parseTime = (t: string) => {
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return 0;
    let hr = parseInt(m[1], 10);
    if (m[3].toUpperCase() === 'PM' && hr !== 12) hr += 12;
    if (m[3].toUpperCase() === 'AM' && hr === 12) hr = 0;
    return hr + parseInt(m[2], 10) / 60;
  };
  let hi = parseTime(inicio);
  let hf = parseTime(fin);
  if (hf < hi) hf += 24;
  return formatoHoras(hf - hi);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();
    cabeceraAuth(req);

    const data = await req.json().catch(() => {
      throw errores.datosIncompletos("el cuerpo debe ser JSON válido");
    });

    const ctx = await resolverContexto(req, data.empresa_id || data.tenant_id);
    const admin = ctx.clienteAdmin();

    const empleadoId = data.empleado_id;
    const fechaInicio = data.fecha_inicio;
    const fechaFin = data.fecha_fin;
    const tenantIds = data.tenant_ids && data.tenant_ids.length > 0 ? data.tenant_ids : (data.empresa_id ? [data.empresa_id] : [ctx.empresaId]);
    
    // Obtener el ID principal del usuario, por si el que nos envían es un ID local
    const { data: userLocal } = await admin
      .from("usuarios_locales")
      .select("usuario_principal_id")
      .eq("id", empleadoId)
      .maybeSingle();
      
    const principalId = userLocal?.usuario_principal_id || empleadoId;

    // Buscar TODOS los posibles IDs que tiene este empleado en las sedes consultadas
    const { data: allLocals } = await admin
      .from("usuarios_locales")
      .select("id")
      .in("empresa_id", tenantIds)
      .eq("usuario_principal_id", principalId);
      
    const additionalLocalIds = (allLocals || []).map((u: any) => u.id);
    const responsablesLocales = Array.isArray(data.sedes) ? data.sedes.map((s: any) => s.responsable_id || s.usuario_id || s.empleado_id).filter(Boolean) : [];
    const responsableIds = Array.from(new Set([empleadoId, principalId, ...responsablesLocales, ...additionalLocalIds]));

    if (!empleadoId || !fechaInicio || !fechaFin) {
      throw errores.datosIncompletos("empleado_id, fecha_inicio, fecha_fin");
    }

    // 1. Parametros
    const { data: parametrosRows } = await admin
      .from("parametros_nomina")
      .select(`
        *,
        dimensiones_tiempo ( nombre ),
        dimensiones_concepto ( nombre )
      `)
      .eq("empresa_id", ctx.empresaId);

    const parametrosLista = (parametrosRows || []).map((row: any) => {
      const nombreConcepto = row.dimensiones_concepto?.nombre || "Desconocido";
      const nombreTiempo = row.dimensiones_tiempo?.nombre || "Desconocido";
      return {
        concepto: `${nombreConcepto} - ${nombreTiempo}`,
        nombre: `${nombreConcepto} - ${nombreTiempo}`,
        valor: row.valor_monetario,
        valorFormateado: new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(row.valor_monetario || 0)
      };
    });

    // 2. Detalle (Cierres de turno)
    const [turnosPrincipales, turnosLocales] = await Promise.all([
      admin
        .from("cierres_turno_final")
        .select("id, fecha_turno, hora_inicio, hora_fin, responsable_id, propina_global, empresa_id")
        .in("empresa_id", tenantIds)
        .in("responsable_id", responsableIds)
        .gte("fecha_turno", fechaInicio)
        .lte("fecha_turno", fechaFin),
      admin
        .from("cierres_turno_final_locales")
        .select("id, fecha_turno, hora_inicio, hora_fin, responsable_id, propina_global, empresa_id")
        .in("empresa_id", tenantIds)
        .in("responsable_id", responsableIds)
        .gte("fecha_turno", fechaInicio)
        .lte("fecha_turno", fechaFin)
    ]);

    const turnosRows = [...(turnosPrincipales.data || []), ...(turnosLocales.data || [])];

    // Dedup si quedaron duplicados por consultar ambas tablas (vista y tabla local)
    const turnosDedup = (turnosRows || []).reduce((acc: any, curr: any) => {
      // Incluir empresa_id en la clave para no deduplicar turnos simultáneos en diferentes sedes
      const key = `${curr.empresa_id}-${curr.fecha_turno}-${curr.hora_inicio}`;
      if (!acc[key]) acc[key] = curr;
      return acc;
    }, {});

    const detalleRows = [];
    let totalHorasDecimal = 0;

    for (const row of Object.values(turnosDedup) as any[]) {
      const horasTurno = calcularHoras(row.hora_inicio, row.hora_fin);
      const horasTotalesDecimal = horasADecimal(horasTurno);
      totalHorasDecimal += horasTotalesDecimal;
      
      const parts = row.fecha_turno.split("-");
      const dateObj = new Date(parts[0], parts[1]-1, parts[2]);
      const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

      detalleRows.push({
        responsable: row.responsable_id || "N/A",
        dia: days[dateObj.getDay()],
        fecha: row.fecha_turno,
        hora_inicio: row.hora_inicio,
        hora_fin: row.hora_fin,
        horas_totales: horasTurno,
        Horas: horasTurno,
        propina: row.propina_global || 0,
        empresa_id: row.empresa_id
      });
    }

    // 3. Propinas / Apoyos
    const [apoyosPrincipales, apoyosLocales] = await Promise.all([
      admin
        .from("apoyos_turno")
        .select("*")
        .in("empresa_id", tenantIds)
        .in("apoyo_responsable_id", responsableIds)
        .gte("fecha_turno", fechaInicio)
        .lte("fecha_turno", fechaFin),
      admin
        .from("apoyos_turno_locales")
        .select("*")
        .in("empresa_id", tenantIds)
        .in("apoyo_responsable_id", responsableIds)
        .gte("fecha_turno", fechaInicio)
        .lte("fecha_turno", fechaFin)
    ]);

    const apoyosData = [...(apoyosPrincipales.data || []), ...(apoyosLocales.data || [])];

    const propinasRows = [];
    let totalMinutosPropinas = 0;
    
    for (const row of (apoyosData || [])) {
      const minutos = Number(row.tiempo_minutos) || 0;
      totalMinutosPropinas += minutos;
      
      propinasRows.push({
        fecha_turno: row.fecha_turno,
        responsable_turno_id: row.responsable_turno_id,
        apoyo_responsable_id: row.apoyo_responsable_id,
        tiempo_minutos: minutos,
        tiempo_horas: row.tiempo_horas || minutosAHoras(minutos),
        tiempo_texto: row.tiempo_texto || `${Math.floor(minutos / 60)} horas ${minutos % 60} minutos`,
        hora_inicio: row.hora_inicio || row.rango_hora_inicio,
        hora_fin: row.hora_fin || row.rango_hora_fin,
        propina: row.propina || 0,
        sede: row.empresa_id
      });
    }
    const totalHorasPropinasDecimal = totalMinutosPropinas / 60;

    // Resumen
    const resumenTiempos = {
      total_horas_trabajadas: totalHorasDecimal,
      total_horas_trabajadas_formato: formatoHoras(totalHorasDecimal),
      total_horas_propinas: totalHorasPropinasDecimal,
      total_horas_propinas_formato: formatoHoras(totalHorasPropinasDecimal)
    };

    const totalesGenerales = {
      dias_trabajados: detalleRows.length,
      horas_trabajadas: totalHorasDecimal,
      horas_trabajadas_formato: formatoHoras(totalHorasDecimal),
      horas_propinas: totalHorasPropinasDecimal,
      horas_propinas_formato: formatoHoras(totalHorasPropinasDecimal),
      total_apoyos: propinasRows.length
    };

    console.info(`[${ETIQUETA}] Consulta completada empleado=${empleadoId} turnos=${detalleRows.length} apoyos=${propinasRows.length}`);

    // Compatible con parseExcelWebhookPayload
    return json({
      parametros: parametrosLista,
      detalle: detalleRows,
      apoyos: propinasRows,
      resumen_tiempos: resumenTiempos,
      totales: totalesGenerales,
      metadata: {
        total_filas_procesadas: detalleRows.length,
        total_apoyos_procesados: propinasRows.length,
        fecha_proceso: new Date().toISOString()
      }
    }, 200, origin);

  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});
