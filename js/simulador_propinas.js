/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/simulador_propinas.js
 *
 * Partes del archivo:
 * 1) Imports y estado.
 * 2) Carga del turno (evidencia archivada -> Loggro -> aviso).
 * 3) Pintado: tabla hora/propina, personas con rangos editables.
 * 4) Simulación: recálculo local y comparación contra el reparto real.
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `cargarEventos`      (línea aprox. 120): de dónde salen las propinas.
 * - `cargarPersonas`     (línea aprox. 190): responsable y apoyos del turno.
 * - `pintarTablaPropinas`(línea aprox. 250): la tabla hora/propina.
 * - `pintarPersonas`     (línea aprox. 285): rangos editables.
 * - `recalcular`         (línea aprox. 350): el corazón de la demostración.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */

// Auditoría de propinas: la pizarra para sentarse con el cliente.
// ===============================================================
//
// El cliente no cree que las propinas se repartan. Aquí se abre un turno
// cualquiera —incluido uno viejo—, se ve propina por propina a qué hora entró,
// y se pueden mover los horarios de cada persona para que vea en vivo que una
// propina le deja de contar o le empieza a contar según el minuto exacto.
//
// DOS REGLAS QUE NO SE TOCAN:
//
//   1. Esta pantalla NUNCA modifica un turno. Lo único que puede escribir es la
//      evidencia de propinas que trae de Loggro (`guardar_propinas_turno`), que
//      solo añade y jamás altera un cierre.
//
//   2. El reparto lo calcula js/propinas_reparto.js, que es una réplica exacta
//      de la Edge Function. Si el simulador repartiera distinto que producción,
//      se le estaría demostrando al cliente algo que no es lo que cobra la
//      gente. tools/test_propinas_reparto.mjs fija esa regla.

import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { resolverEsLocal, tablaSegunSede } from "./local_scope.js";
import { repartirPropinas, compararRepartos } from "./propinas_reparto.js?v=20260909sim1";
import { renderRepartoPropinas } from "./cierre_turno_propinas_visual.js?v=20260909prop2";
import { mensajeDeError } from "./edge_function_error.js";

const CIERRE_TABLES = { principal: "cierres_turno_final", local: "cierres_turno_final_locales" };
const APOYO_TABLES = { principal: "apoyos_turno", local: "apoyos_turno_locales" };
const TZ = "America/Bogota";

const el = (id) => document.getElementById(id);

const contenido = el("contenido");
const sinAcceso = el("sinAcceso");
const loadingOverlay = el("loadingOverlay");
const status = el("status");
const origenDatos = el("origenDatos");
const selSede = el("selSede");
const selFecha = el("selFecha");
const selJornada = el("selJornada");
const btnCargar = el("btnCargar");
const btnRestaurar = el("btnRestaurar");
const avisoSimulado = el("avisoSimulado");
const listaPersonas = el("listaPersonas");
const resumenCambios = el("resumenCambios");
const tablaBody = el("tablaPropinasBody");
const tablaPie = el("tablaPropinasPie");
const propinasDesglose = el("propinasDesglose");

const estado = {
  contexto: null,
  eventos: [],
  personasReales: [],   // los rangos tal como quedaron guardados
  personas: [],         // los rangos que se están simulando
  repartoReal: null,
};

const formateadorCOP = typeof Intl !== "undefined"
  ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
  : null;
const dinero = (v) => (formateadorCOP ? formateadorCOP.format(Number(v) || 0) : `$${Math.round(Number(v) || 0)}`);

const horaExacta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "--:--:--"
    : d.toLocaleTimeString("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

/** ISO -> "HH:MM" en hora de Colombia, para los inputs de tipo time. */
const isoAHoraLocal = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
};

/**
 * "HH:MM" + fecha -> instante ISO, con el desfase de Colombia escrito a mano.
 * Con setHours se usaría la zona del navegador y las franjas quedarían corridas
 * respecto a las propinas en un equipo configurado en otro huso.
 */
