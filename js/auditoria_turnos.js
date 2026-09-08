/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/auditoria_turnos.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `formatMoney` (línea aprox. 60): Formatea datos para visualización.
 * - `escapeHtml` (línea aprox. 70): Bloque funcional del módulo.
 * - `cargarLotes` (línea aprox. 150): Carga datos.
 * - `aplicarFiltros` (línea aprox. 200): Bloque funcional del módulo.
 * - `renderTabla` (línea aprox. 250): Renderiza/actualiza UI.
 * - `renderDetalle` (línea aprox. 330): Renderiza/actualiza UI.
 * - `restaurarLote` (línea aprox. 450): Bloque funcional del módulo.
 * - `eliminarLote` (línea aprox. 480): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 *
 * PANTALLA DE AUDITORÍA DE TURNOS
 * Lee la vista historico_turnos_lotes, que agrupa cierres_turno_historico por
 * lote_id: un lote es todo lo que salió de la tabla de trabajo en un mismo
 * acto. Sin esa agrupación la pantalla mostraría miles de filas sueltas.
 *
 * Los permisos viven en el RLS de la tabla (app_es_admin), así que aunque
 * alguien llegue a esta URL sin ser administrador no verá ningún dato. El
 * guard de abajo solo evita mostrarle una pantalla vacía sin explicación.
 */
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

// ===============================
// ELEMENTOS
// ===============================
const contenido = document.getElementById("contenido");
const sinAcceso = document.getElementById("sinAcceso");
const loadingOverlay = document.getElementById("loadingOverlay");
const status = document.getElementById("status");
const resumenTarjetas = document.getElementById("resumenTarjetas");
const lotesBody = document.getElementById("lotesBody");
const paginacion = document.getElementById("paginacion");
const detalleLote = document.getElementById("detalleLote");
const conteoFiltro = document.getElementById("conteoFiltro");

const filtroSede = document.getElementById("filtroSede");
const filtroResponsable = document.getElementById("filtroResponsable");
const filtroMotivo = document.getElementById("filtroMotivo");
const filtroEstado = document.getElementById("filtroEstado");
const filtroJornada = document.getElementById("filtroJornada");
const filtroFechaDesde = document.getElementById("filtroFechaDesde");
const filtroFechaHasta = document.getElementById("filtroFechaHasta");
const filtroTexto = document.getElementById("filtroTexto");
const btnLimpiar = document.getElementById("limpiarFiltros");

// ===============================
// CONFIGURACION
// ===============================
const PAGE_SIZE = 25;
const SUPABASE_PAGE_SIZE = 1000;

const MOTIVOS = {
  DUP_EXACTO:     { texto: "Reenvío idéntico",        clase: "tag-dup" },
  DUP_CORREGIDO:  { texto: "Reenvío con corrección",  clase: "tag-corr" },
  DUP_JORNADA:    { texto: "Jornada repetida",        clase: "tag-dup" },
  SOBRESCRITO:    { texto: "Reemplazado",             clase: "tag-sobre" },
  DATOS_PRUEBA:   { texto: "Datos de prueba",         clase: "tag-prueba" },
  FILA_HUERFANA:  { texto: "Fila huérfana",           clase: "tag-rara" },
  ENVIO_TRUNCADO: { texto: "Envío cortado",           clase: "tag-rara" },
  MANUAL:         { texto: "Movimiento manual",       clase: "tag-manual" }
};

const JORNADAS = { 1: "Turno 1 · Mañana", 2: "Turno 2 · Tarde", 3: "Turno 3 · Noche" };

let state = {
  contexto: null,
  lotes: [],
  filtrados: [],
  pagina: 1,
  loteAbierto: null
};

// ===============================
// UTILIDADES
// ===============================
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const formatMoney = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
};

const formatFecha = (value) => {
  if (!value) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(value);
};

const formatFechaHora = (value) => {
  if (!value) return "—";
  const fecha = new Date(value);
  if (Number.isNaN(fecha.getTime())) return String(value);
  return fecha.toLocaleString("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
};

const normalizar = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "");

