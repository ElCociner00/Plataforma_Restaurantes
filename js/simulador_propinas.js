/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/simulador_propinas.js
 *
 * Partes del archivo:
 * 1) Imports y estado.
 * 2) Modos de carga: Turno cerrado BD, Consulta Loggro manual, Escenario demo.
 * 3) Pintado: tabla hora/propina, personas con rangos editables.
 * 4) Simulación: recálculo reactivo con propinas_reparto.js y comparativa visual.
 */

// Auditoría y simulador de propinas: demostración interactiva
// ==========================================================

import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { resolverEsLocal, tablaSegunSede } from "./local_scope.js";
import { repartirPropinas, compararRepartos } from "./propinas_reparto.js?v=20260909sim2";
import { renderRepartoPropinas } from "./cierre_turno_propinas_visual.js?v=20260909sim2";

const CIERRE_TABLES = { principal: "cierres_turno_final", local: "cierres_turno_final_locales" };
const APOYO_TABLES = { principal: "apoyos_turno", local: "apoyos_turno_locales" };
const TZ = "America/Bogota";

const el = (id) => document.getElementById(id);

const contenido = el("contenido");
const sinAcceso = el("sinAcceso");
const loadingOverlay = el("loadingOverlay");
const status = el("status");
const origenDatos = el("origenDatos");

// Selectores modo BD
const panelModoBD = el("panelModoBD");
const panelModoManual = el("panelModoManual");
const tabModoBD = el("tabModoBD");
const tabModoManual = el("tabModoManual");
const btnCargarDemo = el("btnCargarDemo");

const selSede = el("selSede");
const selFecha = el("selFecha");
const selJornada = el("selJornada");
const btnCargar = el("btnCargar");

// Selectores modo Manual
const selSedeManual = el("selSedeManual");
const selFechaManual = el("selFechaManual");
const selHoraInicio = el("selHoraInicio");
const selHoraFin = el("selHoraFin");
const btnConsultarLoggroManual = el("btnConsultarLoggroManual");
const btnIniciarManual = el("btnIniciarManual");

// Acciones y bloques
const btnRestaurar = el("btnRestaurar");
const avisoSimulado = el("avisoSimulado");
const listaPersonas = el("listaPersonas");
const resumenCambios = el("resumenCambios");
const tablaBody = el("tablaPropinasBody");
const tablaPie = el("tablaPropinasPie");
const propinasDesglose = el("propinasDesglose");
const btnAgregarPropina = el("btnAgregarPropina");
const btnAgregarApoyo = el("btnAgregarApoyo");

const formateadorCOP = typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function"
  ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
  : null;

const dinero = (v) => formateadorCOP ? formateadorCOP.format(Number(v) || 0) : `$${Math.round(Number(v) || 0)}`;

const horaExacta = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const isoAHoraLocal = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00:00";
  return d.toLocaleTimeString("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
};

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

const estado = {
  contexto: null,
  fechaActiva: "",
  personasReales: [],
  personas: [],
  eventosReales: [],
  eventos: [],
  repartoReal: null,
};

// ── Carga y orígenes de datos ─────────────────────────────────────────────

