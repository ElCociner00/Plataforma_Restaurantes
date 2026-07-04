/**
 * Cierre turno auxiliar: contingencia manual sin n8n.
 * Guarda directamente en Supabase `cierres_turno_final`.
 */
import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { fetchResponsablesActivos } from "./responsables.js";
import { getEmpresaPolicy, puedeEnviarDatos } from "./permisos.core.js";
import { descargarImagenResumenCierreTurno } from "./cierre_turno_png.js";

const log = (...args) => console.info("[cierre_turno_auxiliar]", ...args);
const warn = (...args) => console.warn("[cierre_turno_auxiliar]", ...args);
const errorLog = (...args) => console.error("[cierre_turno_auxiliar]", ...args);
const enforceOneNumericInput = (element) => enforceNumericInput([element]);

document.addEventListener("DOMContentLoaded", () => {
  const fecha = document.getElementById("fecha");
  const responsable = document.getElementById("responsable");
  const horaInicio = document.getElementById("hora_inicio");
  const horaFin = document.getElementById("hora_fin");
  const horaLlegadaHora = document.getElementById("hora_llegada_hora");
  const horaLlegadaMinuto = document.getElementById("hora_llegada_minuto");
  const horaLlegadaMomento = document.getElementById("hora_llegada_momento");
  const efectivoApertura = document.getElementById("efectivo_apertura");
  const bolsa = document.getElementById("bolsa");
  const caja = document.getElementById("caja");
  const status = document.getElementById("status");
  const extrasList = document.getElementById("extrasList");
  const btnVerificar = document.getElementById("verificar");
  const btnEnviar = document.getElementById("enviar");
  const btnLimpiar = document.getElementById("limpiarDatos");
  const confirmacionEnvio = document.getElementById("confirmacionEnvio");
  const mensajeEnvio = document.getElementById("mensajeEnvio");
  const btnConfirmarEnvio = document.getElementById("confirmarEnvio");
  const btnCancelarEnvio = document.getElementById("cancelarEnvio");
  const btnToggleEfectivoSistema = document.getElementById("toggleEfectivoSistema");
  const efectivoSistemaModo = document.getElementById("efectivoSistemaModo");
  const totalGastosExtrasEl = document.getElementById("totalGastosExtras");
  const totalIngresosSistemaEl = document.getElementById("totalIngresosSistema");
  const totalIngresosRealesEl = document.getElementById("totalIngresosReales");
  const totalGastosTurnoEl = document.getElementById("totalGastosTurno");
  const totalVentaDiaBrutaEl = document.getElementById("totalVentaDiaBruta");
  const totalVentaDiaNetaEl = document.getElementById("totalVentaDiaNeta");
  const totalDiferenciaGeneralEl = document.getElementById("totalDiferenciaGeneral");
  const apoyoHubo = document.getElementById("apoyo_hubo");
  const apoyoCantidad = document.getElementById("apoyo_cantidad");
  const apoyoCantidadWrap = document.getElementById("apoyoCantidadWrap");
  const apoyoTablaWrap = document.getElementById("apoyoTablaWrap");
  const apoyoRowsContainer = document.getElementById("apoyoRows");
  const apoyosConsultaBox = document.getElementById("apoyosConsultaBox");
  const btnConsultarPropinaApoyos = document.getElementById("consultarPropinaApoyos");
  const apoyosConsultaNota = document.getElementById("apoyosConsultaNota");
  const correccionWrap = document.getElementById("correccionWrap");
  const modalCorreccion = document.getElementById("modalCorreccion");
  const comentarios = document.querySelector("textarea");

  const inputsFinanzas = {
    efectivo: { sistema: document.getElementById("efectivo_sistema"), real: document.getElementById("efectivo_real") },
    datafono: { sistema: document.getElementById("datafono_sistema"), real: document.getElementById("datafono_real") },
    rappi: { sistema: document.getElementById("rappi_sistema"), real: document.getElementById("rappi_real") },
    nequi: { sistema: document.getElementById("nequi_sistema"), real: document.getElementById("nequi_real") },
    transferencias: { sistema: document.getElementById("transferencias_sistema"), real: document.getElementById("transferencias_real") },
    bono_regalo: { sistema: document.getElementById("bono_regalo_sistema"), real: document.getElementById("bono_regalo_real") }
  };
  const inputsSoloVista = { propina: document.getElementById("propina"), domicilios: document.getElementById("domicilios") };
  const inputsDiferencias = {
    efectivo: { input: document.getElementById("efectivo_diferencia"), nota: document.getElementById("efectivo_diferencia_nota") },
    datafono: { input: document.getElementById("datafono_diferencia"), nota: document.getElementById("datafono_diferencia_nota") },
    rappi: { input: document.getElementById("rappi_diferencia"), nota: document.getElementById("rappi_diferencia_nota") },
    nequi: { input: document.getElementById("nequi_diferencia"), nota: document.getElementById("nequi_diferencia_nota") },
    transferencias: { input: document.getElementById("transferencias_diferencia"), nota: document.getElementById("transferencias_diferencia_nota") },
    bono_regalo: { input: document.getElementById("bono_regalo_diferencia"), nota: document.getElementById("bono_regalo_diferencia_nota") }
  };

  const DEFAULT_VISIBILITY = { efectivo: true, datafono: true, rappi: true, nequi: true, transferencias: true, bono_regalo: true, propina: true, domicilios: true };
  const DEFAULT_EXTRAS = [
    { id: "general", nombre: "General" },
    { id: "aseo", nombre: "Aseo" },
    { id: "insumos", nombre: "Insumos" },
    { id: "domicilios_operativos", nombre: "Domicilios operativos" },
    { id: "domicilios_clientes", nombre: "Domicilios clientes" },
    { id: "desechables", nombre: "Desechables" },
    { id: "arriendo", nombre: "Arriendo" },
    { id: "insumos_especiales", nombre: "Insumos especiales" }
  ];
  const EXTRAS_STORAGE_KEY = "cierre_turno_extras_visibilidad";
  const MEDIOS_PAGO = ["efectivo", "datafono", "rappi", "nequi", "transferencias", "bono_regalo"];
  const extrasRows = new Map();
  let contextPayload = null;
  let responsablesActivos = [];
  let empresaPolicy = { plan: "free", activa: true, solo_lectura: true };
  let verificado = false;
  let modoEfectivoSistema = "manual";

  const setStatus = (message, type = "info") => {
    if (!status) return;
    status.textContent = message || "";
    status.dataset.type = type;
    log("status", type, message || "");
  };

  const toNumberValue = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/[^0-9,.-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") return 0;
    const sign = cleaned.startsWith("-") ? "-" : "";
    const unsigned = cleaned.replace(/-/g, "");
    const lastDot = unsigned.lastIndexOf(".");
    const lastComma = unsigned.lastIndexOf(",");
    let normalized = unsigned;
    if (lastDot >= 0 && lastComma >= 0) {
      const decimalSeparator = lastDot > lastComma ? "." : ",";
      const thousandsSeparator = decimalSeparator === "." ? "," : ".";
      normalized = unsigned.split(thousandsSeparator).join("");
      if (decimalSeparator === ",") normalized = normalized.replace(/,/g, ".");
    } else if (lastComma >= 0) {
      normalized = unsigned.replace(/\./g, "").replace(/,/g, ".");
    } else if (lastDot >= 0) {
      normalized = unsigned.replace(/,/g, "");
    }
    const parsed = Number(`${sign}${normalized}`);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatCOP = (value) => {
    const amount = Math.round(toNumberValue(value));
    const miles = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${amount < 0 ? "-" : ""}$${miles},00`;
  };
  const formatDurationLabel = (minutesValue) => {
    const minutes = Math.max(0, Number(minutesValue) || 0);
    return `${Math.floor(minutes / 60)} horas ${minutes % 60} minutos`;
  };
  const getTimestamp = () => new Date().toISOString();

  const getVisibilitySettings = () => {
    try { return { ...DEFAULT_VISIBILITY, ...JSON.parse(localStorage.getItem("cierre_turno_visibilidad") || "{}") }; }
    catch (_error) { return { ...DEFAULT_VISIBILITY }; }
  };
  const getExtrasVisibilitySettings = () => {
    try { return JSON.parse(localStorage.getItem(EXTRAS_STORAGE_KEY) || "{}"); }
    catch (_error) { return {}; }
  };

  const getTotalGastosExtras = () => Array.from(extrasRows.values())
    .filter((row) => row.visible)
    .reduce((sum, row) => sum + toNumberValue(row.input?.value ?? row.value), 0);
  const getTotalIngresosSistema = () => MEDIOS_PAGO.reduce((sum, medio) => sum + toNumberValue(inputsFinanzas[medio]?.sistema?.value), 0);
  const getTotalIngresosReales = () => MEDIOS_PAGO.reduce((sum, medio) => sum + toNumberValue(inputsFinanzas[medio]?.real?.value), 0);

  const renderTotalizados = () => {
    const totalSistema = getTotalIngresosSistema();
    const totalReal = getTotalIngresosReales();
    const totalGastos = getTotalGastosExtras();
    if (totalIngresosSistemaEl) totalIngresosSistemaEl.textContent = formatCOP(totalSistema);
    if (totalIngresosRealesEl) totalIngresosRealesEl.textContent = formatCOP(totalReal);
    if (totalGastosTurnoEl) totalGastosTurnoEl.textContent = formatCOP(totalGastos);
    if (totalVentaDiaBrutaEl) totalVentaDiaBrutaEl.textContent = formatCOP(totalReal);
    if (totalVentaDiaNetaEl) totalVentaDiaNetaEl.textContent = formatCOP(totalReal - totalGastos);
    if (totalDiferenciaGeneralEl) totalDiferenciaGeneralEl.textContent = formatCOP(totalReal - totalSistema);
    if (totalGastosExtrasEl) totalGastosExtrasEl.textContent = String(totalGastos);
  };

  const actualizarEstadoDiferencia = (field, rawValue) => {
    const target = inputsDiferencias[field];
    if (!target?.input) return;
    const value = toNumberValue(rawValue);
    target.input.value = String(value);
    target.input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
    if (value < 0) { target.input.classList.add("diff-faltante"); if (target.nota) target.nota.textContent = "Aquí hay un faltante!"; return; }
    if (value > 0) { target.input.classList.add("diff-sobrante"); if (target.nota) target.nota.textContent = "Aquí hay un sobrante"; return; }
    target.input.classList.add("diff-ok");
    if (target.nota) target.nota.textContent = "Muy bien, todo en orden";
  };

  const recalcularDiferencias = () => {
    MEDIOS_PAGO.forEach((medio) => {
      const sistema = toNumberValue(inputsFinanzas[medio]?.sistema?.value);
      const real = toNumberValue(inputsFinanzas[medio]?.real?.value);
      actualizarEstadoDiferencia(medio, real - sistema);
    });
    renderTotalizados();
  };

  const buildExtrasRows = () => {
    if (!extrasList) return;
    const visibility = getExtrasVisibilitySettings();
    extrasList.innerHTML = "";
    extrasRows.clear();
    DEFAULT_EXTRAS.forEach((item) => {
      const visible = visibility[item.id] !== false;
      let input = null;
      if (visible) {
        const row = document.createElement("div");
        row.className = "extra-row";
        const label = document.createElement("span");
        label.textContent = item.nombre;
        input = document.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.pattern = "[0-9]*";
        input.value = "0";
        enforceOneNumericInput(input);
        input.addEventListener("input", () => { verificado = false; renderTotalizados(); });
        row.append(label, input);
        extrasList.appendChild(row);
      }
      extrasRows.set(item.id, { nombre: item.nombre, input, visible, value: 0 });
    });
    renderTotalizados();
  };

  const getHoraLlegadaCompleta = () => {
    const hour = horaLlegadaHora?.value || "";
    const minute = horaLlegadaMinuto?.value || "";
    const momento = horaLlegadaMomento?.value || "";
    return hour && minute && momento ? `${hour}:${minute} ${momento}` : "";
  };
  const populateHoraLlegadaOptions = () => {
    if (horaLlegadaHora) {
      horaLlegadaHora.innerHTML = '<option value="">Hora</option>';
      for (let hour = 1; hour <= 12; hour += 1) horaLlegadaHora.insertAdjacentHTML("beforeend", `<option value="${String(hour).padStart(2, "0")}">${String(hour).padStart(2, "0")}</option>`);
    }
    if (horaLlegadaMinuto) {
      horaLlegadaMinuto.innerHTML = '<option value="">Min</option>';
      for (let minute = 0; minute <= 59; minute += 1) horaLlegadaMinuto.insertAdjacentHTML("beforeend", `<option value="${String(minute).padStart(2, "0")}">${String(minute).padStart(2, "0")}</option>`);
    }
    if (horaLlegadaMomento) horaLlegadaMomento.value = "AM";
  };

  const applyVisibilitySettings = () => {
    const settings = getVisibilitySettings();
    document.querySelectorAll(".finanzas-row").forEach((row) => {
      const field = row.dataset.field;
      const visible = settings[field] !== false;
      row.classList.toggle("is-hidden", !visible);
      if (!visible) {
        if (inputsFinanzas[field]) {
          inputsFinanzas[field].sistema.value = "0";
          inputsFinanzas[field].real.value = "0";
        }
        if (inputsSoloVista[field]) inputsSoloVista[field].value = "0";
        if (inputsDiferencias[field]) actualizarEstadoDiferencia(field, 0);
      }
    });
    renderTotalizados();
    return settings;
  };

  const buildHourOptions = () => Array.from({ length: 12 }, (_v, i) => String(i + 1).padStart(2, "0"))
    .map((value) => `<option value="${value}">${value}</option>`).join("");
  const buildMinuteOptions = () => Array.from({ length: 12 }, (_v, i) => String(i * 5).padStart(2, "0"))
    .map((value) => `<option value="${value}">${value}</option>`).join("");
  const getResponsableOptionsHtml = (selectedValue = "") => '<option value="">Selecciona responsable</option>' + responsablesActivos.map((item) => {
    const id = String(item?.id || "");
    return `<option value="${id}" ${id === String(selectedValue) ? "selected" : ""}>${item?.nombre_completo || id}</option>`;
  }).join("");
  const toMinutesFromRangeParts = (hour12, minute, ampm) => {
    const h = Number(hour12); const m = Number(minute);
    if (!h || Number.isNaN(m) || !ampm) return null;
    let hour24 = h % 12;
    if (String(ampm).toUpperCase() === "PM") hour24 += 12;
    return (hour24 * 60) + m;
  };
  const readApoyoRange = (row) => {
    const inicioHora = row.querySelector('[data-field="inicio_hora"]')?.value || "";
    const inicioMin = row.querySelector('[data-field="inicio_min"]')?.value || "";
    const inicioMom = row.querySelector('[data-field="inicio_momento"]')?.value || "";
    const finHora = row.querySelector('[data-field="fin_hora"]')?.value || "";
    const finMin = row.querySelector('[data-field="fin_min"]')?.value || "";
    const finMom = row.querySelector('[data-field="fin_momento"]')?.value || "";
    const start = toMinutesFromRangeParts(inicioHora, inicioMin, inicioMom);
    const endRaw = toMinutesFromRangeParts(finHora, finMin, finMom);
    if (start === null || endRaw === null) return { complete: false };
    const end = endRaw >= start ? endRaw : endRaw + (24 * 60);
    const inicioTexto = `${inicioHora}:${inicioMin} ${inicioMom}`;
    const finTexto = `${finHora}:${finMin} ${finMom}`;
    return { complete: true, durationMinutes: end - start, durationText: formatDurationLabel(end - start), rangoTexto: `${inicioTexto} - ${finTexto}` };
  };
  const createApoyoRow = (index) => {
    const row = document.createElement("div");
    row.className = "apoyo-row";
    row.dataset.index = String(index);
    row.innerHTML = `
      <select data-field="responsable">${getResponsableOptionsHtml()}</select>
      <input data-field="propina" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Propina manual" value="0">
      <div class="apoyo-rango-wrap">
        <div class="apoyo-rango-grid">
          <div class="apoyo-rango-box"><small>Inicio</small><div class="apoyo-rango-selects"><select data-field="inicio_hora"><option value="">Hora</option>${buildHourOptions()}</select><select data-field="inicio_min"><option value="">Min</option>${buildMinuteOptions()}</select><select data-field="inicio_momento"><option value="AM">AM</option><option value="PM">PM</option></select></div></div>
          <div class="apoyo-rango-box"><small>Fin</small><div class="apoyo-rango-selects"><select data-field="fin_hora"><option value="">Hora</option>${buildHourOptions()}</select><select data-field="fin_min"><option value="">Min</option>${buildMinuteOptions()}</select><select data-field="fin_momento"><option value="AM">AM</option><option value="PM">PM</option></select></div></div>
        </div>
      </div>`;
    const propinaInput = row.querySelector('[data-field="propina"]');
    enforceOneNumericInput(propinaInput);
    row.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", () => { verificado = false; }));
    row.querySelectorAll("select").forEach((el) => el.addEventListener("change", () => { verificado = false; }));
    return row;
  };
  const renderApoyoRows = (count) => {
    apoyoRowsContainer.innerHTML = "";
    const safeCount = Math.max(0, Math.min(30, Number(count) || 0));
    for (let i = 0; i < safeCount; i += 1) apoyoRowsContainer.appendChild(createApoyoRow(i + 1));
    apoyoTablaWrap?.classList.toggle("is-hidden", safeCount === 0);
  };
  const validateApoyoRows = () => {
    if (apoyoHubo?.value !== "si") return true;
    const cantidad = Number(apoyoCantidad?.value || 0);
    if (!cantidad) { setStatus("Indica cuántas personas participaron como apoyo.", "error"); return false; }
    const rows = Array.from(apoyoRowsContainer?.querySelectorAll(".apoyo-row") || []);
    for (let i = 0; i < rows.length; i += 1) {
      if (!rows[i].querySelector('[data-field="responsable"]')?.value || !readApoyoRange(rows[i]).complete) {
        setStatus(`Completa responsable y horario del apoyo #${i + 1}.`, "error");
        return false;
      }
    }
    return true;
  };

  const getMissingRequiredLabels = () => {
    const settings = getVisibilitySettings();
    const required = [
      ["Fecha", fecha?.value], ["Responsable", responsable?.value], ["Hora de llegada", getHoraLlegadaCompleta()],
      ["Hora inicio", horaInicio?.value], ["Hora fin", horaFin?.value], ["Efectivo apertura", efectivoApertura?.value],
      ["Bolsa", bolsa?.value], ["Caja", caja?.value]
    ];
    MEDIOS_PAGO.forEach((medio) => {
      if (settings[medio] === false) return;
      required.push([`${medio} sistema`, inputsFinanzas[medio]?.sistema?.value]);
      required.push([`${medio} real`, inputsFinanzas[medio]?.real?.value]);
    });
    if (settings.propina !== false) required.push(["Propina", inputsSoloVista.propina?.value]);
    if (settings.domicilios !== false) required.push(["Domicilios", inputsSoloVista.domicilios?.value]);
    return required.filter(([_label, value]) => String(value ?? "").trim() === "").map(([label]) => label);
  };
  const validateCamposObligatoriosCompletos = () => {
    const missing = getMissingRequiredLabels();
    if (missing.length) { setStatus(`Completa estos campos obligatorios: ${missing.join(", ")}.`, "error"); return false; }
    return true;
  };
  const confirmarGastosVacios = () => {
    const visibles = Array.from(extrasRows.values()).filter((row) => row.visible);
    const total = visibles.reduce((sum, row) => sum + toNumberValue(row.input?.value), 0);
    if (visibles.length && total === 0) return window.confirm("Todos los gastos están en cero o vacíos. ¿Confirmas que no registrarás ningún gasto en este cierre?");
    return true;
  };
  const confirmarCerosCriticos = () => {
    if (toNumberValue(bolsa?.value) === 0 || toNumberValue(caja?.value) === 0) return window.confirm("Advertencia: estás dejando Bolsa o Caja en 0. ¿Confirmas que ese valor es correcto?");
    return true;
  };

  const obtenerCategoriaGasto = (nombre, id = "") => {
    const label = `${nombre || ""} ${id || ""}`.toLowerCase();
    if (label.includes("domicilios") && label.includes("operativ")) return "domicilios_operativos";
    if (label.includes("domicilios") && label.includes("cliente")) return "domicilios_clientes";
    if (label.includes("insumo")) return "insumos";
    if (label.includes("arriendo")) return "arriendo";
    if (label.includes("aseo") || label.includes("limpieza")) return "aseo";
    if (label.includes("desechable") || label.includes("plastico") || label.includes("plástico")) return "desechables";
    return id || "general";
  };
  const buildRowsForSupabase = () => {
    const global = {
      empresa_id: contextPayload.empresa_id,
      fecha_turno: fecha.value,
      responsable_id: responsable.value,
      comentarios: comentarios?.value || "",
      hora_inicio: horaInicio.value || "",
      hora_fin: horaFin.value || "",
      registrado_por: contextPayload.registrado_por || "",
      domicilios_global: toNumberValue(inputsSoloVista.domicilios?.value),
      efectivo_apertura: toNumberValue(efectivoApertura?.value),
      propina_global: toNumberValue(inputsSoloVista.propina?.value),
      total_global: getTotalIngresosReales(),
      bolsa_global: toNumberValue(bolsa?.value),
      caja_global: toNumberValue(caja?.value),
      hora_llegada: getHoraLlegadaCompleta()
    };
    const rows = [];
    MEDIOS_PAGO.forEach((medio) => {
      rows.push({ ...global, variable: medio, categoria: "sistema", valor: toNumberValue(inputsFinanzas[medio]?.sistema?.value) });
      rows.push({ ...global, variable: medio, categoria: "real", valor: toNumberValue(inputsFinanzas[medio]?.real?.value) });
    });
    rows.push({ ...global, variable: "propina", categoria: "global", valor: toNumberValue(inputsSoloVista.propina?.value) });
    rows.push({ ...global, variable: "domicilios", categoria: "global", valor: toNumberValue(inputsSoloVista.domicilios?.value) });
    rows.push({ ...global, variable: "bolsa", categoria: "global", valor: toNumberValue(bolsa?.value) });
    rows.push({ ...global, variable: "caja", categoria: "global", valor: toNumberValue(caja?.value) });
    Array.from(extrasRows.entries()).forEach(([id, row]) => {
      rows.push({ ...global, variable: "gasto_extra", categoria: obtenerCategoriaGasto(row.nombre, id), valor: row.visible ? toNumberValue(row.input?.value) : 0 });
    });
    return rows;
  };

  const descargarImagenResumen = () => descargarImagenResumenCierreTurno({
    snapshotContext: { inputsFinanzas, inputsDiferencias, inputsSoloVista, bolsa, caja, extrasRows, apoyoRowsContainer, responsablesActivos, readApoyoRange, formatDurationLabel, getTotalIngresosSistema, getTotalIngresosReales, getTotalGastosExtras },
    meta: {
      fecha: fecha.value,
      responsableTexto: responsable.options[responsable.selectedIndex]?.textContent || "Responsable",
      horaLlegada: getHoraLlegadaCompleta() || "-",
      horaInicio: horaInicio.value || "-",
      horaFin: horaFin.value || "-",
      empresaNombre: contextPayload?.empresa_nombre || "Empresa",
      efectivoApertura: efectivoApertura?.value || 0,
      bolsa: bolsa?.value || 0,
      caja: caja?.value || 0
    },
    formatCOP,
    setStatus
  });

  const cargarResponsables = async () => {
    const context = await getUserContext();
    if (!context?.empresa_id) throw new Error("No hay empresa activa en sesión.");
    contextPayload = {
      empresa_id: context.empresa_id,
      tenant_id: context.empresa_id,
      usuario_id: context.user?.id || context.user?.user_id || "",
      registrado_por: context.user?.id || context.user?.user_id || "",
      rol: context.rol || "",
      empresa_nombre: context.empresa_nombre || context.nombre_empresa || "Empresa",
      timestamp: getTimestamp()
    };
    responsablesActivos = await fetchResponsablesActivos(context.empresa_id).catch((error) => {
      warn("No se pudieron cargar responsables desde Supabase", error);
      return [];
    });
    responsable.innerHTML = '<option value="">Seleccione responsable</option>';
    responsablesActivos.forEach((item) => responsable.insertAdjacentHTML("beforeend", `<option value="${item.id || ""}">${item.nombre_completo || item.id || "Responsable"}</option>`));
    empresaPolicy = await getEmpresaPolicy(context.empresa_id, true).catch(() => ({ plan: "free", activa: true, solo_lectura: false }));
    log("contexto listo", { empresa_id: contextPayload.empresa_id, responsables: responsablesActivos.length, policy: empresaPolicy });
  };

  const verificarManual = () => {
    recalcularDiferencias();
    if (!validateCamposObligatoriosCompletos()) return false;
    if (!validateApoyoRows()) return false;
    if (!confirmarCerosCriticos()) { setStatus("Verificación cancelada para revisar Bolsa/Caja.", "info"); return false; }
    verificado = true;
    btnEnviar.disabled = false;
    setStatus("Verificación manual OK. Puedes subir el cierre auxiliar.", "success");
    return true;
  };

  const enviarDirectoSupabase = async () => {
    if (!verificado && !verificarManual()) return;
    if (!confirmarGastosVacios()) { setStatus("Envío cancelado para revisar gastos.", "info"); return; }
    const writeAllowed = await puedeEnviarDatos(contextPayload?.empresa_id, true).catch((error) => {
      warn("No se pudo validar política de escritura, se usa política local", error);
      return !empresaPolicy?.solo_lectura;
    });
    if (!writeAllowed) { setStatus("Empresa en solo lectura o plan FREE: envío auxiliar bloqueado.", "error"); return; }

    const rows = buildRowsForSupabase();
    log("insertando cierres_turno_final", { rows: rows.length, fecha: fecha.value, responsable_id: responsable.value });
    btnConfirmarEnvio.disabled = true;
    setStatus("Guardando cierre auxiliar directamente en Supabase...", "info");
    try {
      const { data, error } = await supabase.from("cierres_turno_final").insert(rows).select("id, variable, categoria, valor");
      if (error) {
        errorLog("Supabase insert error", { message: error.message, details: error.details, hint: error.hint, code: error.code });
        setStatus(`Falló el guardado auxiliar: ${error.message || "error Supabase"}. Revisa consola para detalles.`, "error");
        return;
      }
      log("Supabase insert OK", { inserted: data?.length || rows.length });
      const descargaOk = descargarImagenResumen();
      confirmacionEnvio.classList.add("is-hidden");
      setStatus(`✅ Cierre auxiliar guardado en Supabase (${data?.length || rows.length} filas).${descargaOk ? " Constancia PNG descargada." : " No se pudo descargar PNG."}`, "success");
    } catch (error) {
      errorLog("Excepción guardando cierre auxiliar", error);
      setStatus(`Falló el módulo auxiliar: ${error?.message || "sin detalle"}.`, "error");
    } finally {
      btnConfirmarEnvio.disabled = false;
    }
  };

  const limpiar = () => {
    document.querySelectorAll('input[type="text"], input[type="time"], input[type="date"]').forEach((input) => { if (!input.closest(".apoyo-rango-wrap")) input.value = ""; });
    MEDIOS_PAGO.forEach((medio) => actualizarEstadoDiferencia(medio, 0));
    if (comentarios) comentarios.value = "";
    if (responsable) responsable.value = "";
    if (horaLlegadaMomento) horaLlegadaMomento.value = "AM";
    if (apoyoHubo) apoyoHubo.value = "";
    if (apoyoCantidad) apoyoCantidad.value = "";
    apoyoCantidadWrap?.classList.add("is-hidden");
    apoyoTablaWrap?.classList.add("is-hidden");
    if (apoyoRowsContainer) apoyoRowsContainer.innerHTML = "";
    extrasRows.forEach((row) => { if (row.input) row.input.value = "0"; });
    btnEnviar.disabled = true;
    verificado = false;
    renderTotalizados();
    setStatus("Campos limpiados.", "info");
  };

  const init = async () => {
    setStatus("Cargando cierre turno auxiliar...", "info");
    document.querySelectorAll('input[inputmode="numeric"], input[type="text"]').forEach((input) => enforceOneNumericInput(input));
    Object.values(inputsFinanzas).forEach((group) => {
      group.sistema.removeAttribute("readonly");
      group.real.removeAttribute("readonly");
      group.sistema.value = "";
      group.real.value = "";
    });
    inputsSoloVista.propina?.removeAttribute("readonly");
    inputsSoloVista.domicilios?.removeAttribute("readonly");
    inputsFinanzas.efectivo.real?.removeAttribute("readonly");
    if (btnToggleEfectivoSistema) btnToggleEfectivoSistema.style.display = "none";
    if (efectivoSistemaModo) efectivoSistemaModo.textContent = "manual";
    if (apoyosConsultaBox) apoyosConsultaBox.classList.remove("is-hidden");
    if (btnConsultarPropinaApoyos) btnConsultarPropinaApoyos.style.display = "none";
    if (apoyosConsultaNota) apoyosConsultaNota.textContent = "Modo auxiliar: la propina del responsable y de apoyos se llena manualmente.";
    correccionWrap?.classList.add("is-hidden");
    modalCorreccion?.classList.add("is-hidden");
    populateHoraLlegadaOptions();
    buildExtrasRows();
    applyVisibilitySettings();
    await cargarResponsables();
    btnEnviar.disabled = true;
    setStatus("Modo auxiliar listo. Llena los datos manualmente, verifica y sube directo a Supabase.", "success");
  };

  [...Object.values(inputsFinanzas).flatMap((group) => [group.sistema, group.real]), inputsSoloVista.propina, inputsSoloVista.domicilios, efectivoApertura, bolsa, caja]
    .filter(Boolean)
    .forEach((input) => input.addEventListener("input", () => { verificado = false; recalcularDiferencias(); btnEnviar.disabled = true; }));
  [fecha, responsable, horaInicio, horaFin, horaLlegadaHora, horaLlegadaMinuto, horaLlegadaMomento].filter(Boolean)
    .forEach((input) => input.addEventListener("change", () => { verificado = false; btnEnviar.disabled = true; }));
  apoyoHubo?.addEventListener("change", () => {
    const show = apoyoHubo.value === "si";
    apoyoCantidadWrap?.classList.toggle("is-hidden", !show);
    if (!show) { apoyoCantidad.value = ""; renderApoyoRows(0); }
  });
  apoyoCantidad?.addEventListener("change", () => renderApoyoRows(apoyoCantidad.value));
  btnVerificar?.addEventListener("click", verificarManual);
  btnEnviar?.addEventListener("click", () => {
    if (!validateCamposObligatoriosCompletos()) return;
    if (!validateApoyoRows()) return;
    recalcularDiferencias();
    mensajeEnvio.textContent = getTotalIngresosReales() - getTotalIngresosSistema() === 0
      ? "Buen trabajo! todo se ve bien. ¿Confirmas subir el cierre auxiliar directo a Supabase?"
      : "Hay diferencias registradas. Verifica bien antes de confirmar el guardado auxiliar.";
    confirmacionEnvio.classList.remove("is-hidden");
  });
  btnConfirmarEnvio?.addEventListener("click", enviarDirectoSupabase);
  btnCancelarEnvio?.addEventListener("click", () => { confirmacionEnvio.classList.add("is-hidden"); setStatus("Envío cancelado.", "info"); });
  btnLimpiar?.addEventListener("click", limpiar);

  init().catch((error) => {
    errorLog("init error", error);
    setStatus(`No se pudo inicializar el auxiliar: ${error?.message || "sin detalle"}`, "error");
  });
});