const setStatus = (mensaje, esError = false) => {
  if (!status) return;
  status.textContent = mensaje || "";
  status.classList.toggle("is-error", Boolean(esError));
};

const setLoading = (activo, mensaje = "Cargando auditoría...") => {
  if (!loadingOverlay) return;
  loadingOverlay.textContent = mensaje;
  loadingOverlay.classList.toggle("is-hidden", !activo);
};

const esAdmin = (rol) => ["admin", "admin_root"].includes(String(rol || "").trim().toLowerCase());

// ===============================
// CARGA DE DATOS
// ===============================

/**
 * Trae la vista de lotes por páginas. Supabase corta en 1000 filas por
 * petición, y aunque hoy hay 138 lotes esto crecerá con cada sobrescritura.
 */
const cargarLotes = async () => {
  const acumulado = [];
  let desde = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("historico_turnos_lotes")
      .select("*")
      .order("fecha_turno", { ascending: false })
      .order("numero_turno", { ascending: true })
      .range(desde, desde + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    if (!Array.isArray(data) || !data.length) break;

    acumulado.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    desde += SUPABASE_PAGE_SIZE;
  }

  return acumulado;
};

const poblarSelector = (select, valores, etiquetaTodos) => {
  if (!select) return;
  const actual = select.value;
  select.innerHTML = `<option value="">${etiquetaTodos}</option>`;
  valores
    .filter((v) => v.valor)
    .sort((a, b) => String(a.texto).localeCompare(String(b.texto), "es"))
    .forEach(({ valor, texto }) => {
      const option = document.createElement("option");
      option.value = valor;
      option.textContent = texto;
      select.appendChild(option);
    });
  select.value = actual;
};

/**
 * Los selectores de sede y responsable se rellenan con lo que realmente hay en
 * el histórico. Ofrecer sedes sin movimientos solo daría filtros que devuelven
 * cero.
 */
const poblarFiltrosDinamicos = () => {
  const sedes = new Map();
  const responsables = new Map();

  state.lotes.forEach((lote) => {
    if (lote.empresa_id) {
      sedes.set(lote.empresa_id, lote.sede || "Sede sin nombre");
    }
    if (lote.responsable_id) {
      responsables.set(lote.responsable_id, lote.responsable || "Responsable sin nombre");
    }
  });

  poblarSelector(
    filtroSede,
    [...sedes].map(([valor, texto]) => ({ valor, texto })),
    "Todas"
  );
  poblarSelector(
    filtroResponsable,
    [...responsables].map(([valor, texto]) => ({ valor, texto })),
    "Todos"
  );

  // Si solo hay una sede, el filtro no aporta nada: se oculta su columna.
  document.body.classList.toggle("una-sola-sede", sedes.size <= 1);
};

// ===============================
// FILTRADO
// ===============================
const aplicarFiltros = () => {
  const sede = filtroSede?.value || "";
  const responsable = filtroResponsable?.value || "";
  const motivo = filtroMotivo?.value || "";
  const estado = filtroEstado?.value || "";
  const jornada = filtroJornada?.value || "";
  const desde = filtroFechaDesde?.value || "";
  const hasta = filtroFechaHasta?.value || "";
  const texto = normalizar(filtroTexto?.value || "");

  state.filtrados = state.lotes.filter((lote) => {
    if (sede && lote.empresa_id !== sede) return false;
    if (responsable && lote.responsable_id !== responsable) return false;
    if (motivo && lote.codigo_motivo !== motivo) return false;
    if (jornada && String(lote.numero_turno) !== jornada) return false;

    const fecha = String(lote.fecha_turno || "").slice(0, 10);
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;

    if (estado === "restaurado" && !lote.restaurado_en) return false;
    if (estado === "editado" && !lote.editado_en) return false;
    if (estado === "archivado" && lote.restaurado_en) return false;

    if (texto) {
      const buscable = normalizar(
        `${lote.observaciones || ""} ${lote.motivo || ""} ${lote.sede || ""} ${lote.responsable || ""}`
      );
      if (!buscable.includes(texto)) return false;
    }

    return true;
  });

  state.pagina = 1;
  renderTabla();
  renderResumen();
};

