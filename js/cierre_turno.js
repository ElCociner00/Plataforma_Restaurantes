import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { fetchResponsablesActivos } from "./responsables.js";
import { getEmpresaPolicy, puedeEnviarDatos } from "./permisos.core.js";
import { initApoyosPropinaManager } from "./apoyos.js";
import { descargarImagenResumenCierreTurno } from "./cierre_turno_png.js";
import {
  WEBHOOK_CONSULTAR_DATOS_CIERRE,
  WEBHOOK_LISTAR_RESPONSABLES,
  WEBHOOK_SUBIR_CIERRE,
  WEBHOOK_VERIFICAR_CIERRE,
  WEBHOOK_CONSULTAR_GASTOS,
  WEBHOOK_CONSULTAR_GASTOS_CATALOGO,
  WEBHOOK_ALERTA_MANIPULACION_CIERRE
} from "./webhooks.js";

// ../js/cierre_turno.js

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
  const btnConsultar = document.getElementById("consultarDatos");
  const btnConsultarGastos = document.getElementById("consultarGastos");
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
  const btnConsultarPropinaApoyos = document.getElementById("consultarPropinaApoyos");
  const apoyosConsultaNota = document.getElementById("apoyosConsultaNota");
  const correccionWrap = document.getElementById("correccionWrap");
  const btnSolicitarCorreccion = document.getElementById("solicitarCorreccion");
  const modalCorreccion = document.getElementById("modalCorreccion");
  const btnAceptarCorreccion = document.getElementById("aceptarCorreccion");
  const mainContainer = document.querySelector(".main");

  const inputsFinanzas = {
    efectivo: {
      sistema: document.getElementById("efectivo_sistema"),
      real: document.getElementById("efectivo_real"),
    },
    datafono: {
      sistema: document.getElementById("datafono_sistema"),
      real: document.getElementById("datafono_real"),
    },
    rappi: {
      sistema: document.getElementById("rappi_sistema"),
      real: document.getElementById("rappi_real"),
    },
    nequi: {
      sistema: document.getElementById("nequi_sistema"),
      real: document.getElementById("nequi_real"),
    },
    transferencias: {
      sistema: document.getElementById("transferencias_sistema"),
      real: document.getElementById("transferencias_real"),
    },
    bono_regalo: {
      sistema: document.getElementById("bono_regalo_sistema"),
      real: document.getElementById("bono_regalo_real"),
    }
  };

  const inputsSoloVista = {
    propina: document.getElementById("propina"),
    domicilios: document.getElementById("domicilios"),
  };

  const inputsDiferencias = {
    efectivo: {
      input: document.getElementById("efectivo_diferencia"),
      nota: document.getElementById("efectivo_diferencia_nota")
    },
    datafono: {
      input: document.getElementById("datafono_diferencia"),
      nota: document.getElementById("datafono_diferencia_nota")
    },
    rappi: {
      input: document.getElementById("rappi_diferencia"),
      nota: document.getElementById("rappi_diferencia_nota")
    },
    nequi: {
      input: document.getElementById("nequi_diferencia"),
      nota: document.getElementById("nequi_diferencia_nota")
    },
    transferencias: {
      input: document.getElementById("transferencias_diferencia"),
      nota: document.getElementById("transferencias_diferencia_nota")
    },
    bono_regalo: {
      input: document.getElementById("bono_regalo_diferencia"),
      nota: document.getElementById("bono_regalo_diferencia_nota")
    }
  };

  const filasFinanzas = document.querySelectorAll(".finanzas-row");

  const EXTRAS_STORAGE_KEY = "cierre_turno_extras_visibilidad";
  const MAX_LOADING_MS = 5000;
  const BUTTON_LOADING_MS = 8000;
  const extrasRows = new Map();
  const getTimestamp = () => new Date().toISOString();
  let modoEfectivoSistema = "bruto";
  let efectivoSistemaLoggro = 0;
  let nombreEmpresaActual = "";
  let responsablesActivos = [];
  let resumenDescargado = false;
  let bloqueoConstanciaActivo = false;
  let verificado = false;
  let empresaPolicy = {
    plan: "free",
    activa: true,
    solo_lectura: true
  };

  const toNumberValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatCOP = (value) => {
    const amount = Math.round(toNumberValue(value));
    const miles = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const sign = amount < 0 ? "-" : "";
    return `${sign}$${miles},00`;
  };

  const formatDurationLabel = (minutesValue) => {
    const minutes = Math.max(0, Number(minutesValue) || 0);
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours} horas ${remMinutes} minutos`;
  };

  const syncEfectivoRealFromCajaBolsa = () => {
    const total = toNumberValue(bolsa?.value) + toNumberValue(caja?.value);
    inputsFinanzas.efectivo.real.value = String(total);
  };

  const getTotalGastosExtras = () => Array.from(extrasRows.values())
    .filter((row) => row.visible)
    .reduce((sum, row) => sum + asNumber(row.value), 0);

  const getEfectivoSistemaBruto = () => (
    toNumberValue(efectivoApertura?.value) + toNumberValue(efectivoSistemaLoggro)
  );

  const getEfectivoSistemaNeto = () => getEfectivoSistemaBruto() - getTotalGastosExtras();

  const getTotalIngresosSistema = () => (
    toNumberValue(inputsFinanzas.efectivo.sistema?.value)
    + toNumberValue(inputsFinanzas.datafono.sistema?.value)
    + toNumberValue(inputsFinanzas.rappi.sistema?.value)
    + toNumberValue(inputsFinanzas.nequi.sistema?.value)
    + toNumberValue(inputsFinanzas.transferencias.sistema?.value)
    + toNumberValue(inputsFinanzas.bono_regalo.sistema?.value)
  );

  const getTotalIngresosReales = () => (
    toNumberValue(inputsFinanzas.efectivo.real?.value)
    + toNumberValue(inputsFinanzas.datafono.real?.value)
    + toNumberValue(inputsFinanzas.rappi.real?.value)
    + toNumberValue(inputsFinanzas.nequi.real?.value)
    + toNumberValue(inputsFinanzas.transferencias.real?.value)
    + toNumberValue(inputsFinanzas.bono_regalo.real?.value)
  );

  const renderTotalizados = () => {
    const totalSistema = getTotalIngresosSistema();
    const totalReal = getTotalIngresosReales();
    const totalGastos = getTotalGastosExtras();
    const ventaBruta = totalReal;
    const ventaNeta = totalReal - totalGastos;
    const diferenciaGeneral = totalReal - totalSistema;

    if (totalIngresosSistemaEl) totalIngresosSistemaEl.textContent = formatCOP(totalSistema);
    if (totalIngresosRealesEl) totalIngresosRealesEl.textContent = formatCOP(totalReal);
    if (totalGastosTurnoEl) totalGastosTurnoEl.textContent = formatCOP(totalGastos);
    if (totalVentaDiaBrutaEl) totalVentaDiaBrutaEl.textContent = formatCOP(ventaBruta);
    if (totalVentaDiaNetaEl) totalVentaDiaNetaEl.textContent = formatCOP(ventaNeta);
    if (totalDiferenciaGeneralEl) totalDiferenciaGeneralEl.textContent = formatCOP(diferenciaGeneral);
  };

  const syncEfectivoSistemaDisplay = () => {
    const bruto = getEfectivoSistemaBruto();
    const neto = getEfectivoSistemaNeto();
    const valor = modoEfectivoSistema === "neto" ? neto : bruto;
    inputsFinanzas.efectivo.sistema.value = String(valor);
    if (efectivoSistemaModo) {
      efectivoSistemaModo.textContent = modoEfectivoSistema === "neto"
        ? "efectivo despues de gastos"
        : "efectivo bruto";
    }
    renderTotalizados();
  };

  const syncTotalesExtras = () => {
    if (totalGastosExtrasEl) {
      totalGastosExtrasEl.textContent = String(getTotalGastosExtras());
    }
    syncEfectivoSistemaDisplay();
    renderTotalizados();
  };

  enforceNumericInput([
    inputsFinanzas.efectivo.sistema,
    inputsFinanzas.efectivo.real,
    inputsFinanzas.datafono.sistema,
    inputsFinanzas.datafono.real,
    inputsFinanzas.rappi.sistema,
    inputsFinanzas.rappi.real,
    inputsFinanzas.nequi.sistema,
    inputsFinanzas.nequi.real,
    inputsFinanzas.transferencias.sistema,
    inputsFinanzas.transferencias.real,
    inputsFinanzas.bono_regalo.sistema,
    inputsFinanzas.bono_regalo.real,
    efectivoApertura,
    inputsSoloVista.propina,
    inputsSoloVista.domicilios,
    bolsa,
    caja,
  ]);

  const comentarios = document.querySelector("textarea");

  const setStatus = (message) => {
    status.textContent = message;
  };

  const readResponseBody = async (res) => {
    const raw = await res.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return { message: raw };
    }
  };

  const enviarAlertaManipulacion = (motivo) => {
    const payload = {
      modulo: "cierre_turno",
      motivo,
      responsable_id: responsable?.value || "",
      responsable_nombre: responsable?.selectedOptions?.[0]?.textContent || "",
      empresa_nombre: nombreEmpresaActual || "",
      fecha_turno: fecha?.value || "",
      timestamp: getTimestamp()
    };

    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(WEBHOOK_ALERTA_MANIPULACION_CIERRE, blob);
        return;
      }
      fetch(WEBHOOK_ALERTA_MANIPULACION_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => {});
    } catch (_error) {
      // no-op
    }
  };

  const refreshEstadoBotonSubir = () => {
    const habilitar = verificado && empresaPolicy?.solo_lectura !== true;
    btnEnviar.disabled = !habilitar;
  };

  const aplicarBloqueoConstancia = (activo) => {
    bloqueoConstanciaActivo = activo;

    const controlesBloqueables = [
      btnConsultar,
      btnConsultarGastos,
      btnVerificar,
      btnLimpiar,
      btnToggleEfectivoSistema,
      fecha,
      responsable,
      horaInicio,
      horaFin,
      horaLlegadaHora,
      horaLlegadaMinuto,
      horaLlegadaMomento,
      efectivoApertura,
      bolsa,
      caja,
      comentarios,
      ...Object.values(inputsFinanzas).flatMap((grupo) => [grupo.sistema, grupo.real]),
      ...Object.values(inputsDiferencias).map(({ input }) => input),
      ...Object.values(inputsSoloVista)
    ].filter(Boolean);

    controlesBloqueables.forEach((control) => {
      control.disabled = activo;
    });

    extrasRows.forEach((row) => {
      if (row.input) row.input.disabled = activo;
    });

    correccionWrap?.classList.toggle("is-hidden", !activo);
    if (mainContainer) {
      mainContainer.classList.toggle("snapshot-locked", activo);
    }

    refreshEstadoBotonSubir();
  };

  const aplicarPoliticaSoloLectura = () => {
    const isReadOnly = empresaPolicy?.solo_lectura === true;
    const blockedByBilling = empresaPolicy?.motivo_solo_lectura === "facturacion_suspendida";
    const title = blockedByBilling
      ? "Servicio suspendido por falta de pago: solo consulta y facturación"
      : (isReadOnly ? "Plan FREE: solo visualizacion" : "");
    if (btnEnviar) {
      btnEnviar.disabled = isReadOnly;
      btnEnviar.title = title;
    }
    if (btnConfirmarEnvio) {
      btnConfirmarEnvio.disabled = isReadOnly;
      btnConfirmarEnvio.title = blockedByBilling
        ? "Servicio suspendido por falta de pago"
        : (isReadOnly ? "Plan FREE: envio bloqueado" : "");
    }
    if (isReadOnly) {
      setStatus(blockedByBilling
        ? "Servicio suspendido por falta de pago: puedes consultar la plataforma, pero no subir cierres hasta pagar en facturación."
        : "Plan FREE activo: puedes consultar y visualizar, pero no enviar cierres.");
    }
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const normalizeExtras = (raw) => {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      if (!raw.length) return [];
      const nested = raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        if (Array.isArray(item.Gastos)) return item.Gastos;
        if (Array.isArray(item.gastos)) return item.gastos;
        if (Array.isArray(item.extras)) return item.extras;
        if (Array.isArray(item.items)) return item.items;
        if (Array.isArray(item.data)) return item.data;
        return [item];
      });
      return nested.filter((item) => item && typeof item === "object");
    }

    if (typeof raw !== "object") return [];

    const keys = ["Gastos", "gastos", "extras", "items", "data"];
    for (const key of keys) {
      if (Array.isArray(raw[key])) return raw[key];
    }

    return Object.entries(raw)
      .filter(([key]) => key !== "ok" && key !== "message")
      .map(([id, value]) => ({ id, ...(typeof value === "object" ? value : { value }) }));
  };

  const getExtrasVisibilitySettings = () => {
    const stored = localStorage.getItem(EXTRAS_STORAGE_KEY);
    if (!stored) return {};
    try {
      return JSON.parse(stored);
    } catch (error) {
      return {};
    }
  };

  const buildExtrasRows = (extras) => {
    if (!extrasList) return;
    extrasList.innerHTML = "";
    extrasRows.clear();

    const visibility = getExtrasVisibilitySettings();

    extras.forEach((item) => {
      const id = String(item.id ?? item.Id ?? item.ID ?? item.codigo ?? item.key ?? "");
      if (!id) return;

      const nombre = item.nombre ?? item.name ?? item.descripcion ?? id;
      const visible = visibility[id] !== false;

      let input = null;
      if (visible) {
        const row = document.createElement("div");
        row.className = "extra-row";

        const label = document.createElement("span");
        label.textContent = nombre;

        input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.value = "0";

        row.append(label, input);
        extrasList.appendChild(row);
      }

      extrasRows.set(id, { nombre, input, visible, value: 0 });
    });
  };

  const buildExtrasPayload = () => (
    Array.from(extrasRows.entries()).map(([id, row]) => ({
      Id: id,
      name: row.nombre,
      valor: row.visible ? Number(row.value || 0) : 0,
      visible: row.visible
    }))
  );

  const asNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const actualizarDomiciliosDesdeExtras = () => {
    const totalDomicilios = Array.from(extrasRows.values())
      .filter((row) => /domicilios?/i.test(String(row.nombre || "")))
      .reduce((sum, row) => sum + asNumber(row.value), 0);

    inputsSoloVista.domicilios.value = String(totalDomicilios);
    syncTotalesExtras();
  };

  const limpiarDiferencias = () => {
    Object.values(inputsDiferencias).forEach(({ input, nota }) => {
      input.value = "";
      input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
      nota.textContent = "";
    });
  };

  const getContextPayload = async () => {
    const context = await getUserContext();
    if (!context) {
      setStatus("No se pudo validar la sesión.");
      return null;
    }

    return {
      empresa_id: context.empresa_id,
      tenant_id: context.empresa_id,
      usuario_id: context.user?.id || context.user?.user_id,
      rol: context.rol,
      registrado_por: context.user?.id || context.user?.user_id,
      timestamp: getTimestamp()
    };
  };



  const cargarNombreEmpresa = async () => {
    try {
      const context = await getUserContext();
      const empresaId = context?.empresa_id;
      if (!empresaId) return;

      const { data, error } = await supabase
        .from("empresas")
        .select("nombre_comercial")
        .eq("id", empresaId)
        .maybeSingle();

      if (error) return;
      nombreEmpresaActual = String(data?.nombre_comercial || "").trim();
    } catch (_error) {
      nombreEmpresaActual = "";
    }
  };

  const cargarPoliticaEmpresa = async (forceRefresh = false) => {
    const context = await getUserContext();
    if (!context?.empresa_id) return;
    empresaPolicy = await getEmpresaPolicy(context.empresa_id, forceRefresh).catch((error) => { setStatus("Error del sistema validando el plan. Recarga la pagina."); console.error("Error cargando politica de plan:", error); return { ...empresaPolicy, plan: "free", solo_lectura: true }; });
    aplicarPoliticaSoloLectura();
  };

  const cargarResponsables = async () => {
    try {
      const contextPayload = await getContextPayload();
      if (!contextPayload) return;

      const empresaId = contextPayload.empresa_id || contextPayload.tenant_id;
      const responsables = await fetchResponsablesActivos(empresaId);
      responsablesActivos = Array.isArray(responsables) ? responsables : [];




      responsable.innerHTML = "<option value=\"\">Seleccione responsable</option>";
      responsablesActivos.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id ?? "";
        option.textContent = item.nombre_completo ?? item.id ?? option.value;
        responsable.appendChild(option);
      });

      Array.from(apoyoRowsContainer?.querySelectorAll('[data-field="responsable"]') || []).forEach((select) => {
        const selectedValue = select.value;
        select.innerHTML = getResponsableOptionsHtml(selectedValue);
      });
    } catch (error) {
      setStatus("No se pudieron cargar los responsables.");
    }
  };

  const cargarExtrasCatalogo = async () => {
    if (!extrasList) return;

    try {
      const contextPayload = await getContextPayload();
      if (!contextPayload) return;

      const res = await fetchWithTimeout(WEBHOOK_CONSULTAR_GASTOS_CATALOGO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextPayload)
      });

      const data = await readResponseBody(res);
      if (!res.ok) {
        setStatus(data?.message || `Error al consultar gastos (HTTP ${res.status}).`);
        return;
      }
      const extras = normalizeExtras(data);

      if (extras.length) {
        buildExtrasRows(extras);
      }
    } catch (error) {
      // silencioso: los extras se cargan también al consultar gastos
    }
  };

  const formatFechaCompleta = (fechaValue) => {
    if (!fechaValue) return "";
    return `${fechaValue.replace(/-/g, "/")}T00:00:00`;
  };

  const getMomentoDia = (timeValue) => {
    if (!timeValue) return "";
    const [hour] = timeValue.split(":").map(Number);
    if (Number.isNaN(hour)) return "";
    return hour >= 12 ? "PM" : "AM";
  };


  const populateHoraLlegadaOptions = () => {
    if (horaLlegadaHora && !horaLlegadaHora.options.length) {
      horaLlegadaHora.innerHTML = '<option value="">Hora</option>';
      for (let hour = 1; hour <= 12; hour += 1) {
        const option = document.createElement("option");
        option.value = String(hour).padStart(2, "0");
        option.textContent = String(hour).padStart(2, "0");
        horaLlegadaHora.appendChild(option);
      }
    }

    if (horaLlegadaMinuto && !horaLlegadaMinuto.options.length) {
      horaLlegadaMinuto.innerHTML = '<option value="">Min</option>';
      for (let minute = 0; minute <= 59; minute += 1) {
        const option = document.createElement("option");
        option.value = String(minute).padStart(2, "0");
        option.textContent = String(minute).padStart(2, "0");
        horaLlegadaMinuto.appendChild(option);
      }
    }

    if (horaLlegadaMomento && !horaLlegadaMomento.value) {
      horaLlegadaMomento.value = "AM";
    }
  };

  const getHoraLlegadaCompleta = () => {
    const hour = horaLlegadaHora?.value || "";
    const minute = horaLlegadaMinuto?.value || "";
    const momento = horaLlegadaMomento?.value || "";
    if (!hour || !minute || !momento) return "";
    return `${hour}:${minute} ${momento}`;
  };

  const buildHourOptions = () => {
    let html = '<option value="">Hora</option>';
    for (let hour = 1; hour <= 12; hour += 1) {
      const value = String(hour).padStart(2, "0");
      html += `<option value="${value}">${value}</option>`;
    }
    return html;
  };

  const buildMinuteOptions = () => {
    let html = '<option value="">Min</option>';
    for (let minute = 0; minute <= 55; minute += 5) {
      const value = String(minute).padStart(2, "0");
      html += `<option value="${value}">${value}</option>`;
    }
    return html;
  };

  const toMinutesFromRangeParts = (hour12, minute, ampm) => {
    const h = Number(hour12);
    const m = Number(minute);
    if (!h || Number.isNaN(m) || !ampm) return null;
    let hour24 = h % 12;
    if (String(ampm).toUpperCase() === "PM") hour24 += 12;
    return (hour24 * 60) + m;
  };

  const readApoyoRange = (row) => {
    const fechaRango = row.querySelector('[data-field="fecha_rango"]')?.value || new Date().toISOString().slice(0, 10);
    const inicioHora = row.querySelector('[data-field="inicio_hora"]')?.value || "";
    const inicioMin = row.querySelector('[data-field="inicio_min"]')?.value || "";
    const inicioMom = row.querySelector('[data-field="inicio_momento"]')?.value || "";
    const finHora = row.querySelector('[data-field="fin_hora"]')?.value || "";
    const finMin = row.querySelector('[data-field="fin_min"]')?.value || "";
    const finMom = row.querySelector('[data-field="fin_momento"]')?.value || "";

    const inicioMinutes = toMinutesFromRangeParts(inicioHora, inicioMin, inicioMom);
    const finMinutes = toMinutesFromRangeParts(finHora, finMin, finMom);
    if (inicioMinutes === null || finMinutes === null) {
      return { complete: false, fechaRango, inicioHora, inicioMin, inicioMom, finHora, finMin, finMom };
    }

    let duration = finMinutes - inicioMinutes;
    if (duration < 0) duration += 24 * 60;
    const inicioHoraSimple = `${inicioHora}:${inicioMin}`;
    const finHoraSimple = `${finHora}:${finMin}`;
    const inicioTexto = `${inicioHoraSimple} ${inicioMom}`;
    const finTexto = `${finHoraSimple} ${finMom}`;
    return {
      complete: true,
      fechaRango,
      inicioHora,
      inicioMin,
      inicioMom,
      finHora,
      finMin,
      finMom,
      inicioHoraSimple,
      finHoraSimple,
      fechaHoraInicio: `${fechaRango} ${inicioHoraSimple}`,
      inicioTexto,
      finTexto,
      rangoTexto: `${inicioTexto} - ${finTexto}`,
      durationMinutes: duration,
      durationText: formatDurationLabel(duration)
    };
  };

  const getResponsableOptionsHtml = (selectedValue = "") => {
    const base = '<option value="">Selecciona responsable</option>';
    const options = responsablesActivos.map((item) => {
      const id = String(item?.id || "");
      const name = String(item?.nombre_completo || item?.id || id);
      const selected = id && id === String(selectedValue) ? "selected" : "";
      return `<option value="${id}" ${selected}>${name}</option>`;
    });
    return [base, ...options].join("");
  };

  const normalizeApoyoPropinaInput = (input) => {
    if (!input) return;
    input.value = String(input.value || "").replace(/[^\d]/g, "");
  };

  const createApoyoRow = (index) => {
    const row = document.createElement("div");
    row.className = "apoyo-row";
    row.dataset.index = String(index);
    row.innerHTML = `
      <select data-field="responsable">${getResponsableOptionsHtml()}</select>
      <input data-field="propina" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Automático" readonly>
      <div class="apoyo-rango-wrap">
        <input data-field="fecha_rango" type="date" value="${new Date().toISOString().slice(0, 10)}">
        <div class="apoyo-rango-grid">
          <div class="apoyo-rango-box">
            <small>Inicio</small>
            <div class="apoyo-rango-selects">
              <select data-field="inicio_hora">${buildHourOptions()}</select>
              <select data-field="inicio_min">${buildMinuteOptions()}</select>
              <select data-field="inicio_momento"><option value="AM">AM</option><option value="PM">PM</option></select>
            </div>
          </div>
          <div class="apoyo-rango-box">
            <small>Fin</small>
            <div class="apoyo-rango-selects">
              <select data-field="fin_hora">${buildHourOptions()}</select>
              <select data-field="fin_min">${buildMinuteOptions()}</select>
              <select data-field="fin_momento"><option value="AM">AM</option><option value="PM">PM</option></select>
            </div>
          </div>
        </div>
      </div>
    `;

    row.querySelector('[data-field="responsable"]')?.addEventListener("change", marcarComoNoVerificado);
    row.querySelectorAll('select, input[type="date"]').forEach((el) => {
      el.addEventListener("change", marcarComoNoVerificado);
    });
    return row;
  };

  const renderApoyoRows = (count) => {
    if (!apoyoRowsContainer) return;
    apoyoRowsContainer.innerHTML = "";
    const safeCount = Math.max(0, Math.min(30, Number(count) || 0));
    for (let i = 0; i < safeCount; i += 1) {
      apoyoRowsContainer.appendChild(createApoyoRow(i + 1));
    }
    apoyoTablaWrap?.classList.toggle("is-hidden", safeCount === 0);
  };

  const buildApoyoPayload = (contextPayload) => {
    const huboApoyos = (apoyoHubo?.value || "no") === "si";
    const cantidad = Number(apoyoCantidad?.value || 0);
    const rows = Array.from(apoyoRowsContainer?.querySelectorAll(".apoyo-row") || []);
    const registros = rows.map((row) => {
      const apoyoResponsableId = row.querySelector('[data-field="responsable"]')?.value || "";
      const propinaValue = row.querySelector('[data-field="propina"]')?.value || "0";
      const range = readApoyoRange(row);
      const tiempoMinutos = range.complete ? Number(range.durationMinutes || 0) : 0;
      return {
        empresa_id: contextPayload?.empresa_id || "",
        fecha: fecha.value || "",
        hora_inicio: horaInicio.value || "",
        hora_fin: horaFin.value || "",
        responsable_turno_id: responsable.value || "",
        apoyo_responsable_id: apoyoResponsableId,
        propina: Number(propinaValue || 0),
        tiempo_minutos: tiempoMinutos,
        tiempo_texto: range.complete ? range.durationText : "0 horas 0 minutos",
        rango_hora_inicio: range.complete ? range.inicioTexto : "",
        rango_hora_fin: range.complete ? range.finTexto : "",
        rango_hora_unificado: range.complete ? range.rangoTexto : "",
        rango_hora_inicio_simple: range.complete ? range.inicioHoraSimple : "",
        rango_hora_fin_simple: range.complete ? range.finHoraSimple : "",
        rango_fecha_hora_inicio: range.complete ? range.fechaHoraInicio : "",
        fecha_rango: range.fechaRango || ""
      };
    });

    return {
      etiqueta: "apoyo",
      empresa_id: contextPayload?.empresa_id || "",
      fecha: fecha.value || "",
      hora_inicio: horaInicio.value || "",
      hora_fin: horaFin.value || "",
      responsable_turno_id: responsable.value || "",
      hubo_apoyos: huboApoyos,
      cantidad_personas: huboApoyos ? cantidad : 0,
      registros: huboApoyos ? registros : []
    };
  };

  const validateApoyoRows = () => {
    if ((apoyoHubo?.value || "no") !== "si") return true;
    const cantidad = Number(apoyoCantidad?.value || 0);
    if (!cantidad || cantidad < 1) {
      setStatus("Indica cuántas personas participaron como apoyo.");
      return false;
    }

    const rows = Array.from(apoyoRowsContainer?.querySelectorAll(".apoyo-row") || []);
    if (rows.length !== cantidad) {
      setStatus("La cantidad de filas de apoyos no coincide con el número de personas.");
      return false;
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const responsableApoyo = row.querySelector('[data-field="responsable"]')?.value || "";
      const range = readApoyoRange(row);
      if (!responsableApoyo || !range.complete) {
        setStatus(`Completa todos los campos del apoyo #${i + 1}.`);
        return false;
      }
    }
    return true;
  };



  const apoyosPropinaManager = initApoyosPropinaManager({
    apoyoHubo,
    apoyoCantidad,
    apoyoRowsContainer,
    propinaInput: inputsSoloVista.propina,
    btnConsultarPropina: btnConsultarPropinaApoyos,
    noteEl: apoyosConsultaNota,
    setStatus,
    getContextPayload,
    buildApoyoPayload,
    validateApoyoRows,
    marcarComoNoVerificado: () => marcarComoNoVerificado()
  });
  const toggleButtons = ({ consultar, verificar, enviar }) => {
    if (typeof consultar === "boolean") btnConsultar.disabled = !consultar;
    if (typeof verificar === "boolean") btnVerificar.disabled = !verificar;
    if (typeof enviar === "boolean") btnEnviar.disabled = !enviar;
  };

  const buildTurnoPayload = async () => {
    const contextPayload = await getContextPayload();
    if (!contextPayload) return null;

    return {
      fecha: fecha.value,
      responsable: responsable.value,
      turno: {
        hora_llegada: getHoraLlegadaCompleta(),
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_momento: getMomentoDia(horaInicio.value),
        fin_momento: getMomentoDia(horaFin.value)
      },
      ...contextPayload
    };
  };

  const getMissingRequiredLabels = () => {
    const requiredFields = [
      { label: "Fecha", value: fecha?.value },
      { label: "Responsable del turno", value: responsable?.value },
      { label: "Hora de llegada", value: getHoraLlegadaCompleta() },
      { label: "Hora inicio", value: horaInicio?.value },
      { label: "Hora fin", value: horaFin?.value },
      { label: "Efectivo apertura", value: efectivoApertura?.value },
      { label: "Bolsa", value: bolsa?.value },
      { label: "Caja", value: caja?.value },
      { label: "Efectivo real", value: inputsFinanzas.efectivo.real?.value },
      { label: "Datafono real", value: inputsFinanzas.datafono.real?.value },
      { label: "Rappi real", value: inputsFinanzas.rappi.real?.value },
      { label: "Nequi real", value: inputsFinanzas.nequi.real?.value },
      { label: "Transferencias real", value: inputsFinanzas.transferencias.real?.value },
      { label: "Bono regalo real", value: inputsFinanzas.bono_regalo.real?.value },
      { label: "Propina", value: inputsSoloVista.propina?.value },
      { label: "Domicilios", value: inputsSoloVista.domicilios?.value }
    ];
    return requiredFields
      .filter((item) => String(item.value ?? "").trim() === "")
      .map((item) => item.label);
  };

  const validateCamposObligatoriosCompletos = () => {
    const missing = getMissingRequiredLabels();
    if (missing.length) {
      setStatus(`Completa estos campos obligatorios antes de continuar: ${missing.join(", ")}.`);
      return false;
    }
    return true;
  };

  const confirmarCerosCriticos = () => {
    const bolsaNum = Number(bolsa?.value || 0);
    const cajaNum = Number(caja?.value || 0);
    if (bolsaNum === 0 || cajaNum === 0) {
      return window.confirm("Advertencia: estás dejando Bolsa o Caja en 0. ¿Confirmas que ese valor es correcto?");
    }
    return true;
  };

  const getVisibilitySettings = () => {
    const stored = localStorage.getItem("cierre_turno_visibilidad");
    if (!stored) {
      return {
        efectivo: true,
        datafono: true,
        rappi: true,
        nequi: true,
        transferencias: true,
        bono_regalo: true,
        propina: true,
        domicilios: true,
      };
    }
    try {
      return JSON.parse(stored);
    } catch (error) {
      return {
        efectivo: true,
        datafono: true,
        rappi: true,
        nequi: true,
        transferencias: true,
        bono_regalo: true,
        propina: true,
        domicilios: true,
      };
    }
  };

  function actualizarEstadoDiferencia(field, rawValue) {
    const value = Number(rawValue);
    const { input, nota } = inputsDiferencias[field];
    input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
    if (Number.isNaN(value)) {
      nota.textContent = "";
      return;
    }
    if (value < 0) {
      input.classList.add("diff-faltante");
      nota.textContent = "Aquí hay un faltante!";
      return;
    }
    if (value > 0) {
      input.classList.add("diff-sobrante");
      nota.textContent = "Aquí hay un sobrante";
      return;
    }
    input.classList.add("diff-ok");
    nota.textContent = "Muy bien, todo en orden";
  }

  const calcularDiferenciaEfectivoLocal = () => {
    const efectivoSistemaNeto = getEfectivoSistemaNeto();
    const efectivoReal = toNumberValue(inputsFinanzas.efectivo.real.value);
    return efectivoReal - efectivoSistemaNeto;
  };

  const syncDiferenciaEfectivo = () => {
    const diferencia = calcularDiferenciaEfectivoLocal();
    if (!inputsDiferencias.efectivo) return diferencia;
    inputsDiferencias.efectivo.input.value = String(diferencia);
    actualizarEstadoDiferencia("efectivo", diferencia);
    return diferencia;
  };

  const applyVisibilitySettings = () => {
    const settings = getVisibilitySettings();
    filasFinanzas.forEach((row) => {
      const field = row.dataset.field;
      const visible = settings[field] !== false;
      row.classList.toggle("is-hidden", !visible);
      if (!visible) {
        if (inputsFinanzas[field]) {
          inputsFinanzas[field].sistema.value = "0";
          inputsFinanzas[field].real.value = "0";
        }
        if (inputsSoloVista[field]) {
          inputsSoloVista[field].value = "0";
        }
        if (inputsDiferencias[field]) {
          inputsDiferencias[field].input.value = "0";
          actualizarEstadoDiferencia(field, 0);
        }
      }
    });
    renderTotalizados();
    return settings;
  };

  const fechaEsPasada = (fechaValue) => {
    if (!fechaValue) return false;
    const [year, month, day] = fechaValue.split("-").map(Number);
    if (!year || !month || !day) return false;
    const fechaSeleccionada = new Date(year, month - 1, day);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return fechaSeleccionada < hoy;
  };

  const actualizarEstadoHoraFin = () => {
    horaFin.disabled = false;
  };


  const marcarComoNoVerificado = () => {
    limpiarDiferencias();
    resumenDescargado = false;
    if (!verificado) {
      refreshEstadoBotonSubir();
      return;
    }
    verificado = false;
    toggleButtons({ enviar: false });
    confirmacionEnvio.classList.add("is-hidden");
    refreshEstadoBotonSubir();
  };

  const limpiarCamposDatos = () => {
    Object.values(inputsFinanzas).forEach((grupo) => {
      grupo.sistema.value = "";
      grupo.real.value = "";
    });
    inputsSoloVista.propina.value = "";
    inputsSoloVista.domicilios.value = "";
    if (efectivoApertura) {
      efectivoApertura.value = "";
    }
    if (bolsa) {
      bolsa.value = "";
    }
    if (caja) {
      caja.value = "";
    }
    efectivoSistemaLoggro = 0;
    modoEfectivoSistema = "bruto";
    syncEfectivoRealFromCajaBolsa();
    syncEfectivoSistemaDisplay();
    syncDiferenciaEfectivo();
    extrasRows.forEach((row) => {
      row.value = 0;
      if (row.input) {
        row.input.value = "0";
      }
    });
    limpiarDiferencias();
    comentarios.value = "";
    if (horaLlegadaHora) horaLlegadaHora.value = "";
    if (horaLlegadaMinuto) horaLlegadaMinuto.value = "";
    if (horaLlegadaMomento) horaLlegadaMomento.value = "AM";
    if (apoyoHubo) apoyoHubo.value = "no";
    if (apoyoCantidad) apoyoCantidad.value = "";
    apoyoCantidadWrap?.classList.add("is-hidden");
    apoyoTablaWrap?.classList.add("is-hidden");
    if (apoyoRowsContainer) apoyoRowsContainer.innerHTML = "";
    apoyosPropinaManager?.reset?.();
    marcarComoNoVerificado();
    applyVisibilitySettings();
  };

  const settingsVisibilidad = applyVisibilitySettings();

  toggleButtons({ consultar: true, verificar: false, enviar: false });
  btnEnviar.disabled = true;

  syncEfectivoRealFromCajaBolsa();
  syncEfectivoSistemaDisplay();
  syncTotalesExtras();
  renderTotalizados();
  actualizarEstadoHoraFin();
  populateHoraLlegadaOptions();
  if (apoyoCantidad && apoyoCantidad.options.length <= 1) {
    apoyoCantidad.innerHTML = '<option value="">Selecciona</option>';
    for (let n = 1; n <= 30; n += 1) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = String(n);
      apoyoCantidad.appendChild(opt);
    }
  }
  apoyoHubo?.addEventListener("change", () => {
    const enabled = apoyoHubo.value === "si";
    apoyoCantidadWrap?.classList.toggle("is-hidden", !enabled);
    if (!enabled) {
      if (apoyoCantidad) apoyoCantidad.value = "";
      if (apoyoRowsContainer) apoyoRowsContainer.innerHTML = "";
      apoyoTablaWrap?.classList.add("is-hidden");
    } else {
      renderApoyoRows(Number(apoyoCantidad?.value || 0));
    }
    marcarComoNoVerificado();
  });
  apoyoCantidad?.addEventListener("change", () => {
    renderApoyoRows(Number(apoyoCantidad.value || 0));
    marcarComoNoVerificado();
  });

  cargarPoliticaEmpresa();
  cargarResponsables();
  cargarExtrasCatalogo();
  cargarNombreEmpresa();

  fecha.addEventListener("change", () => {
    actualizarEstadoHoraFin();
    marcarComoNoVerificado();
  });
  responsable.addEventListener("change", marcarComoNoVerificado);
  horaInicio.addEventListener("change", marcarComoNoVerificado);
  horaFin.addEventListener("change", marcarComoNoVerificado);
  horaLlegadaHora?.addEventListener("change", marcarComoNoVerificado);
  horaLlegadaMinuto?.addEventListener("change", marcarComoNoVerificado);
  horaLlegadaMomento?.addEventListener("change", marcarComoNoVerificado);
  comentarios.addEventListener("input", marcarComoNoVerificado);
  bolsa?.addEventListener("input", () => {
    syncEfectivoRealFromCajaBolsa();
    syncDiferenciaEfectivo();
    marcarComoNoVerificado();
  });
  caja?.addEventListener("input", () => {
    syncEfectivoRealFromCajaBolsa();
    syncDiferenciaEfectivo();
    marcarComoNoVerificado();
  });
  efectivoApertura?.addEventListener("input", () => {
    syncEfectivoSistemaDisplay();
    syncDiferenciaEfectivo();
    marcarComoNoVerificado();
  });

  btnToggleEfectivoSistema?.addEventListener("click", () => {
    modoEfectivoSistema = modoEfectivoSistema === "bruto" ? "neto" : "bruto";
    btnToggleEfectivoSistema.classList.add("rotating");
    setTimeout(() => btnToggleEfectivoSistema.classList.remove("rotating"), 360);
    syncEfectivoSistemaDisplay();
    syncDiferenciaEfectivo();
  });
  Object.values(inputsFinanzas).forEach((grupo) => {
    grupo.real.addEventListener("input", () => {
      renderTotalizados();
      marcarComoNoVerificado();
    });
  });
  Object.values(inputsDiferencias).forEach(({ input }) => {
    input.addEventListener("input", marcarComoNoVerificado);
  });


  const descargarImagenResumen = ({ bloquearDespues = false } = {}) => {
    const snapshotContext = {
      inputsFinanzas,
      inputsDiferencias,
      inputsSoloVista,
      bolsa,
      caja,
      extrasRows,
      apoyoRowsContainer,
      responsablesActivos,
      readApoyoRange,
      formatDurationLabel,
      getTotalIngresosSistema,
      getTotalIngresosReales,
      getTotalGastosExtras
    };

    const meta = {
      fecha: fecha?.value || "",
      responsableTexto: responsable?.selectedOptions?.[0]?.textContent || "-",
      horaLlegada: getHoraLlegadaCompleta() || "-",
      horaInicio: horaInicio?.value || "-",
      horaFin: horaFin?.value || "-",
      empresaNombre: nombreEmpresaActual || "Empresa",
      efectivoApertura: efectivoApertura?.value || 0,
      bolsa: bolsa?.value || 0,
      caja: caja?.value || 0
    };

    const ok = descargarImagenResumenCierreTurno({
      snapshotContext,
      meta,
      formatCOP,
      setStatus
    });

    if (!ok) return false;
    resumenDescargado = true;
    aplicarBloqueoConstancia(Boolean(bloquearDespues));
    return true;
  };
  btnSolicitarCorreccion?.addEventListener("click", () => {
    if (!bloqueoConstanciaActivo) return;
    enviarAlertaManipulacion("solicita_correccion");
    modalCorreccion?.classList.remove("is-hidden");
  });

  btnAceptarCorreccion?.addEventListener("click", () => {
    modalCorreccion?.classList.add("is-hidden");
    resumenDescargado = false;
    verificado = false;
    aplicarBloqueoConstancia(false);
    setStatus("Modo corrección habilitado. Vuelve a verificar antes de subir.");
  });

  document.addEventListener("contextmenu", (event) => {
    if (!bloqueoConstanciaActivo || !resumenDescargado) return;
    event.preventDefault();
    enviarAlertaManipulacion("click_derecho_bloqueado");
  });

  window.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const recarga = key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
    if (!recarga || !bloqueoConstanciaActivo || !resumenDescargado) return;
    event.preventDefault();
    enviarAlertaManipulacion("intento_recarga_teclado");
    setStatus("Recarga bloqueada por seguridad luego de generar constancia visual.");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!bloqueoConstanciaActivo || !resumenDescargado) return;
    enviarAlertaManipulacion("intento_recarga_beforeunload");
    event.preventDefault();
    event.returnValue = "";
  });


  btnConsultar.addEventListener("click", async () => {
    setStatus("Consultando Loggro...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !getHoraLlegadaCompleta() || !horaInicio.value || (requiereHoraFin && !horaFin.value) || !efectivoApertura?.value) {
      setStatus("Atención: Completa fecha, responsable, hora de llegada, hora inicio/fin y efectivo de apertura.");
      return;
    }

    const payload = await buildTurnoPayload();
    if (!payload) return;

    try {
      const res = await fetchWithTimeout(WEBHOOK_CONSULTAR_DATOS_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, BUTTON_LOADING_MS);

      const data = await readResponseBody(res);
      if (!res.ok) {
        setStatus(data?.message || `Error al consultar datos (HTTP ${res.status}).`);
        return;
      }

      const efectivoSistemaDesdeLoggro =
        data.efectivo_sistema
        ?? data.efectivo
        ?? data.ventas_efectivo
        ?? data.total_efectivo
        ?? 0;
      efectivoSistemaLoggro = toNumberValue(efectivoSistemaDesdeLoggro);

      syncEfectivoSistemaDisplay();
      inputsFinanzas.datafono.sistema.value = data.datafono_sistema ?? "";
      inputsFinanzas.rappi.sistema.value = data.rappi_sistema ?? "";
      inputsFinanzas.nequi.sistema.value = data.nequi_sistema ?? "";
      inputsFinanzas.transferencias.sistema.value = data.transferencias_sistema ?? "";
      inputsFinanzas.bono_regalo.sistema.value = data.bono_regalo_sistema ?? "";
      inputsSoloVista.propina.value = data.propina ?? "";
      apoyosPropinaManager?.reset?.();
      actualizarDomiciliosDesdeExtras();
      limpiarDiferencias();

      if (settingsVisibilidad.efectivo === false) {
        inputsFinanzas.efectivo.sistema.value = "0";
      }
      if (settingsVisibilidad.datafono === false) {
        inputsFinanzas.datafono.sistema.value = "0";
      }
      if (settingsVisibilidad.rappi === false) {
        inputsFinanzas.rappi.sistema.value = "0";
      }
      if (settingsVisibilidad.nequi === false) {
        inputsFinanzas.nequi.sistema.value = "0";
      }
      if (settingsVisibilidad.transferencias === false) {
        inputsFinanzas.transferencias.sistema.value = "0";
      }
      if (settingsVisibilidad.bono_regalo === false) {
        inputsFinanzas.bono_regalo.sistema.value = "0";
      }
      if (settingsVisibilidad.propina === false) {
        inputsSoloVista.propina.value = "0";
      }
      if (settingsVisibilidad.domicilios === false) {
        inputsSoloVista.domicilios.value = "0";
      }

      setStatus(data.message || "Datos consultados.");
      toggleButtons({ verificar: true });
    } catch (err) {
      setStatus(err?.name === "AbortError"
        ? "La consulta tardó más de 8 segundos."
        : "Error de conexión al consultar datos.");
    }
  });

  btnConsultarGastos?.addEventListener("click", async () => {
    setStatus("Consultando gastos...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !getHoraLlegadaCompleta() || !horaInicio.value || (requiereHoraFin && !horaFin.value)) {
      setStatus("Atención: Completa todos los datos del turno.");
      return;
    }

    const payload = await buildTurnoPayload();
    if (!payload) return;

    try {
      const res = await fetchWithTimeout(WEBHOOK_CONSULTAR_GASTOS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, BUTTON_LOADING_MS);

      const data = await readResponseBody(res);
      if (!res.ok) {
        setStatus(data?.message || `Error al consultar gastos (HTTP ${res.status}).`);
        return;
      }
      const extras = normalizeExtras(data);

      if (!extrasRows.size) {
        buildExtrasRows(extras);
      }

      extras.forEach((item) => {
        const id = String(item.id ?? item.Id ?? item.ID ?? item.codigo ?? item.key ?? "");
        if (!id) return;
        const row = extrasRows.get(id);
        if (!row) return;

        const value = item.valor ?? item.value ?? item.monto ?? item.total ?? item.gasto ?? 0;
        row.value = value;

        if (row.input && row.visible) {
          row.input.value = String(value ?? 0);
        }
      });

      actualizarDomiciliosDesdeExtras();
      setStatus("Gastos consultados.");
    } catch (error) {
      setStatus(error?.name === "AbortError"
        ? "La consulta de gastos tardó más de 8 segundos."
        : "Error consultando gastos/No hay gastos de caja  por obtener");
    }
  });

  btnVerificar.addEventListener("click", async () => {
    setStatus("Verificando...");
    btnVerificar.disabled = true;

    try {
      // Siempre limpiar antes de un nuevo ciclo de verificación
      limpiarDiferencias();
      actualizarDomiciliosDesdeExtras();

      if (!validateCamposObligatoriosCompletos()) return;
      if (!validateApoyoRows()) return;
      if (!confirmarCerosCriticos()) {
        setStatus("Verificación cancelada por el usuario para revisar Bolsa/Caja en cero.");
        return;
      }

      const contextPayload = await getContextPayload();
      if (!contextPayload) return;
      const apoyoPayload = buildApoyoPayload(contextPayload);

      const payload = {
        fecha: fecha.value,
        responsable: responsable.value,
        turno: {
          hora_llegada: getHoraLlegadaCompleta(),
          inicio: horaInicio.value,
          fin: horaFin.value,
          inicio_momento: getMomentoDia(horaInicio.value),
          fin_momento: getMomentoDia(horaFin.value)
        },
        finanzas: {
          efectivo_apertura: efectivoApertura.value || 0,
          efectivo: {
            sistema: String(getEfectivoSistemaNeto()),
            real: inputsFinanzas.efectivo.real.value || 0
          },
          datafono: {
            sistema: inputsFinanzas.datafono.sistema.value || 0,
            real: inputsFinanzas.datafono.real.value || 0
          },
          rappi: {
            sistema: inputsFinanzas.rappi.sistema.value || 0,
            real: inputsFinanzas.rappi.real.value || 0
          },
          nequi: {
            sistema: inputsFinanzas.nequi.sistema.value || 0,
            real: inputsFinanzas.nequi.real.value || 0
          },
          transferencias: {
            sistema: inputsFinanzas.transferencias.sistema.value || 0,
            real: inputsFinanzas.transferencias.real.value || 0
          },
          bono_regalo: {
            sistema: inputsFinanzas.bono_regalo.sistema.value || 0,
            real: inputsFinanzas.bono_regalo.real.value || 0
          },
          propina: inputsSoloVista.propina.value || 0,
          domicilios: inputsSoloVista.domicilios.value || 0,
          bolsa: bolsa?.value || 0,
          caja: caja?.value || 0
        },
        comentarios: comentarios.value || "",
        bolsa: bolsa?.value || 0,
        caja: caja?.value || 0,
        efectivo_apertura: efectivoApertura.value || 0,
        gastos_extras: buildExtrasPayload(),
        apoyo: apoyoPayload,
        ...contextPayload
      };

      const res = await fetchWithTimeout(WEBHOOK_VERIFICAR_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, BUTTON_LOADING_MS);

      const data = await readResponseBody(res);
      if (!res.ok) {
        setStatus(data?.message || `Error al verificar cierre (HTTP ${res.status}).`);
        return;
      }

      const diferenciaEfectivoCalculada = syncDiferenciaEfectivo();
      const diferenciaLocal = (medio) => (
        toNumberValue(inputsFinanzas[medio]?.real?.value) - toNumberValue(inputsFinanzas[medio]?.sistema?.value)
      );
      const diferencias = {
        efectivo: diferenciaEfectivoCalculada,
        datafono: diferenciaLocal("datafono"),
        rappi: diferenciaLocal("rappi"),
        nequi: diferenciaLocal("nequi"),
        transferencias: diferenciaLocal("transferencias"),
        bono_regalo: diferenciaLocal("bono_regalo")
      };

      Object.entries(diferencias).forEach(([field, value]) => {
        if (!inputsDiferencias[field]) return;
        inputsDiferencias[field].input.value = value ?? "";
        actualizarEstadoDiferencia(field, value);
      });

      await cargarPoliticaEmpresa(true);
      verificado = true;
      const serverMsg = String(data?.message || "").trim();
      setStatus(`${serverMsg ? `${serverMsg} ` : ""}Ya puedes subir el cierre.`);
      refreshEstadoBotonSubir();
    } catch (err) {
      setStatus(err?.name === "AbortError"
        ? "La verificación tardó más de 8 segundos."
        : "Error de conexión al verificar.");
    } finally {
      btnVerificar.disabled = false;
    }
  });

  const obtenerEstadoGlobalDiferencias = () => {
    let tieneFaltante = false;
    let tieneSobrante = false;
    Object.values(inputsDiferencias).forEach(({ input }) => {
      const value = Number(input.value);
      if (Number.isNaN(value)) return;
      if (value < 0) tieneFaltante = true;
      if (value > 0) tieneSobrante = true;
    });
    if (tieneFaltante) return "faltante";
    if (tieneSobrante) return "sobrante";
    return "ok";
  };

  const obtenerMensajeEnvio = (estado) => {
    if (estado === "faltante") {
      return "En estos datos hay un faltante, ten en cuenta que esto se descontará de tu nómina.";
    }
    if (estado === "sobrante") {
      return "En estos datos hay un sobrante, verifica bien las cuentas antes de enviar.";
    }
    return "Buen trabajo! todo se ve bien, apreciamos tu esfuerzo.";
  };

  const construirPayloadEnvio = async () => {
    const contextPayload = await getContextPayload();
    if (!contextPayload) return null;

    if (!validateCamposObligatoriosCompletos()) return null;
    if (!validateApoyoRows()) return null;
    if (!confirmarCerosCriticos()) {
      setStatus("Envío cancelado para revisar Bolsa/Caja en cero.");
      return null;
    }

    actualizarDomiciliosDesdeExtras();
    const apoyoPayload = buildApoyoPayload(contextPayload);

    const fechaCompleta = formatFechaCompleta(fecha.value);
    const diferencias = {
      efectivo_diferencia: inputsDiferencias.efectivo.input.value || 0,
      datafono_diferencia: inputsDiferencias.datafono.input.value || 0,
      rappi_diferencia: inputsDiferencias.rappi.input.value || 0,
      nequi_diferencia: inputsDiferencias.nequi.input.value || 0,
      transferencias_diferencia: inputsDiferencias.transferencias.input.value || 0,
      bono_de_regalo_diferencia: inputsDiferencias.bono_regalo.input.value || 0
    };

    const mediosPago = ["efectivo", "datafono", "rappi", "nequi", "transferencias", "bono_regalo"];

    const obtenerCategoriaGasto = (nombre) => {
      const label = String(nombre || "").toLowerCase();
      if (label.includes("domicilios") && label.includes("operativ")) return "domicilios_operativos";
      if (label.includes("domicilios") && label.includes("cliente")) return "domicilios_clientes";
      if (label.includes("insumo")) return "insumos";
      if (label.includes("arriendo")) return "arriendo";
      if (label.includes("aseo") || label.includes("limpieza")) return "aseo";
      if (label.includes("plástico") || label.includes("plastico") || label.includes("desechable")) return "desechables";
      if (label.includes("prote") || label.includes("té") || label.includes("te")) return "insumos_especiales";
      return "general";
    };

    const itemsFinanzas = mediosPago.flatMap((medio) => {
      const valorSistema = medio === "efectivo"
        ? String(getEfectivoSistemaNeto())
        : (inputsFinanzas[medio]?.sistema?.value || 0);
      const valorReal = inputsFinanzas[medio]?.real?.value || 0;
      const diferenciaRaw = diferencias[`${medio}_diferencia`] ?? (Number(valorReal) - Number(valorSistema));
      const diferenciaNum = Number(diferenciaRaw);
      const tieneDiferencia = Number.isFinite(diferenciaNum) ? diferenciaNum !== 0 : false;

      return [
        {
          tipo: medio,
          categoria: "sistema",
          valor: String(valorSistema),
          id_referencia: null,
          tiene_diferencia: false
        },
        {
          tipo: medio,
          categoria: "real",
          valor: String(valorReal),
          id_referencia: null,
          tiene_diferencia: tieneDiferencia,
          ...(tieneDiferencia ? { diferencia: String(diferenciaRaw) } : {})
        }
      ];
    });

    const gastosExtras = buildExtrasPayload();
    const itemsGastos = gastosExtras.map((gasto) => ({
      tipo: "gasto_extra",
      categoria: obtenerCategoriaGasto(gasto.name),
      valor: String(Number(gasto.valor || 0)),
      id_referencia: gasto.Id || null,
      tiene_diferencia: false
    }));

    const totalSistema = mediosPago.reduce((acc, medio) => acc + Number(inputsFinanzas[medio]?.sistema?.value || 0), 0);
    const totalReal = mediosPago.reduce((acc, medio) => acc + Number(inputsFinanzas[medio]?.real?.value || 0), 0);
    const diferenciaTotal = Object.values(diferencias).reduce((acc, value) => acc + Number(value || 0), 0);
    const totalGastosExtras = gastosExtras.reduce((acc, gasto) => acc + Number(gasto.valor || 0), 0);
    const totalDomiciliosOperativos = itemsGastos
      .filter((item) => item.categoria === "domicilios_operativos")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const totalDomiciliosClientes = itemsGastos
      .filter((item) => item.categoria === "domicilios_clientes")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);

    return {
      global: {
        fecha: fecha.value,
        empresa_id: contextPayload.empresa_id,
        tenant_id: contextPayload.tenant_id,
        usuario_id: contextPayload.usuario_id,
        responsable_id: responsable.value,
        registrado_por: contextPayload.registrado_por,
        rol: contextPayload.rol,
        timestamp: contextPayload.timestamp,
        comentarios: comentarios.value || "",
        hora_llegada: getHoraLlegadaCompleta(),
        turno: {
          hora_llegada: getHoraLlegadaCompleta(),
          inicio: horaInicio.value,
          fin: horaFin.value,
          inicio_momento: getMomentoDia(horaInicio.value),
          fin_momento: getMomentoDia(horaFin.value),
          fecha_inicio: fechaCompleta,
          fecha_fin: fechaCompleta
        },
        efectivo_apertura: efectivoApertura.value || 0,
        propina_global: inputsSoloVista.propina.value || 0,
        domicilios_global: inputsSoloVista.domicilios.value || 0,
        bolsa_global: bolsa?.value || 0,
        caja_global: caja?.value || 0
      },
      items: [...itemsFinanzas, ...itemsGastos],
      resumen: {
        total_sistema: totalSistema,
        total_real: totalReal,
        diferencia_total: diferenciaTotal,
        total_gastos_extras: totalGastosExtras,
        total_domicilios_operativos: totalDomiciliosOperativos,
        total_domicilios_clientes: totalDomiciliosClientes,
        total_propinas: Number(inputsSoloVista.propina.value || 0),
        total_bolsa: Number(bolsa?.value || 0),
        caja_final: Number(caja?.value || 0)
      },
      apoyo: apoyoPayload
    };
  };

  btnEnviar.addEventListener("click", async () => {
    if (empresaPolicy?.solo_lectura === true) {
      setStatus("Plan FREE: envio bloqueado. Solo visualizacion.");
      confirmacionEnvio.classList.add("is-hidden");
      return;
    }
    if (!validateCamposObligatoriosCompletos()) return;
    if (!validateApoyoRows()) return;
    const estado = obtenerEstadoGlobalDiferencias();
    mensajeEnvio.textContent = obtenerMensajeEnvio(estado);
    confirmacionEnvio.classList.remove("is-hidden");
  });

  btnConfirmarEnvio.addEventListener("click", async () => {
    if (empresaPolicy?.solo_lectura === true) {
      setStatus("Plan FREE: no se permite subir cierres.");
      confirmacionEnvio.classList.add("is-hidden");
      return;
    }

    setStatus("Enviando cierre...");
    const payload = await construirPayloadEnvio();
    if (!payload) return;

    const writeAllowed = await puedeEnviarDatos(payload?.global?.empresa_id, true).catch(() => false);
    if (!writeAllowed) {
      setStatus("Plan FREE o empresa inactiva: envio bloqueado por seguridad.");
      confirmacionEnvio.classList.add("is-hidden");
      return;
    }

    try {
      const res = await fetch(WEBHOOK_SUBIR_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_parseError) {
        data = { message: raw };
      }

      if (!res.ok) {
        console.error("Error webhook subir_cierre", { status: res.status, data });
        setStatus(data?.message || `Error al subir cierre (HTTP ${res.status}).`);
        return;
      }

      console.info("Webhook subir_cierre OK", { status: res.status, data });
      const descargaOk = descargarImagenResumen({ bloquearDespues: false });
      setStatus(
        (data?.message || "Cierre enviado correctamente.")
        + (descargaOk ? " Constancia descargada automáticamente." : " No se pudo descargar constancia automática.")
      );
      confirmacionEnvio.classList.add("is-hidden");
      aplicarBloqueoConstancia(false);
    } catch (err) {
      setStatus("Error de conexión al subir cierre.");
    }
  });

  btnCancelarEnvio.addEventListener("click", () => {
    confirmacionEnvio.classList.add("is-hidden");
  });

  btnLimpiar.addEventListener("click", () => {
    limpiarCamposDatos();
    setStatus("Datos limpiados.");
  });
});