const cargarEventosDeBD = async ({ empresaId, fecha, jornada, personas, propinaRegistrada = 0 }) => {
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

  const responsable = personas.find((p) => p.tipo === "responsable") || personas[0];
  if (!responsable) {
    return { eventos: [], origen: "sin_personas", detalle: "El turno no tiene responsable registrado." };
  }

  const cuerpo = {
    empresa_id: empresaId,
    fecha,
    hora_inicio: isoAHoraLocal(responsable.inicio),
    hora_fin: isoAHoraLocal(responsable.fin),
    responsable_id: responsable.id,
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

  try {
    const { data, error } = await supabase.functions.invoke("consultar-propina-apoyos", { body: cuerpo });
    const eventos = Array.isArray(data?.eventos) ? data.eventos : [];

    if (!error && eventos.length) {
      try {
        await supabase.rpc("guardar_propinas_turno", {
          p_empresa_id: empresaId,
          p_fecha: fecha,
          p_numero: jornada,
          p_eventos: eventos,
        });
      } catch (e) {
        console.error("[simulador] no se pudo archivar", e);
      }
      return { eventos, origen: "loggro", detalle: `${eventos.length} propinas consultadas de Loggro.` };
    }
  } catch (errLoggro) {
    console.warn("[simulador] error consultando Loggro", errLoggro);
  }

  // Si no hay eventos factura por factura pero el cierre tenía propina registrada
  if (propinaRegistrada > 0) {
    const horaMedio = new Date((Date.parse(responsable.inicio) + Date.parse(responsable.fin)) / 2).toISOString();
    const eventoSintetico = [{
      factura_id: "TURNO-CERRADO",
      ocurrido_en: horaMedio,
      monto: Math.round(propinaRegistrada * 100) / 100
    }];
    return {
      eventos: eventoSintetico,
      origen: "propina_turno",
      detalle: `Turno con propina registrada de ${dinero(propinaRegistrada)}. Loggro no reportó facturas individuales para esta fecha pasada; se generó la propina para simulación.`
    };
  }

  return {
    eventos: [],
    origen: "loggro_vacio",
    detalle: "No se encontraron facturas con propina registradas en Loggro para este turno. Puedes añadir propinas manualmente con el botón "+ Agregar propina" para la demostración."
  };
};

const cargarPersonasDeBD = async ({ empresaId, esLocal, fecha, jornada }) => {
  const tablaCierres = tablaSegunSede(CIERRE_TABLES, esLocal);
  const tablaApoyos = tablaSegunSede(APOYO_TABLES, esLocal);

  const { data: cierres, error: errorCierre } = await supabase
    .from(tablaCierres)
    .select("responsable_id, hora_inicio, hora_fin, valor, propina_global")
    .eq("empresa_id", empresaId)
    .eq("fecha_turno", fecha)
    .eq("numero_turno", jornada);

  if (errorCierre) throw new Error(`No se pudo leer el turno: ${errorCierre.message}`);
  const fila = Array.isArray(cierres) && cierres.length ? cierres[0] : null;
  if (!fila) {
    throw new Error(`No hay ningún cierre guardado para esa sede, fecha y jornada (${tablaCierres}). Si deseas simular sin cierre previo, usa la pestaña "Consulta por Horario / Manual".`);
  }

  let propinaRegistrada = Number(fila.propina_global || 0);
  if (!propinaRegistrada && Array.isArray(cierres)) {
    const filaPropina = cierres.find((c) => c.variable === "propina" || c.variable === "propinas");
    if (filaPropina) propinaRegistrada = Number(filaPropina.valor || 0);
  }

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

  const inicioResp = horaLocalAIso(fecha, fila.hora_inicio || "08:00");
  const personas = [{
    id: String(fila.responsable_id || "responsable"),
    tipo: "responsable",
    nombre: nombre(fila.responsable_id) || "Responsable",
    inicio: inicioResp,
    fin: horaLocalAIso(fecha, fila.hora_fin || "16:00", Date.parse(inicioResp)),
  }];

  (apoyos || []).forEach((a) => {
    if (!a.apoyo_responsable_id) return;
    const ini = horaLocalAIso(fecha, a.hora_inicio || "09:00");
    personas.push({
      id: String(a.apoyo_responsable_id),
      tipo: "apoyo",
      nombre: nombre(a.apoyo_responsable_id) || `Apoyo ${personas.length}`,
      inicio: ini,
      fin: horaLocalAIso(fecha, a.hora_fin || "14:00", Date.parse(ini)),
    });
  });

  return {
    personas: personas.filter((p) => p.inicio && p.fin),
    propinaRegistrada
  };
};

// ── Pintado y visualización ───────────────────────────────────────────────

const crear = (tag, clase, texto) => {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined && texto !== null) n.textContent = String(texto);
  return n;
};

const pintarTablaPropinas = (eventos) => {
  tablaBody.innerHTML = "";
  tablaPie.innerHTML = "";

  if (!eventos.length) {
    const tr = crear("tr");
    const td = crear("td", null, "Sin propinas en este turno. Puedes agregar una con "+ Agregar propina".");
    td.colSpan = 3;
    tr.appendChild(td);
    tablaBody.appendChild(tr);
    return;
  }

  eventos.forEach((evento, indice) => {
    const tr = crear("tr");
    tr.appendChild(crear("td", "sim-hora", horaExacta(evento.ocurrido_en)));
    tr.appendChild(crear("td", "sim-monto is-num", dinero(evento.monto)));

    const tdAccion = crear("td", "is-action");
    const btnBorrar = crear("button", "btn-borrar", "✕");
    btnBorrar.title = "Eliminar propina";
    btnBorrar.addEventListener("click", () => {
      estado.eventos.splice(indice, 1);
      recalcular();
    });
    tdAccion.appendChild(btnBorrar);
    tr.appendChild(tdAccion);

    tablaBody.appendChild(tr);
  });

  const total = eventos.reduce((s, e) => s + Number(e.monto || 0), 0);
  const tr = crear("tr");
  tr.appendChild(crear("th", null, `Total · ${eventos.length} propina(s)`));
  tr.appendChild(crear("th", "is-num", dinero(total)));
  tr.appendChild(crear("th", null, ""));
  tablaPie.appendChild(tr);
};

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

    if (persona.tipo === "apoyo") {
      const btnEliminar = crear("button", "btn-borrar", "Quitar");
      btnEliminar.addEventListener("click", () => {
        estado.personas.splice(indice, 1);
        recalcular();
      });
      fila.appendChild(btnEliminar);
    }

    listaPersonas.appendChild(fila);
  });
};

