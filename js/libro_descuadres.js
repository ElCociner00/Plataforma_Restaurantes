import { supabase } from "./supabase.js";
import { getUserContext, listAvailableLocalContexts } from "./session.js";

const state = {
  context: null,
  sedesMap: {}, // Para mapear empresa_id a nombre de sede
  descuadres: [],
  vistaActual: "pendientes",
  sedeActual: "",
  editingRows: [], // to hold rows being edited
  editingIsLocal: false // to track table origin for edit modal
};

// UI Elements
const vistaSelect = document.getElementById("vistaSelect");
const sedeSelect = document.getElementById("sedeSelect");
const responsableSelect = document.getElementById("responsableSelect");
const fechaInicioInput = document.getElementById("fechaInicio");
const fechaFinInput = document.getElementById("fechaFin");
const ordenSelect = document.getElementById("ordenSelect");
const consultarBtn = document.getElementById("consultarBtn");
const exportarBtn = document.getElementById("exportarBtn");
const tbody = document.getElementById("descuadresBody");
const statusMessage = document.getElementById("statusMessage");
const loadingOverlay = document.getElementById("loadingOverlay");

// Modal Elements
const editModal = document.getElementById("editModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const saveModalBtn = document.getElementById("saveModalBtn");
const editModalBody = document.getElementById("editModalBody");

const setStatus = (message, type = "info") => {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = `status-message text-${type}`;
};

const showLoading = (show) => {
  if (loadingOverlay) loadingOverlay.classList.toggle("is-hidden", !show);
};

const money = (val) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(val || 0));

const escapeHtml = (unsafe) => {
  return String(unsafe || "").replace(/[&<"'>]/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", '"': "&quot;", "'": "&#39;", ">": "&gt;" }[m];
  });
};

// ============================
// CARGA DE SEDES (usa session.js)
// ============================
const loadSedes = async () => {
  try {
    const locales = await listAvailableLocalContexts();
    if (locales && locales.length > 0) {
      sedeSelect.innerHTML = '<option value="">Todas las sedes</option>';
      locales.forEach(local => {
        state.sedesMap[local.empresa_id] = local.nombre + (local.tipo === "principal" ? " (Principal)" : "");
        const option = document.createElement("option");
        option.value = local.empresa_id;
        option.textContent = state.sedesMap[local.empresa_id];
        sedeSelect.appendChild(option);
      });
    } else {
      sedeSelect.innerHTML = `<option value="${state.context.empresa_id}">Sede actual</option>`;
      state.sedesMap[state.context.empresa_id] = "Sede actual";
    }
  } catch (error) {
    console.error("Error cargando sedes:", error);
    sedeSelect.innerHTML = `<option value="${state.context?.empresa_id || ''}">Sede actual</option>`;
  }
};