const horaLocalAIso = (fecha, hhmm, referenciaInicio = null) => {
  const m = String(hhmm || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!fecha || !m) return null;
  const hh = String(Number(m[1])).padStart(2, "0");
  const armar = (dia) => new Date(`${dia}T${hh}:${m[2]}:00-05:00`);
  const base = armar(fecha);
  if (Number.isNaN(base.getTime())) return null;
  if (Number.isFinite(referenciaInicio) && base.getTime() <= referenciaInicio) {
    const siguiente = new Date(`${fecha}T12:00:00-05:00`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
    const corrido = armar(siguiente.toISOString().slice(0, 10));
    if (!Number.isNaN(corrido.getTime())) return corrido.toISOString();
  }
  return base.toISOString();
};

const setLoading = (activo) => loadingOverlay?.classList.toggle("is-hidden", !activo);
const setStatus = (mensaje, esError = false) => {
  if (!status) return;
  status.textContent = mensaje || "";
  status.classList.toggle("is-error", Boolean(esError));
};
const mostrarBloques = (visible) => {
  ["bloqueTurno", "bloquePersonas", "bloqueDesglose"].forEach((id) => el(id)?.classList.toggle("is-hidden", !visible));
};

// ── Carga ────────────────────────────────────────────────────────────────

/**
 * De dónde salen las propinas, en este orden:
 *   1. `propinas_turno_eventos`: evidencia ya archivada. No depende de Loggro.
 *   2. Loggro en vivo. Si responde, se archiva para que la próxima vez no haga
 *      falta —Loggro puede limitar las facturas visibles a las últimas 24 horas.
 * Si ninguna da nada, se dice cuál falló en vez de dejar la pantalla vacía.
 */
const cargarEventos = async ({ empresaId, fecha, jornada, personas }) => {
  const { data: archivados, error: errorArchivo } = await supabase
    .from("propinas_turno_eventos")
    .select("factura_id, ocurrido_en, monto")
    .eq("empresa_id", empresaId)
    .eq("fecha_turno", fecha)
    .eq("numero_turno", jornada)
    .order("ocurrido_en", { ascending: true });

  if (!errorArchivo && Array.isArray(archivados) && archivados.length) {
    return { eventos: archivados, origen: "archivo", detalle: `${archivados.length} propinas archivadas de este turno.` };
  }

  // No hay evidencia: se le pide a Loggro. El payload imita el del cierre.
  const responsable = personas.find((p) => p.tipo === "responsable") || personas[0];
  if (!responsable) {
    return { eventos: [], origen: "sin_personas", detalle: "El turno no tiene responsable registrado." };
  }

  const cuerpo = {
    empresa_id: empresaId,
    apoyo: {
      fecha,
      responsable_turno_id: responsable.id,
      hora_inicio: isoAHoraLocal(responsable.inicio),
      hora_fin: isoAHoraLocal(responsable.fin),
      registros: personas
        .filter((p) => p.tipo === "apoyo")
        .map((p) => ({
          apoyo_responsable_id: p.id,
          fecha,
          rango_hora_inicio_24: isoAHoraLocal(p.inicio),
          rango_hora_fin_24: isoAHoraLocal(p.fin),
        })),
    },
  };

  const { data, error } = await supabase.functions.invoke("consultar-propina-apoyos", { body: cuerpo });

  if (error || !data || data.ok === false) {
    // No siempre es Loggro: puede ser la sesión vencida (401), el turno fuera
    // de alcance (403), o un dato incompleto (422). `mensajeDeError` saca el
    // motivo real que escribió la Edge Function en vez del genérico
    // "Edge Function returned a non-2xx status code" que da invoke().
    const motivo = await mensajeDeError(error, data, "sin detalle");
    return { eventos: [], origen: "error_loggro", detalle: `No se pudieron traer las propinas de ese turno: ${motivo}` };
  }

  const eventos = Array.isArray(data.eventos) ? data.eventos : [];
  if (!eventos.length) {
    return {
      eventos: [],
      origen: "loggro_vacio",
      detalle: "Loggro respondió, pero sin propinas para ese turno. Puede ser que ese día no hubiera, "
             + "o que la cuenta solo muestre las facturas de las últimas 24 horas.",
    };
  }

  // Se archiva para que la próxima consulta no dependa de Loggro. Si falla, no
  // pasa nada: la pantalla ya tiene los datos que necesita.
  let archivadoOk = false;
  try {
    const { error: errorGuardar } = await supabase.rpc("guardar_propinas_turno", {
      p_empresa_id: empresaId,
      p_fecha: fecha,
      p_numero: jornada,
      p_eventos: eventos,
    });
    archivadoOk = !errorGuardar;
    if (errorGuardar) console.error("[simulador] no se pudo archivar la evidencia", errorGuardar);
  } catch (e) {
    console.error("[simulador] no se pudo archivar la evidencia", e);
  }

  return {
    eventos,
    origen: "loggro",
    detalle: `${eventos.length} propinas traídas de Loggro`
           + (archivadoOk ? " y archivadas: la próxima vez se abren al instante." : "."),
  };
};

/** Responsable y apoyos con los rangos que quedaron guardados ese día. */
const cargarPersonas = async ({ empresaId, esLocal, fecha, jornada }) => {
  const tablaCierres = tablaSegunSede(CIERRE_TABLES, esLocal);
  const tablaApoyos = tablaSegunSede(APOYO_TABLES, esLocal);

  const { data: cierre, error: errorCierre } = await supabase
    .from(tablaCierres)
    .select("responsable_id, hora_inicio, hora_fin")
    .eq("empresa_id", empresaId)
    .eq("fecha_turno", fecha)
    .eq("numero_turno", jornada)
    .limit(1);

  if (errorCierre) throw new Error(`No se pudo leer el turno: ${errorCierre.message}`);
  const fila = Array.isArray(cierre) ? cierre[0] : null;
  if (!fila) throw new Error(`No hay ningún cierre guardado para esa sede, fecha y jornada (${tablaCierres}).`);

  const { data: apoyos } = await supabase
    .from(tablaApoyos)
    .select("apoyo_responsable_id, hora_inicio, hora_fin")
    .eq("empresa_id", empresaId)
    .eq("fecha_turno", fecha)
    .eq("numero_turno", jornada);

  const tablaUsuarios = esLocal ? "usuarios_locales" : "usuarios_sistema";
  const ids = [fila.responsable_id, ...(apoyos || []).map((a) => a.apoyo_responsable_id)].filter(Boolean);
  const { data: usuarios } = await supabase.from(tablaUsuarios).select("id, nombre_completo").in("id", ids);
  const nombre = (id) => (usuarios || []).find((u) => String(u.id) === String(id))?.nombre_completo || String(id || "Sin nombre");

  const inicioResp = horaLocalAIso(fecha, fila.hora_inicio);
  const personas = [{
    id: String(fila.responsable_id),
    tipo: "responsable",
    nombre: nombre(fila.responsable_id),
    inicio: inicioResp,
    fin: horaLocalAIso(fecha, fila.hora_fin, Date.parse(inicioResp)),
  }];

  (apoyos || []).forEach((a) => {
    if (!a.apoyo_responsable_id) return;
    const ini = horaLocalAIso(fecha, a.hora_inicio);
    personas.push({
      id: String(a.apoyo_responsable_id),
      tipo: "apoyo",
      nombre: nombre(a.apoyo_responsable_id),
      inicio: ini,
      fin: horaLocalAIso(fecha, a.hora_fin, Date.parse(ini)),
    });
  });

  return personas.filter((p) => p.inicio && p.fin);
};

// ── Pintado ──────────────────────────────────────────────────────────────

const crear = (tag, clase, texto) => {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined && texto !== null) n.textContent = String(texto);
  return n;
};