const alCambiarRango = (e) => {
  const indice = Number(e.target.dataset.indice);
  const campo = e.target.dataset.campo;
  const valor = e.target.value;
  if (!Number.isFinite(indice) || !estado.personas[indice]) return;

  const fecha = estado.fechaActiva || new Date().toISOString().slice(0, 10);
  const refInicio = campo === "fin" ? Date.parse(estado.personas[indice].inicio) : null;
  const iso = horaLocalAIso(fecha, valor, refInicio);
  if (!iso) return;

  estado.personas[indice][campo] = iso;
  recalcular();
};

const pintarResumenCambios = (comparativa) => {
  resumenCambios.innerHTML = "";
  if (!comparativa || !comparativa.hayCambios) {
    resumenCambios.classList.add("is-hidden");
    return;
  }

  resumenCambios.appendChild(crear("h4", null, "Efecto de los cambios de horario en el reparto:"));

  comparativa.personas.forEach((p) => {
    if (Math.abs(p.diferencia) < 0.01) return;
    const sube = p.diferencia > 0;
    const pEl = crear("p", `sim-cambio ${sube ? "sim-cambio-sube" : "sim-cambio-baja"}`,
      `• ${p.nombre}: ${dinero(p.montoReal)} → ${dinero(p.montoSimulado)} (${sube ? "+" : ""}${dinero(p.diferencia)})`);
    resumenCambios.appendChild(pEl);
  });

  if (comparativa.propinasHuerfanasSimuladas > 0) {
    resumenCambios.appendChild(crear("p", "sim-cambio-huerfano",
      `⚠️ Hay ${comparativa.propinasHuerfanasSimuladas} propina(s) que quedaron fuera del horario de todo el personal.`));
  }

  resumenCambios.classList.remove("is-hidden");
};

const recalcular = () => {
  pintarTablaPropinas(estado.eventos);
  pintarPersonas();

  if (!estado.personas.length) {
    el("bloqueDesglose")?.classList.add("is-hidden");
    return;
  }

  const simulado = repartirPropinas(estado.personas, estado.eventos);
  const resolverNombre = (id) => estado.personas.find((p) => p.id === id)?.nombre || id;

  renderRepartoPropinas(propinasDesglose, simulado, resolverNombre);
  el("bloqueDesglose")?.classList.remove("is-hidden");

  const comparativa = estado.repartoReal ? compararRepartos(estado.repartoReal, simulado) : null;
  const hayCambios = Boolean(comparativa?.hayCambios);
  avisoSimulado?.classList.toggle("is-hidden", !hayCambios);
  pintarResumenCambios(comparativa);
};

const restaurar = () => {
  estado.personas = estado.personasReales.map((p) => ({ ...p }));
  estado.eventos = estado.eventosReales.map((e) => ({ ...e }));
  recalcular();
  setStatus("Se restauraron los horarios y datos originales.");
};

// ── Carga de modos ────────────────────────────────────────────────────────

const cargarTurnoBD = async () => {
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
    estado.fechaActiva = fecha;
    const esLocal = await resolverEsLocal(empresaId);
    const { personas, propinaRegistrada } = await cargarPersonasDeBD({ empresaId, esLocal, fecha, jornada });
    const { eventos, origen, detalle } = await cargarEventosDeBD({ empresaId, fecha, jornada, personas, propinaRegistrada });

    estado.personasReales = personas.map((p) => ({ ...p }));
    estado.personas = personas.map((p) => ({ ...p }));
    estado.eventosReales = eventos.map((e) => ({ ...e }));
    estado.eventos = eventos.map((e) => ({ ...e }));
    estado.repartoReal = repartirPropinas(personas, eventos);

    origenDatos.textContent = detalle;
    origenDatos.className = `sim-origen ${origen === "archivo" || origen === "loggro" || origen === "propina_turno" ? "is-ok" : "is-aviso"}`;
    origenDatos.classList.remove("is-hidden");

    mostrarBloques(true);
    recalcular();
    setStatus("");
  } catch (error) {
    console.error("[simulador] error cargando turno BD", error);
    setStatus(error?.message || "No se pudo cargar el turno.", true);
  } finally {
    setLoading(false);
  }
};