// ===============================
// RENDER
// ===============================
const renderResumen = () => {
  if (!resumenTarjetas) return;

  const total = state.filtrados.length;
  const filas = state.filtrados.reduce((acc, l) => acc + Number(l.filas || 0), 0);
  const importe = state.filtrados.reduce((acc, l) => acc + Number(l.importe_real || 0), 0);
  const restaurados = state.filtrados.filter((l) => l.restaurado_en).length;

  const tarjetas = [
    { titulo: "Movimientos", valor: total.toLocaleString("es-CO") },
    { titulo: "Filas archivadas", valor: filas.toLocaleString("es-CO") },
    { titulo: "Importe archivado", valor: formatMoney(importe) },
    { titulo: "Restaurados", valor: restaurados.toLocaleString("es-CO") }
  ];

  resumenTarjetas.innerHTML = tarjetas
    .map((t) => `
      <div class="resumen-card">
        <span class="resumen-titulo">${escapeHtml(t.titulo)}</span>
        <strong class="resumen-valor">${escapeHtml(t.valor)}</strong>
      </div>`)
    .join("");
};

const renderEstado = (lote) => {
  const etiquetas = [];
  if (lote.restaurado_en) {
    etiquetas.push(`<span class="tag tag-restaurado" title="Devuelto a la base el ${escapeHtml(formatFechaHora(lote.restaurado_en))}">Restaurado</span>`);
  }
  if (lote.editado_en) {
    etiquetas.push(`<span class="tag tag-editado" title="Un administrador modificó estos valores el ${escapeHtml(formatFechaHora(lote.editado_en))}">Editado</span>`);
  }
  if (!etiquetas.length) {
    etiquetas.push('<span class="tag tag-archivado">Archivado</span>');
  }
  return etiquetas.join(" ");
};

const renderTabla = () => {
  if (!lotesBody) return;

  const total = state.filtrados.length;
  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.pagina > paginas) state.pagina = paginas;

  const inicio = (state.pagina - 1) * PAGE_SIZE;
  const visibles = state.filtrados.slice(inicio, inicio + PAGE_SIZE);

  if (conteoFiltro) {
    conteoFiltro.textContent = total === state.lotes.length
      ? `${total} movimientos`
      : `${total} de ${state.lotes.length} movimientos`;
  }

  if (!visibles.length) {
    lotesBody.innerHTML = '<tr><td colspan="9" class="vacio">No hay movimientos que cumplan estos filtros.</td></tr>';
    if (paginacion) paginacion.innerHTML = "";
    return;
  }

  lotesBody.innerHTML = visibles.map((lote) => {
    const motivo = MOTIVOS[lote.codigo_motivo] || { texto: lote.codigo_motivo || "Sin motivo", clase: "tag-manual" };
    const abierto = state.loteAbierto === lote.lote_id ? " is-abierto" : "";
    return `
      <tr class="fila-lote${abierto}" data-lote="${escapeHtml(lote.lote_id)}" tabindex="0">
        <td>${escapeHtml(formatFecha(lote.fecha_turno))}</td>
        <td>${escapeHtml(JORNADAS[lote.numero_turno] || `Turno ${lote.numero_turno ?? "?"}`)}</td>
        <td class="col-sede">${escapeHtml(lote.sede || "—")}</td>
        <td>${escapeHtml(lote.responsable || "—")}</td>
        <td><span class="tag ${motivo.clase}">${escapeHtml(motivo.texto)}</span></td>
        <td class="num">${escapeHtml(String(lote.filas ?? 0))}</td>
        <td class="num">${escapeHtml(formatMoney(lote.importe_real))}</td>
        <td>${escapeHtml(formatFechaHora(lote.movido_en))}</td>
        <td>${renderEstado(lote)}</td>
      </tr>`;
  }).join("");

  if (paginacion) {
    paginacion.innerHTML = paginas <= 1 ? "" : `
      <button type="button" data-pagina="anterior" ${state.pagina === 1 ? "disabled" : ""}>Anterior</button>
      <span>Página ${state.pagina} de ${paginas}</span>
      <button type="button" data-pagina="siguiente" ${state.pagina === paginas ? "disabled" : ""}>Siguiente</button>`;
  }
};