/** La tabla que pidió el cliente: dos columnas, hora exacta y propina. */
const pintarTablaPropinas = (eventos) => {
  tablaBody.innerHTML = "";
  tablaPie.innerHTML = "";

  if (!eventos.length) {
    const tr = crear("tr");
    const td = crear("td", null, "Sin propinas en este turno.");
    td.colSpan = 2;
    tr.appendChild(td);
    tablaBody.appendChild(tr);
    return;
  }

  eventos.forEach((evento) => {
    const tr = crear("tr");
    tr.appendChild(crear("td", "sim-hora", horaExacta(evento.ocurrido_en)));
    tr.appendChild(crear("td", "sim-monto is-num", dinero(evento.monto)));
    tablaBody.appendChild(tr);
  });

  const total = eventos.reduce((s, e) => s + Number(e.monto || 0), 0);
  const tr = crear("tr");
  tr.appendChild(crear("th", null, `Total · ${eventos.length} propinas`));
  tr.appendChild(crear("th", "is-num", dinero(total)));
  tablaPie.appendChild(tr);
};

/** Cada persona con su rango editable. Cambiar una hora recalcula al instante. */
const pintarPersonas = () => {
  listaPersonas.innerHTML = "";

  estado.personas.forEach((persona, indice) => {
    const fila = crear("div", "sim-persona");

    const ident = crear("div", "sim-persona-ident");
    ident.appendChild(crear("strong", null, persona.nombre));
    ident.appendChild(crear("span", `sim-rol sim-rol-${persona.tipo}`,
      persona.tipo === "responsable" ? "Responsable" : "Apoyo"));
    fila.appendChild(ident);

    const rango = crear("div", "sim-rango");
    [["inicio", "Entró"], ["fin", "Salió"]].forEach(([campo, etiqueta]) => {
      const label = crear("label", "sim-campo");
      label.appendChild(crear("span", null, etiqueta));
      const input = document.createElement("input");
      input.type = "time";
      input.value = isoAHoraLocal(persona[campo]);
      input.dataset.indice = String(indice);
      input.dataset.campo = campo;
      input.addEventListener("change", alCambiarRango);
      label.appendChild(input);
      rango.appendChild(label);
    });
    fila.appendChild(rango);

    const original = estado.personasReales.find((p) => p.id === persona.id);
    const movido = original && (original.inicio !== persona.inicio || original.fin !== persona.fin);
    if (movido) {
      fila.appendChild(crear("span", "sim-movido",
        `Original: ${isoAHoraLocal(original.inicio)} – ${isoAHoraLocal(original.fin)}`));
    }

    listaPersonas.appendChild(fila);
  });
};