const iniciarManual = (conLoggro = false) => async () => {
  const empresaId = selSedeManual.value;
  const fecha = selFechaManual.value;
  const horaIni = selHoraInicio.value || "08:00";
  const horaFin = selHoraFin.value || "16:00";

  if (!empresaId || !fecha) {
    setStatus("Elige sede y fecha para iniciar.", true);
    return;
  }

  setLoading(true);
  mostrarBloques(false);
  origenDatos.classList.add("is-hidden");
  setStatus(conLoggro ? "Consultando Loggro para el rango seleccionado..." : "Preparando simulación...");

  try {
    estado.fechaActiva = fecha;
    const inicioIso = horaLocalAIso(fecha, horaIni);
    const finIso = horaLocalAIso(fecha, horaFin, Date.parse(inicioIso));

    const personas = [{
      id: "responsable-1",
      tipo: "responsable",
      nombre: "Responsable Turno",
      inicio: inicioIso,
      fin: finIso
    }];

    let eventos = [];
    let detalle = "Simulación iniciada con horarios definidos. Puedes agregar propinas y apoyos para probar.";

    if (conLoggro) {
      try {
        const { data, error } = await supabase.functions.invoke("consultar-propina-apoyos", {
          body: {
            empresa_id: empresaId,
            fecha,
            hora_inicio: horaIni,
            hora_fin: horaFin,
            responsable_id: "responsable-1"
          }
        });
        if (!error && Array.isArray(data?.eventos) && data.eventos.length) {
          eventos = data.eventos;
          detalle = `${eventos.length} propina(s) encontradas en Loggro para este rango.`;
        } else {
          detalle = "Loggro respondió pero no devolvió facturas con propina en este horario. Puedes agregar propinas manualmente.";
        }
      } catch (err) {
        detalle = `No se pudo conectar con Loggro (${err.message}). Puedes simular manualmente.`;
      }
    }

    estado.personasReales = personas.map((p) => ({ ...p }));
    estado.personas = personas.map((p) => ({ ...p }));
    estado.eventosReales = eventos.map((e) => ({ ...e }));
    estado.eventos = eventos.map((e) => ({ ...e }));
    estado.repartoReal = repartirPropinas(personas, eventos);

    origenDatos.textContent = detalle;
    origenDatos.className = "sim-origen is-ok";
    origenDatos.classList.remove("is-hidden");

    mostrarBloques(true);
    recalcular();
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setLoading(false);
  }
};

const cargarEscenarioDemo = () => {
  const hoy = new Date().toISOString().slice(0, 10);
  estado.fechaActiva = hoy;

  const h = (hhmm) => horaLocalAIso(hoy, hhmm);

  const personas = [
    { id: "resp-santi", tipo: "responsable", nombre: "Sebastián (Responsable)", inicio: h("08:30"), fin: h("15:30") },
    { id: "apoyo-bruno", tipo: "apoyo", nombre: "Bruno (Apoyo Mañana)", inicio: h("09:00"), fin: h("13:00") },
    { id: "apoyo-carla", tipo: "apoyo", nombre: "Carla (Apoyo Almuerzo)", inicio: h("12:00"), fin: h("15:30") }
  ];

  const eventos = [
    { factura_id: "FAC-101", ocurrido_en: h("08:45"), monto: 8000 },
    { factura_id: "FAC-102", ocurrido_en: h("09:30"), monto: 12000 },
    { factura_id: "FAC-103", ocurrido_en: h("12:45"), monto: 18000 },
    { factura_id: "FAC-104", ocurrido_en: h("14:15"), monto: 10000 }
  ];

  estado.personasReales = personas.map((p) => ({ ...p }));
  estado.personas = personas.map((p) => ({ ...p }));
  estado.eventosReales = eventos.map((e) => ({ ...e }));
  estado.eventos = eventos.map((e) => ({ ...e }));
  estado.repartoReal = repartirPropinas(personas, eventos);

  origenDatos.textContent = "⚡ Escenario demo listo con 3 personas y 4 propinas en diferentes momentos. Mueve cualquier horario para ver el recálculo en vivo.";
  origenDatos.className = "sim-origen is-ok";
  origenDatos.classList.remove("is-hidden");

  mostrarBloques(true);
  recalcular();
  setStatus("Escenario de demostración interactiva cargado.");
};

