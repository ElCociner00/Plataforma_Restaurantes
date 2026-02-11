import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import {
  WEBHOOK_CONSULTAR_DATOS_CIERRE,
  WEBHOOK_LISTAR_RESPONSABLES,
  WEBHOOK_SUBIR_CIERRE,
  WEBHOOK_VERIFICAR_CIERRE,
  WEBHOOK_CONSULTAR_GASTOS,
  WEBHOOK_CONSULTAR_GASTOS_CATALOGO
} from "./webhooks.js";

// ../js/cierre_turno.js

document.addEventListener("DOMContentLoaded", () => {
  const fecha = document.getElementById("fecha");
  const responsable = document.getElementById("responsable");
  const horaInicio = document.getElementById("hora_inicio");
  const horaFin = document.getElementById("hora_fin");
  const efectivoApertura = document.getElementById("efectivo_apertura");
  const bolsa = document.getElementById("bolsa");
  const caja = document.getElementById("caja");
  const status = document.getElementById("status");
  const extrasList = document.getElementById("extrasList");

  const btnConsultarToggle = document.getElementById("consultarToggle");
  const btnConsultar = document.getElementById("consultarDatos");
  const btnConsultarGastos = document.getElementById("consultarGastos");
  const btnVerificar = document.getElementById("verificar");
  const btnEnviar = document.getElementById("enviar");
  const btnLimpiar = document.getElementById("limpiarDatos");
  const confirmacionEnvio = document.getElementById("confirmacionEnvio");
  const mensajeEnvio = document.getElementById("mensajeEnvio");
  const btnConfirmarEnvio = document.getElementById("confirmarEnvio");
  const btnCancelarEnvio = document.getElementById("cancelarEnvio");

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
  const extrasRows = new Map();
  const getTimestamp = () => new Date().toISOString();

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

  const cargarResponsables = async () => {
    try {
      const contextPayload = await getContextPayload();
      if (!contextPayload) return;

      const res = await fetch(WEBHOOK_LISTAR_RESPONSABLES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextPayload)
      });

      const data = await res.json();
      const baseResponsables = Array.isArray(data)
        ? data.flatMap((item) => item.responsables || [])
        : data.responsables || [];
      const responsables = Array.isArray(baseResponsables) ? baseResponsables : [];

      responsable.innerHTML = "<option value=\"\">Seleccione responsable</option>";
      responsables.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id ?? item.value ?? item.nombre ?? item.name ?? item;
        option.textContent = item.nombre ?? item.name ?? item.label ?? item;
        responsable.appendChild(option);
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

      const data = await res.json();
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
      bolsa: bolsa?.value || 0,
      caja: caja?.value || 0,
      turno: {
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_momento: getMomentoDia(horaInicio.value),
        fin_momento: getMomentoDia(horaFin.value)
      },
      ...contextPayload
    };
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
    if (fechaEsPasada(fecha.value)) {
      horaFin.value = "";
      horaFin.disabled = true;
      return;
    }
    horaFin.disabled = false;
  };

  let verificado = false;

  const marcarComoNoVerificado = () => {
    if (!verificado) return;
    verificado = false;
    toggleButtons({ enviar: false });
    confirmacionEnvio.classList.add("is-hidden");
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
    extrasRows.forEach((row) => {
      row.value = 0;
      if (row.input) {
        row.input.value = "0";
      }
    });
    Object.values(inputsDiferencias).forEach(({ input, nota }) => {
      input.value = "";
      input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
      nota.textContent = "";
    });
    comentarios.value = "";
    marcarComoNoVerificado();
    applyVisibilitySettings();
  };

  const settingsVisibilidad = applyVisibilitySettings();

  const consultarDropdown = btnConsultarToggle?.closest(".consultar-dropdown");

  if (btnConsultarToggle) {
    const dropdown = consultarDropdown;
    btnConsultarToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      dropdown?.classList.toggle("open");
    });

    document.addEventListener("click", () => {
      dropdown?.classList.remove("open");
    });
  }

  toggleButtons({ consultar: true, verificar: false, enviar: false });

  actualizarEstadoHoraFin();
  cargarResponsables();
  cargarExtrasCatalogo();

  fecha.addEventListener("change", () => {
    actualizarEstadoHoraFin();
    marcarComoNoVerificado();
  });
  responsable.addEventListener("change", marcarComoNoVerificado);
  horaInicio.addEventListener("change", marcarComoNoVerificado);
  horaFin.addEventListener("change", marcarComoNoVerificado);
  comentarios.addEventListener("input", marcarComoNoVerificado);
  bolsa?.addEventListener("input", marcarComoNoVerificado);
  Object.values(inputsFinanzas).forEach((grupo) => {
    grupo.real.addEventListener("input", marcarComoNoVerificado);
  });
  Object.values(inputsDiferencias).forEach(({ input }) => {
    input.addEventListener("input", marcarComoNoVerificado);
  });

  btnConsultar.addEventListener("click", async () => {
    consultarDropdown?.classList.remove("open");
    setStatus("Consultando datos...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !horaInicio.value || (requiereHoraFin && !horaFin.value)) {
      setStatus("⚠️ Completa todos los datos del turno.");
      return;
    }

    const payload = await buildTurnoPayload();
    if (!payload) return;

    try {
      const res = await fetch(WEBHOOK_CONSULTAR_DATOS_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      inputsFinanzas.efectivo.sistema.value = data.efectivo_sistema ?? "";
      inputsFinanzas.datafono.sistema.value = data.datafono_sistema ?? "";
      inputsFinanzas.rappi.sistema.value = data.rappi_sistema ?? "";
      inputsFinanzas.nequi.sistema.value = data.nequi_sistema ?? "";
      inputsFinanzas.transferencias.sistema.value = data.transferencias_sistema ?? "";
      inputsFinanzas.bono_regalo.sistema.value = data.bono_regalo_sistema ?? "";
      inputsSoloVista.propina.value = data.propina ?? "";
      actualizarDomiciliosDesdeExtras();
      Object.values(inputsDiferencias).forEach(({ input, nota }) => {
        input.value = "";
        input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
        nota.textContent = "";
      });

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
      setStatus("Error de conexión al consultar datos.");
    }
  });

  btnConsultarGastos?.addEventListener("click", async () => {
    consultarDropdown?.classList.remove("open");
    setStatus("Consultando gastos...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !horaInicio.value || (requiereHoraFin && !horaFin.value)) {
      setStatus("⚠️ Completa todos los datos del turno.");
      return;
    }

    const payload = await buildTurnoPayload();
    if (!payload) return;

    try {
      const res = await fetchWithTimeout(WEBHOOK_CONSULTAR_GASTOS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
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
        ? "La consulta de gastos tardó más de 5 segundos."
        : "Error consultando gastos/No hay gastos de caja  por obtener");
    }
  });

  btnVerificar.addEventListener("click", async () => {
    setStatus("Verificando...");

    actualizarDomiciliosDesdeExtras();

    if (!efectivoApertura?.value) {
      setStatus("⚠️ Completa el efectivo de apertura.");
      return;
    }

    const contextPayload = await getContextPayload();
    if (!contextPayload) return;

    const payload = {
      fecha: fecha.value,
      responsable: responsable.value,
      turno: {
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_momento: getMomentoDia(horaInicio.value),
        fin_momento: getMomentoDia(horaFin.value)
      },
      finanzas: {
        efectivo_apertura: efectivoApertura.value || 0,
        efectivo: {
          sistema: inputsFinanzas.efectivo.sistema.value || 0,
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
      ...contextPayload
    };

    try {
      const res = await fetch(WEBHOOK_VERIFICAR_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      const diferencias = {
        efectivo: data.efectivo_diferencia,
        datafono: data.datafono_diferencia,
        rappi: data.rappi_diferencia,
        nequi: data.nequi_diferencia,
        transferencias: data.transferencias_diferencia,
        bono_regalo: data.bono_de_regalo_diferencia
      };

      Object.entries(diferencias).forEach(([field, value]) => {
        if (!inputsDiferencias[field]) return;
        inputsDiferencias[field].input.value = value ?? "";
        actualizarEstadoDiferencia(field, value);
      });

      if (caja) {
        caja.value = String(diferencias.efectivo ?? 0);
      }

      setStatus(data.message || "");
      verificado = true;
      toggleButtons({ enviar: true });
    } catch (err) {
      setStatus("Error de conexión al verificar.");
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

    if (!efectivoApertura?.value) {
      setStatus("⚠️ Completa el efectivo de apertura.");
      return null;
    }

    actualizarDomiciliosDesdeExtras();

    const fechaCompleta = formatFechaCompleta(fecha.value);
    const sistemas = {
      efectivo_sistema: inputsFinanzas.efectivo.sistema.value || 0,
      datafono_sistema: inputsFinanzas.datafono.sistema.value || 0,
      rappi_sistema: inputsFinanzas.rappi.sistema.value || 0,
      nequi_sistema: inputsFinanzas.nequi.sistema.value || 0,
      transferencias_sistema: inputsFinanzas.transferencias.sistema.value || 0,
      bono_regalo_sistema: inputsFinanzas.bono_regalo.sistema.value || 0
    };
    const reales = {
      efectivo_real: inputsFinanzas.efectivo.real.value || 0,
      datafono_real: inputsFinanzas.datafono.real.value || 0,
      rappi_real: inputsFinanzas.rappi.real.value || 0,
      nequi_real: inputsFinanzas.nequi.real.value || 0,
      transferencias_real: inputsFinanzas.transferencias.real.value || 0,
      bono_regalo_real: inputsFinanzas.bono_regalo.real.value || 0
    };
    const diferencias = {
      efectivo_diferencia: inputsDiferencias.efectivo.input.value || 0,
      datafono_diferencia: inputsDiferencias.datafono.input.value || 0,
      rappi_diferencia: inputsDiferencias.rappi.input.value || 0,
      nequi_diferencia: inputsDiferencias.nequi.input.value || 0,
      transferencias_diferencia: inputsDiferencias.transferencias.input.value || 0,
      bono_de_regalo_diferencia: inputsDiferencias.bono_regalo.input.value || 0
    };

    return {
      fecha: fecha.value,
      responsable: responsable.value,
      turno: {
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_momento: getMomentoDia(horaInicio.value),
        fin_momento: getMomentoDia(horaFin.value),
        fecha_inicio: fechaCompleta,
        fecha_fin: fechaCompleta
      },
      finanzas: {
        efectivo_apertura: efectivoApertura.value || 0,
        efectivo: {
          sistema: inputsFinanzas.efectivo.sistema.value || 0,
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
      sistemas,
      reales,
      diferencias,
      propina: inputsSoloVista.propina.value || 0,
      domicilios: inputsSoloVista.domicilios.value || 0,
      bolsa: bolsa?.value || 0,
      caja: caja?.value || 0,
      efectivo_apertura: efectivoApertura.value || 0,
      gastos_extras: buildExtrasPayload(),
      comentarios: comentarios.value || "",
      ...contextPayload
    };
  };

  btnEnviar.addEventListener("click", async () => {
    const estado = obtenerEstadoGlobalDiferencias();
    mensajeEnvio.textContent = obtenerMensajeEnvio(estado);
    confirmacionEnvio.classList.remove("is-hidden");
  });

  btnConfirmarEnvio.addEventListener("click", async () => {
    setStatus("Enviando cierre...");
    const payload = await construirPayloadEnvio();
    if (!payload) return;

    try {
      const res = await fetch(WEBHOOK_SUBIR_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      setStatus(data.message || "");
      window.location.reload();
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