/**
 * El detalle carga las filas del lote y, en paralelo, el turno que hay hoy en
 * la tabla de trabajo. Se muestran uno al lado del otro porque la pregunta que
 * trae aquí a un administrador es siempre la misma: ¿lo que se archivó era
 * mejor que lo que quedó?
 */
const renderDetalle = async (loteId) => {
  const lote = state.lotes.find((l) => l.lote_id === loteId);
  if (!lote || !detalleLote) return;

  state.loteAbierto = loteId;
  renderTabla();
  detalleLote.innerHTML = '<p class="cargando">Cargando detalle...</p>';

  try {
    const tablaVigente = lote.origen === "cierres_turno_final_locales"
      ? "cierres_turno_final_locales"
      : "cierres_turno_final";

    const [archivadasRes, vigentesRes] = await Promise.all([
      supabase
        .from("cierres_turno_historico")
        .select("historico_id, variable, categoria, valor, hora_inicio, hora_fin, created_at")
        .eq("lote_id", loteId)
        .order("variable", { ascending: true })
        .order("categoria", { ascending: true }),
      supabase
        .from(tablaVigente)
        .select("variable, categoria, valor")
        .eq("empresa_id", lote.empresa_id)
        .eq("fecha_turno", lote.fecha_turno)
        .eq("numero_turno", lote.numero_turno)
    ]);

    if (archivadasRes.error) throw archivadasRes.error;

    const archivadas = archivadasRes.data || [];
    const vigentes = new Map();
    (vigentesRes.data || []).forEach((row) => {
      const clave = `${row.variable}|${row.categoria}`;
      vigentes.set(clave, (vigentes.get(clave) || 0) + Number(row.valor || 0));
    });

    const filas = archivadas.map((row) => {
      const clave = `${row.variable}|${row.categoria}`;
      const vigente = vigentes.has(clave) ? vigentes.get(clave) : null;
      const distinto = vigente !== null && Number(vigente) !== Number(row.valor);
      return `
        <tr${distinto ? ' class="fila-distinta"' : ""}>
          <td>${escapeHtml(row.variable)}</td>
          <td>${escapeHtml(row.categoria)}</td>
          <td class="num">
            <input type="number" class="valor-editable" step="1"
                   data-historico="${escapeHtml(row.historico_id)}"
                   value="${escapeHtml(String(row.valor ?? 0))}">
          </td>
          <td class="num">${vigente === null ? "<em>no está</em>" : escapeHtml(formatMoney(vigente))}</td>
        </tr>`;
    }).join("");

    const restaurado = Boolean(lote.restaurado_en);

    detalleLote.innerHTML = `
      <div class="detalle-cabecera">
        <div>
          <h3>${escapeHtml(formatFecha(lote.fecha_turno))} · ${escapeHtml(JORNADAS[lote.numero_turno] || `Turno ${lote.numero_turno}`)}</h3>
          <p class="detalle-meta">
            ${escapeHtml(lote.sede || "Sede sin nombre")} ·
            Responsable: ${escapeHtml(lote.responsable || "sin registrar")} ·
            Movido el ${escapeHtml(formatFechaHora(lote.movido_en))}
            ${lote.movido_por_correo ? ` por ${escapeHtml(lote.movido_por_correo)}` : ""}
          </p>
        </div>
        <div class="detalle-estado">${renderEstado(lote)}</div>
      </div>

      <label class="campo-observacion">
        <span>Observación · por qué se archivó</span>
        <textarea id="observacionLote" rows="4">${escapeHtml(lote.observaciones || "")}</textarea>
      </label>

      <div class="detalle-acciones">
        <button type="button" id="btnGuardarObservacion">Guardar observación</button>
        <button type="button" id="btnGuardarValores">Guardar valores editados</button>
        <button type="button" id="btnRestaurar" class="btn-restaurar" ${restaurado ? "disabled" : ""}>
          ${restaurado ? "Ya restaurado" : "Devolver a la base principal"}
        </button>
        <button type="button" id="btnEliminar" class="btn-eliminar">Eliminar definitivamente</button>
      </div>

      ${lote.turno_vigente_existe && !restaurado ? `
        <p class="aviso-vigente">
          Hoy existe un turno para esa fecha y jornada. Si devuelves este a la base,
          el que está vigente se archivará primero: no se pierde, queda aquí como un
          movimiento nuevo.
        </p>` : ""}

      <div class="tabla-wrap">
        <table class="tabla-detalle">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Categoría</th>
              <th class="num">Valor archivado</th>
              <th class="num">Valor hoy en la base</th>
            </tr>
          </thead>
          <tbody>${filas || '<tr><td colspan="4" class="vacio">Sin filas.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="hint">
        Las filas resaltadas son las que no coinciden con lo que hay hoy en la base.
      </p>`;

    engancharAccionesDetalle(lote);
  } catch (error) {
    detalleLote.innerHTML = `<p class="is-error">No se pudo cargar el detalle: ${escapeHtml(error.message || error)}</p>`;
  }
};