const alCambiarRango = (evento) => {
  const indice = Number(evento.target.dataset.indice);
  const campo = evento.target.dataset.campo;
  const persona = estado.personas[indice];
  if (!persona) return;

  const fecha = selFecha.value;
  const referencia = campo === "fin" ? Date.parse(persona.inicio) : null;
  const nuevo = horaLocalAIso(fecha, evento.target.value, referencia);
  if (!nuevo) return;

  estado.personas[indice] = { ...persona, [campo]: nuevo };

  // Si al mover el inicio el fin queda antes, se corre al día siguiente: es un
  // turno que cruza medianoche, no un error.
  if (campo === "inicio") {
    const p = estado.personas[indice];
    if (Date.parse(p.fin) <= Date.parse(p.inicio)) {
      estado.personas[indice] = { ...p, fin: horaLocalAIso(fecha, isoAHoraLocal(p.fin), Date.parse(p.inicio)) };
    }
  }

  recalcular();
};

// ── Simulación ───────────────────────────────────────────────────────────

const pintarCambios = (comparacion) => {
  resumenCambios.innerHTML = "";

  if (!comparacion.hay_cambios) {
    resumenCambios.classList.add("is-hidden");
    avisoSimulado.classList.add("is-hidden");
    return;
  }

  resumenCambios.classList.remove("is-hidden");
  avisoSimulado.classList.remove("is-hidden");
  resumenCambios.appendChild(crear("h4", null, "Qué cambia si los horarios fueran estos"));

  comparacion.cambios
    .filter((c) => Math.abs(c.diferencia) >= 0.01 || c.propinas_antes !== c.propinas_ahora)
    .forEach((c) => {
      const linea = crear("p", c.diferencia < 0 ? "sim-cambio sim-cambio-baja" : "sim-cambio sim-cambio-sube");
      const signo = c.diferencia > 0 ? "+" : "−";
      const propinas = c.propinas_ahora - c.propinas_antes;
      const detallePropinas = propinas === 0
        ? "las mismas propinas"
        : `${Math.abs(propinas)} propina${Math.abs(propinas) === 1 ? "" : "s"} ${propinas > 0 ? "más" : "menos"}`;
      linea.textContent = `${c.nombre}: ${dinero(c.antes)} → ${dinero(c.ahora)} `
                        + `(${signo}${dinero(Math.abs(c.diferencia)).replace("$", "$")}, ${detallePropinas})`;
      resumenCambios.appendChild(linea);
    });

  if (comparacion.huerfano_ahora > comparacion.huerfano_antes) {
    const aviso = crear("p", "sim-cambio sim-cambio-huerfano",
      `Ojo: ${dinero(comparacion.huerfano_ahora)} en propinas quedarían sin dueño, `
      + "porque en ese instante no habría nadie cubriendo el turno.");
    resumenCambios.appendChild(aviso);
  }
};