// ============================
// CONSULTA DE DESCUADRES
// ============================
const consultarDescuadres = async () => {
  showLoading(true);
  setStatus("Consultando...", "info");

  const isSolucionados = vistaSelect.value === "solucionados";
  const responsableFilter = responsableSelect ? responsableSelect.value : null;

  try {
    let empresaFilter = sedeSelect.value || null;
    let fechaInicio = fechaInicioInput.value;
    let fechaFin = fechaFinInput.value;

    let query = supabase
      .from("v_turnos_pivote")
      .select("empresa_id, fecha_turno, numero_turno, efectivo_dif, datafono_dif, transferencias_dif, rappi_dif, nequi_dif, bono_dif, descuadre_total, cuadrado, total_global, responsable_id, es_local")
      .neq("descuadre_total", 0);

    if (empresaFilter) query = query.eq("empresa_id", empresaFilter);
    if (fechaInicio) query = query.gte("fecha_turno", fechaInicio);
    if (fechaFin) query = query.lte("fecha_turno", fechaFin);

    const { data, error } = await query.limit(1000);
    if (error) throw new Error(error.message);

    // Cruzar con cuadre_estado/cuadre_comentario de ambas tablas
    let cuadreMap = {};
    const principales = (data || []).filter(t => !t.es_local).map(t => t.empresa_id);
    const locales = (data || []).filter(t => t.es_local).map(t => t.empresa_id);

    if (principales.length > 0) {
      const { data: cuadreP } = await supabase
        .from("cierres_turno_final")
        .select("empresa_id, fecha_turno, numero_turno, cuadre_estado, cuadre_comentario")
        .in("empresa_id", [...new Set(principales)]).limit(3000);
      (cuadreP || []).forEach(row => {
        const key = `${row.empresa_id}|${row.fecha_turno}|${row.numero_turno}`;
        if (!cuadreMap[key]) cuadreMap[key] = { estado: row.cuadre_estado, comentario: row.cuadre_comentario };
      });
    }

    if (locales.length > 0) {
      const { data: cuadreL } = await supabase
        .from("cierres_turno_final_locales")
        .select("empresa_id, fecha_turno, numero_turno, cuadre_estado, cuadre_comentario")
        .in("empresa_id", [...new Set(locales)]).limit(3000);
      (cuadreL || []).forEach(row => {
        const key = `${row.empresa_id}|${row.fecha_turno}|${row.numero_turno}`;
        if (!cuadreMap[key]) cuadreMap[key] = { estado: row.cuadre_estado, comentario: row.cuadre_comentario };
      });
    }
    
    // Obtener nombres de responsables desde 'empleados', 'usuarios_sistema' y 'usuarios_locales'
    const responsableIds = [...new Set((data || []).map(t => t.responsable_id).filter(Boolean))];
    let usuariosMap = {};
    
    if (responsableIds.length > 0) {
      // 1. Buscar en empleados
      const { data: empData } = await supabase.from("empleados").select("id, nombre_completo").in("id", responsableIds);
      (empData || []).forEach(u => usuariosMap[u.id] = u.nombre_completo);
      
      // 2. Buscar faltantes en usuarios_sistema
      let faltantes = responsableIds.filter(id => !usuariosMap[id]);
      if (faltantes.length > 0) {
        const { data: usrData } = await supabase.from("usuarios_sistema").select("id, nombre_completo").in("id", faltantes);
        (usrData || []).forEach(u => usuariosMap[u.id] = u.nombre_completo);
      }

      // 3. Buscar faltantes en usuarios_locales
      faltantes = responsableIds.filter(id => !usuariosMap[id]);
      if (faltantes.length > 0) {
        const { data: locData } = await supabase.from("usuarios_locales").select("id, nombre_completo").in("id", faltantes);
        (locData || []).forEach(u => usuariosMap[u.id] = u.nombre_completo);
      }
    }

    // Actualizar el select de Responsables dinámicamente preservando la selección si aplica
    if (responsableSelect) {
      const currentRespVal = responsableSelect.value;
      responsableSelect.innerHTML = '<option value="">Todos los responsables</option>';
      
      const uniqueResps = [...new Set(Object.values(usuariosMap))].sort();
      uniqueResps.forEach(nombre => {
        const option = document.createElement("option");
        option.value = nombre;
        option.textContent = nombre;
        if (nombre === currentRespVal) option.selected = true;
        responsableSelect.appendChild(option);
      });
    }

    // Enriquecer
    let enriched = (data || []).map(t => {
      const key = `${t.empresa_id}|${t.fecha_turno}|${t.numero_turno}`;
      const cuadre = cuadreMap[key] || {};
      return { 
        ...t, 
        cuadre_estado: cuadre.estado || false, 
        cuadre_comentario: cuadre.comentario || "",
        responsable_nombre: usuariosMap[t.responsable_id] || "Desconocido",
        sede_nombre: state.sedesMap[t.empresa_id] || "Desconocida"
      };
    });

    // Aplicar filtros locales de memoria (Vista y Responsable)
    if (isSolucionados) {
      enriched = enriched.filter(t => t.cuadre_estado === true);
    } else {
      enriched = enriched.filter(t => !t.cuadre_estado);
    }
    
    if (responsableSelect && responsableSelect.value) {
      enriched = enriched.filter(t => t.responsable_nombre === responsableSelect.value);
    }

    let orden = ordenSelect.value;
    enriched.sort((a, b) => {
      if (orden === "fecha_desc") return new Date(b.fecha_turno) - new Date(a.fecha_turno);
      if (orden === "fecha_asc") return new Date(a.fecha_turno) - new Date(b.fecha_turno);
      if (orden === "valor_desc") return Math.abs(b.descuadre_total) - Math.abs(a.descuadre_total);
      if (orden === "valor_asc") return Math.abs(a.descuadre_total) - Math.abs(b.descuadre_total);
      return 0;
    });

    state.descuadres = enriched;
    renderTable();
    setStatus(`Consulta exitosa: ${state.descuadres.length} turnos encontrados.`, "success");
  } catch (error) {
    console.error("Error consultando descuadres:", error);
    setStatus("Error al consultar: " + error.message, "danger");
  } finally {
    showLoading(false);
  }
};