// ===============================
// ACCIONES
// ===============================
const engancharAccionesDetalle = (lote) => {
  document.getElementById("btnGuardarObservacion")?.addEventListener("click", async () => {
    const texto = document.getElementById("observacionLote")?.value ?? "";
    setLoading(true, "Guardando observación...");
    try {
      const { error } = await supabase.rpc("anotar_historico_turno", {
        p_lote_id: lote.lote_id,
        p_observaciones: texto
      });
      if (error) throw error;
      lote.observaciones = texto;
      setStatus("Observación guardada.");
    } catch (error) {
      setStatus(`No se pudo guardar la observación: ${error.message || error}`, true);
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("btnGuardarValores")?.addEventListener("click", async () => {
    const campos = [...document.querySelectorAll(".valor-editable")];
    setLoading(true, "Guardando valores...");
    try {
      let cambiados = 0;
      for (const campo of campos) {
        if (campo.value === campo.defaultValue) continue;
        const { error } = await supabase.rpc("editar_valor_historico_turno", {
          p_historico_id: campo.dataset.historico,
          p_valor: Number(campo.value) || 0
        });
        if (error) throw error;
        campo.defaultValue = campo.value;
        cambiados += 1;
      }
      setStatus(cambiados
        ? `${cambiados} valor(es) guardados. El movimiento queda marcado como editado.`
        : "No había ningún valor cambiado.");
      if (cambiados) await recargar({ mantenerDetalle: true });
    } catch (error) {
      setStatus(`No se pudieron guardar los valores: ${error.message || error}`, true);
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("btnRestaurar")?.addEventListener("click", () => restaurarLote(lote));
  document.getElementById("btnEliminar")?.addEventListener("click", () => eliminarLote(lote));
};

const restaurarLote = async (lote) => {
  const aviso = lote.turno_vigente_existe
    ? "\n\nOJO: hoy existe un turno para esa fecha y jornada. Se archivará antes de devolver este."
    : "";

  const confirmado = window.confirm(
    `¿Devolver a la base principal el turno del ${formatFecha(lote.fecha_turno)}, ` +
    `jornada ${lote.numero_turno}? Son ${lote.filas} filas.${aviso}`
  );
  if (!confirmado) return;

  const motivo = window.prompt("Motivo de la restauración (opcional):", "") ?? "";

  setLoading(true, "Devolviendo el turno a la base...");
  try {
    const { data, error } = await supabase.rpc("restaurar_turno_historico", {
      p_lote_id: lote.lote_id,
      p_motivo: motivo
    });
    if (error) throw error;
    setStatus(data?.message || "Turno restaurado.");
    await recargar();
  } catch (error) {
    setStatus(`No se pudo restaurar: ${error.message || error}`, true);
  } finally {
    setLoading(false);
  }
};

const eliminarLote = async (lote) => {
  const confirmado = window.confirm(
    `Se van a eliminar ${lote.filas} filas del turno del ${formatFecha(lote.fecha_turno)}, ` +
    `jornada ${lote.numero_turno}.\n\nEsta acción NO se puede deshacer: es la única ` +
    `del sistema que borra datos de verdad. ¿Continuar?`
  );
  if (!confirmado) return;

  setLoading(true, "Eliminando...");
  try {
    const { error } = await supabase
      .from("cierres_turno_historico")
      .delete()
      .eq("lote_id", lote.lote_id);
    if (error) throw error;

    // Los apoyos del mismo movimiento comparten lote y se van con él.
    await supabase.from("apoyos_turno_historico").delete().eq("lote_id", lote.lote_id);

    setStatus("Movimiento eliminado del histórico.");
    state.loteAbierto = null;
    if (detalleLote) {
      detalleLote.innerHTML = "Selecciona un movimiento de la tabla para ver su detalle.";
    }
    await recargar();
  } catch (error) {
    setStatus(`No se pudo eliminar: ${error.message || error}`, true);
  } finally {
    setLoading(false);
  }
};

// ===============================
// ARRANQUE
// ===============================
const recargar = async ({ mantenerDetalle = false } = {}) => {
  state.lotes = await cargarLotes();
  poblarFiltrosDinamicos();
  aplicarFiltros();

  if (mantenerDetalle && state.loteAbierto) {
    await renderDetalle(state.loteAbierto);
  } else if (state.loteAbierto && !state.lotes.some((l) => l.lote_id === state.loteAbierto)) {
    state.loteAbierto = null;
  }
};

const engancharEventos = () => {
  [filtroSede, filtroResponsable, filtroMotivo, filtroEstado, filtroJornada,
   filtroFechaDesde, filtroFechaHasta].forEach((el) => {
    el?.addEventListener("change", aplicarFiltros);
  });
  filtroTexto?.addEventListener("input", aplicarFiltros);

  btnLimpiar?.addEventListener("click", () => {
    [filtroSede, filtroResponsable, filtroMotivo, filtroEstado, filtroJornada,
     filtroFechaDesde, filtroFechaHasta, filtroTexto].forEach((el) => {
      if (el) el.value = "";
    });
    aplicarFiltros();
  });

  lotesBody?.addEventListener("click", (evento) => {
    const fila = evento.target.closest(".fila-lote");
    if (fila?.dataset.lote) renderDetalle(fila.dataset.lote);
  });

  lotesBody?.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const fila = evento.target.closest(".fila-lote");
    if (fila?.dataset.lote) {
      evento.preventDefault();
      renderDetalle(fila.dataset.lote);
    }
  });

  paginacion?.addEventListener("click", (evento) => {
    const accion = evento.target?.dataset?.pagina;
    if (!accion) return;
    state.pagina += accion === "siguiente" ? 1 : -1;
    if (state.pagina < 1) state.pagina = 1;
    renderTabla();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
};

const iniciar = async () => {
  setLoading(true);
  try {
    state.contexto = await getUserContext();

    if (!state.contexto) {
      setStatus("No se pudo validar la sesión.", true);
      return;
    }

    // El RLS ya bloquea los datos, pero sin este aviso un operativo vería una
    // tabla vacía sin entender por qué.
    if (!esAdmin(state.contexto.rol)) {
      contenido?.classList.add("is-hidden");
      sinAcceso?.classList.remove("is-hidden");
      return;
    }

    engancharEventos();
    await recargar();
    setStatus("");
  } catch (error) {
    setStatus(`No se pudo cargar la auditoría: ${error.message || error}`, true);
  } finally {
    setLoading(false);
  }
};

iniciar();