// ── Agregar apoyos y propinas ─────────────────────────────────────────────

const agregarPropinaManual = () => {
  const horaStr = window.prompt("Hora de la propina (formato HH:MM, ej: 11:30):", "11:30");
  if (!horaStr) return;
  const montoStr = window.prompt("Monto de la propina en pesos (ej: 15000):", "15000");
  const monto = Number(montoStr);
  if (!monto || monto <= 0) return;

  const fecha = estado.fechaActiva || new Date().toISOString().slice(0, 10);
  const iso = horaLocalAIso(fecha, horaStr);
  if (!iso) {
    alert("Hora inválida.");
    return;
  }

  estado.eventos.push({
    factura_id: `FAC-MANUAL-${Date.now().toString().slice(-4)}`,
    ocurrido_en: iso,
    monto
  });
  estado.eventos.sort((a, b) => a.ocurrido_en.localeCompare(b.ocurrido_en));
  recalcular();
};

const agregarApoyoManual = () => {
  const nombre = window.prompt("Nombre de la persona o apoyo:", `Apoyo ${estado.personas.length}`);
  if (!nombre) return;
  const horaIni = window.prompt("Hora de entrada (HH:MM):", "10:00");
  if (!horaIni) return;
  const horaFin = window.prompt("Hora de salida (HH:MM):", "14:00");
  if (!horaFin) return;

  const fecha = estado.fechaActiva || new Date().toISOString().slice(0, 10);
  const iniIso = horaLocalAIso(fecha, horaIni);
  const finIso = horaLocalAIso(fecha, horaFin, Date.parse(iniIso));

  estado.personas.push({
    id: `apoyo-manual-${Date.now()}`,
    tipo: "apoyo",
    nombre,
    inicio: iniIso,
    fin: finIso
  });
  recalcular();
};

// ── Inicialización ────────────────────────────────────────────────────────

const cargarSedes = async () => {
  const { data, error } = await supabase.from("empresas").select("id, nombre_comercial").order("nombre_comercial");
  [selSede, selSedeManual].forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = "";
    if (error || !Array.isArray(data) || !data.length) {
      sel.appendChild(new Option("No se pudieron cargar las sedes", ""));
      return;
    }
    data.forEach((e) => sel.appendChild(new Option(e.nombre_comercial || e.id, e.id)));
    if (estado.contexto?.empresa_id) sel.value = estado.contexto.empresa_id;
  });
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

    if (!esAdmin(estado.contexto.rol)) {
      contenido?.classList.add("is-hidden");
      sinAcceso?.classList.remove("is-hidden");
      return;
    }

    await cargarSedes();
    const hoy = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (selFecha) selFecha.value = hoy;
    if (selFechaManual) selFechaManual.value = hoy;

    // Tabs
    tabModoBD?.addEventListener("click", () => {
      tabModoBD.classList.add("active");
      tabModoManual.classList.remove("active");
      panelModoBD.classList.remove("is-hidden");
      panelModoManual.classList.add("is-hidden");
    });

    tabModoManual?.addEventListener("click", () => {
      tabModoManual.classList.add("active");
      tabModoBD.classList.remove("active");
      panelModoManual.classList.remove("is-hidden");
      panelModoBD.classList.add("is-hidden");
    });

    btnCargarDemo?.addEventListener("click", cargarEscenarioDemo);

    btnCargar?.addEventListener("click", cargarTurnoBD);
    btnConsultarLoggroManual?.addEventListener("click", iniciarManual(true));
    btnIniciarManual?.addEventListener("click", iniciarManual(false));

    btnRestaurar?.addEventListener("click", restaurar);
    btnAgregarPropina?.addEventListener("click", agregarPropinaManual);
    btnAgregarApoyo?.addEventListener("click", agregarApoyoManual);

    setStatus("");
  } catch (error) {
    setStatus(`No se pudo iniciar: ${error?.message || error}`, true);
  } finally {
    setLoading(false);
  }
};

document.addEventListener("DOMContentLoaded", iniciar);