// ============================
// EXPORTAR A EXCEL (CSV)
// ============================
const exportarExcel = () => {
  if (state.descuadres.length === 0) {
    alert("No hay datos para exportar.");
    return;
  }
  
  const data = state.descuadres.map(row => ({
    "Fecha": row.fecha_turno,
    "Sede": row.sede_nombre,
    "Responsable": row.responsable_nombre,
    "Turno": row.numero_turno,
    "Descuadre Neto": row.descuadre_total,
    "Comentario": row.cuadre_comentario || '',
    "Estado": row.cuadre_estado ? "Cuadrado" : "Pendiente"
  }));
  
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Descuadres");
  
  XLSX.writeFile(wb, `Libro_Descuadres_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// ============================
// RENDERIZAR TABLA
// ============================
const renderTable = () => {
  if (!tbody) return;

  if (state.descuadres.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--ek-muted);">No se encontraron turnos con descuadre para la vista actual.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.descuadres.map((row, index) => {
    const fecha = row.fecha_turno;
    const sede = row.sede_nombre;
    const turno = `Turno ${row.numero_turno || '?'}`;
    const descuadreNeto = Number(row.descuadre_total || 0);
    const colorClase = descuadreNeto < 0 ? "text-danger" : "text-warning";
    const isSolucionado = row.cuadre_estado === true;

    const canales = [];
    if (Number(row.efectivo_dif || 0) !== 0) canales.push(`Efect: ${money(row.efectivo_dif)}`);
    if (Number(row.datafono_dif || 0) !== 0) canales.push(`Datáf: ${money(row.datafono_dif)}`);
    if (Number(row.transferencias_dif || 0) !== 0) canales.push(`Transf: ${money(row.transferencias_dif)}`);
    if (Number(row.rappi_dif || 0) !== 0) canales.push(`Rappi: ${money(row.rappi_dif)}`);
    if (Number(row.nequi_dif || 0) !== 0) canales.push(`Nequi: ${money(row.nequi_dif)}`);
    if (Number(row.bono_dif || 0) !== 0) canales.push(`Bono: ${money(row.bono_dif)}`);
    const detalleCanal = canales.length > 0 ? canales.join("<br>") : "—";

    return `
      <tr data-empresa="${row.empresa_id}" data-fecha="${row.fecha_turno}" data-turno="${row.numero_turno}" data-index="${index}">
        <td style="white-space: nowrap;">${fecha}</td>
        <td style="font-size: 0.85rem; color: var(--ek-muted);">${escapeHtml(sede)}</td>
        <td>
          <span style="font-size: 0.85rem; background: #f3e8ff; color: #5b3a8f; padding: 0.25rem 0.6rem; border-radius: 99px; display: inline-block; font-weight: 500;">
            ${escapeHtml(row.responsable_nombre)}
          </span>
        </td>
        <td style="white-space: nowrap;">${turno}</td>
        <td class="${colorClase}" style="font-weight: 600;">${money(descuadreNeto)}</td>
        <td style="font-size: 0.82rem; line-height: 1.5;">${detalleCanal}</td>
        <td>
          <textarea class="comentario-input" placeholder="Justificación..." ${isSolucionado ? "disabled" : ""}>${escapeHtml(row.cuadre_comentario || "")}</textarea>
        </td>
        <td class="descuadre-actions" style="text-align: right; white-space: nowrap;">
          ${isSolucionado
            ? `<span class="badge-solucionado" style="margin-right: 0.5rem;"><i class="ph ph-check-circle"></i></span>
               <button class="btn-icon btn-reabrir" title="Reabrir" type="button"><i class="ph ph-arrow-counter-clockwise"></i></button>`
            : `<button class="btn-icon btn-guardar" title="Cerrar Descuadre" type="button"><i class="ph ph-check-circle"></i></button>
               <button class="btn-icon btn-actualizar" title="Guardar Nota" type="button"><i class="ph ph-floppy-disk"></i></button>
               <button class="btn-icon btn-editar" title="Editar Cierre" type="button"><i class="ph ph-pencil-simple"></i></button>`
          }
        </td>
      </tr>
    `;
  }).join("");
};

// ============================
// ACCIONES EN TABLA
// ============================
const handleTableClick = async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  
  const tr = btn.closest("tr[data-empresa]");
  if (!tr) return;

  const empresaId = tr.dataset.empresa;
  const fechaTurno = tr.dataset.fecha;
  const numTurno = tr.dataset.turno;
  const index = tr.dataset.index;
  const row = state.descuadres[index];
  
  const targetTable = row.es_local ? "cierres_turno_final_locales" : "cierres_turno_final";

  const comentarioInput = tr.querySelector(".comentario-input");
  const nuevoComentario = comentarioInput ? comentarioInput.value.trim() : "";

  if (btn.classList.contains("btn-guardar")) {
    if (!nuevoComentario) {
      alert("Debes escribir un comentario/justificación antes de cerrar el descuadre.");
      return;
    }
    if (confirm("¿Marcar este turno como cuadrado? Se moverá al histórico de solucionados.")) {
      btn.disabled = true;
      try {
        const { error } = await supabase.from(targetTable).update({
          cuadre_estado: true,
          cuadre_comentario: nuevoComentario
        }).eq("empresa_id", empresaId).eq("fecha_turno", fechaTurno).eq("numero_turno", numTurno);
        if (error) throw new Error(error.message);
        tr.remove();
        setStatus("Turno marcado como cerrado.", "success");
      } catch (err) {
        alert("Error: " + err.message);
        btn.disabled = false;
      }
    }
  } else if (btn.classList.contains("btn-actualizar")) {
    btn.disabled = true;
    try {
      const { error } = await supabase.from(targetTable).update({
        cuadre_comentario: nuevoComentario
      }).eq("empresa_id", empresaId).eq("fecha_turno", fechaTurno).eq("numero_turno", numTurno);
      if (error) throw new Error(error.message);
      setStatus("Nota guardada correctamente.", "success");
      row.cuadre_comentario = nuevoComentario;
    } catch (err) {
      alert("Error al actualizar: " + err.message);
    } finally {
      btn.disabled = false;
    }
  } else if (btn.classList.contains("btn-reabrir")) {
    if (confirm("¿Devolver este turno a la lista de pendientes?")) {
      btn.disabled = true;
      try {
        const { error } = await supabase.from(targetTable).update({
          cuadre_estado: false
        }).eq("empresa_id", empresaId).eq("fecha_turno", fechaTurno).eq("numero_turno", numTurno);
        if (error) throw new Error(error.message);
        tr.remove();
        setStatus("Turno reabierto.", "success");
      } catch (err) {
        alert("Error: " + err.message);
        btn.disabled = false;
      }
    }
  } else if (btn.classList.contains("btn-editar")) {
    openEditModal(empresaId, fechaTurno, numTurno, row.es_local);
  }
};

// ============================
// MODAL DE EDICIÓN
// ============================
const openEditModal = async (empresaId, fechaTurno, numTurno, isLocal) => {
  showLoading(true);
  try {
    state.editingIsLocal = isLocal;
    const targetTable = isLocal ? "cierres_turno_final_locales" : "cierres_turno_final";
    
    const { data, error } = await supabase
      .from(targetTable)
      .select("id, variable, categoria, valor")
      .eq("empresa_id", empresaId)
      .eq("fecha_turno", fechaTurno)
      .eq("numero_turno", numTurno)
      .order("variable")
      .order("categoria");

    if (error) throw new Error(error.message);
    
    state.editingRows = data;

    let html = `<table class="data-table" style="font-size: 0.9rem;">
      <thead>
        <tr><th style="text-align: left;">Variable</th><th style="text-align: left;">Categoría</th><th style="text-align: left;">Valor (Real/Ingresado)</th></tr>
      </thead>
      <tbody>`;
    
    data.forEach(row => {
      html += `
        <tr>
          <td>${row.variable}</td>
          <td>${row.categoria}</td>
          <td>
            <input type="number" class="input-modern edit-valor-input" data-id="${row.id}" value="${row.valor}" style="padding: 0.4rem; width: 100%; max-width: 150px;">
          </td>
        </tr>
      `;
    });
    html += `</tbody></table>`;
    
    editModalBody.innerHTML = html;
    editModal.classList.remove("is-hidden");
    
  } catch (error) {
    console.error("Error cargando variables:", error);
    alert("Error al abrir modal: " + error.message);
  } finally {
    showLoading(false);
  }
};

const closeEditModal = () => {
  editModal.classList.add("is-hidden");
  editModalBody.innerHTML = "";
  state.editingRows = [];
  state.editingIsLocal = false;
};

const saveEdits = async () => {
  const inputs = editModalBody.querySelectorAll(".edit-valor-input");
  const updates = [];
  
  inputs.forEach(input => {
    const originalRow = state.editingRows.find(r => String(r.id) === input.dataset.id);
    const newValue = Number(input.value);
    if (originalRow && Number(originalRow.valor) !== newValue) {
      updates.push({
        id: originalRow.id,
        valor: newValue
      });
    }
  });

  if (updates.length === 0) {
    closeEditModal();
    return;
  }

  saveModalBtn.disabled = true;
  saveModalBtn.textContent = "Guardando...";

  try {
    const targetTable = state.editingIsLocal ? "cierres_turno_final_locales" : "cierres_turno_final";
    
    const promises = updates.map(u => 
      supabase.from(targetTable).update({ valor: u.valor }).eq("id", u.id)
    );
    await Promise.all(promises);
    
    setStatus(`Cierre editado correctamente (${updates.length} valores modificados).`, "success");
    closeEditModal();
    consultarDescuadres(); // Recargar la tabla
  } catch (err) {
    console.error(err);
    alert("Error guardando cambios: " + err.message);
  } finally {
    saveModalBtn.disabled = false;
    saveModalBtn.textContent = "Guardar Cambios";
  }
};

// ============================
// INIT
// ============================
const init = async () => {
  state.context = await getUserContext().catch(() => null);

  if (!state.context || (state.context.rol !== "admin" && state.context.rol !== "admin_root")) {
    document.body.innerHTML = "<h2 style='padding: 2rem;'>Acceso denegado. Solo administradores pueden ver esta sección.</h2>";
    document.body.style.display = "block";
    return;
  }

  document.body.style.display = "block";

  await loadSedes();

  // Listeners
  consultarBtn.addEventListener("click", consultarDescuadres);
  if (exportarBtn) exportarBtn.addEventListener("click", exportarExcel);
  tbody.addEventListener("click", handleTableClick);
  
  closeModalBtn.addEventListener("click", closeEditModal);
  cancelModalBtn.addEventListener("click", closeEditModal);
  saveModalBtn.addEventListener("click", saveEdits);
};

init();