/** El corazón de la demostración: recalcula en el navegador, sin ir a Loggro. */
const recalcular = () => {
  const simulado = repartirPropinas(estado.personas, estado.eventos);
  renderRepartoPropinas(propinasDesglose, {
    detalles: simulado.detalles,
    eventos: simulado.eventos,
    total_propina_dia: simulado.total_recibido,
    total_propina_distribuida: simulado.total_repartido,
    coinciden_totales: simulado.coinciden_totales,
  }, (id) => estado.personas.find((p) => p.id === id)?.nombre || id);

  pintarPersonas();
  pintarCambios(compararRepartos(estado.repartoReal, simulado));
};

const restaurar = () => {
  estado.personas = estado.personasReales.map((p) => ({ ...p }));
  recalcular();
  setStatus("Se restauraron los horarios reales del turno.");
};

// ── Arranque ─────────────────────────────────────────────────────────────

const cargarTurno = async () => {
  const empresaId = selSede.value;
  const fecha = selFecha.value;
  const jornada = Number(selJornada.value);

  if (!empresaId || !fecha || !jornada) {
    setStatus("Elige sede, fecha y jornada.", true);
    return;
  }

  setLoading(true);
  mostrarBloques(false);
  origenDatos.classList.add("is-hidden");
  setStatus("Cargando turno...");

  try {
    const esLocal = await resolverEsLocal(empresaId);
    const personas = await cargarPersonas({ empresaId, esLocal, fecha, jornada });

    const { eventos, origen, detalle } = await cargarEventos({ empresaId, fecha, jornada, personas });

    estado.personasReales = personas.map((p) => ({ ...p }));
    estado.personas = personas.map((p) => ({ ...p }));
    estado.eventos = eventos;
    estado.repartoReal = repartirPropinas(personas, eventos);

    origenDatos.textContent = detalle;
    origenDatos.className = `sim-origen ${origen === "archivo" || origen === "loggro" ? "is-ok" : "is-aviso"}`;
    origenDatos.classList.remove("is-hidden");

    pintarTablaPropinas(eventos);
    mostrarBloques(true);

    if (!eventos.length) {
      // Sin propinas no hay nada que repartir ni que simular.
      el("bloquePersonas")?.classList.add("is-hidden");
      el("bloqueDesglose")?.classList.add("is-hidden");
      setStatus("");
      return;
    }

    recalcular();
    setStatus("");
  } catch (error) {
    console.error("[simulador] no se pudo cargar el turno", error);
    setStatus(error?.message || "No se pudo cargar el turno.", true);
  } finally {
    setLoading(false);
  }
};

const cargarSedes = async () => {
  const { data, error } = await supabase.from("empresas").select("id, nombre_comercial").order("nombre_comercial");
  selSede.innerHTML = "";
  if (error || !Array.isArray(data) || !data.length) {
    selSede.appendChild(new Option("No se pudieron cargar las sedes", ""));
    return;
  }
  data.forEach((e) => selSede.appendChild(new Option(e.nombre_comercial || e.id, e.id)));
  if (estado.contexto?.empresa_id) selSede.value = estado.contexto.empresa_id;
};

const esAdmin = (rol) => ["admin", "admin_root", "superadmin"].includes(String(rol || "").toLowerCase());

const iniciar = async () => {
  setLoading(true);
  try {
    estado.contexto = await getUserContext();
    if (!estado.contexto) {
      setStatus("No se pudo validar la sesión.", true);
      return;
    }

    // El RLS ya bloquea los datos; esto solo evita una pantalla vacía sin explicación.
    if (!esAdmin(estado.contexto.rol)) {
      contenido?.classList.add("is-hidden");
      sinAcceso?.classList.remove("is-hidden");
      return;
    }

    await cargarSedes();
    selFecha.value = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    btnCargar.addEventListener("click", cargarTurno);
    btnRestaurar.addEventListener("click", restaurar);
    setStatus("");
  } catch (error) {
    setStatus(`No se pudo iniciar: ${error?.message || error}`, true);
  } finally {
    setLoading(false);
  }
};

iniciar();
