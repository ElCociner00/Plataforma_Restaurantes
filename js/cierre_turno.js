import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import {
  WEBHOOK_CONSULTAR_DATOS_CIERRE,
  WEBHOOK_SUBIR_CIERRE,
  WEBHOOK_VERIFICAR_CIERRE
} from "./webhooks.js";

// ../js/cierre_turno.js

document.addEventListener("DOMContentLoaded", () => {
  const fecha = document.getElementById("fecha");
  const responsable = document.getElementById("responsable");
  const horaInicio = document.getElementById("hora_inicio");
  const horaFin = document.getElementById("hora_fin");
  const status = document.getElementById("status");

  const btnConsultar = document.getElementById("consultarDatos");
  const btnVerificar = document.getElementById("verificar");
  const btnEnviar = document.getElementById("enviar");
  const btnLimpiar = document.getElementById("limpiarDatos");

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
    }
  };

  const inputsSoloVista = {
    propina: document.getElementById("propina"),
    domicilios: document.getElementById("domicilios"),
  };

  const filasFinanzas = document.querySelectorAll(".finanzas-row");

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
    inputsSoloVista.propina,
    inputsSoloVista.domicilios
  ]);

  const comentarios = document.querySelector("textarea");

  const setStatus = (message) => {
    status.textContent = message;
  };

  const getContextPayload = async () => {
    const context = await getUserContext();
    if (!context) {
      setStatus("No se pudo validar la sesión.");
      return null;
    }

    return {
      empresa_id: context.empresa_id,
      registrado_por: context.user?.id || context.user?.user_id
    };
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

  const getVisibilitySettings = () => {
    const stored = localStorage.getItem("cierre_turno_visibilidad");
    if (!stored) {
      return {
        efectivo: true,
        datafono: true,
        rappi: true,
        nequi: true,
        transferencias: true,
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
        propina: true,
        domicilios: true,
      };
    }
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
  };

  const limpiarCamposDatos = () => {
    Object.values(inputsFinanzas).forEach((grupo) => {
      grupo.sistema.value = "";
      grupo.real.value = "";
    });
    Object.values(inputsSoloVista).forEach((input) => {
      input.value = "";
    });
    comentarios.value = "";
    marcarComoNoVerificado();
    applyVisibilitySettings();
  };

  const settingsVisibilidad = applyVisibilitySettings();

  toggleButtons({ consultar: true, verificar: false, enviar: false });

  actualizarEstadoHoraFin();

  fecha.addEventListener("change", () => {
    actualizarEstadoHoraFin();
    marcarComoNoVerificado();
  });
  responsable.addEventListener("change", marcarComoNoVerificado);
  horaInicio.addEventListener("change", marcarComoNoVerificado);
  horaFin.addEventListener("change", marcarComoNoVerificado);
  comentarios.addEventListener("input", marcarComoNoVerificado);
  Object.values(inputsFinanzas).forEach((grupo) => {
    grupo.real.addEventListener("input", marcarComoNoVerificado);
  });

  btnConsultar.addEventListener("click", async () => {
    setStatus("Consultando datos...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !horaInicio.value || (requiereHoraFin && !horaFin.value)) {
      setStatus("⚠️ Completa todos los datos del turno.");
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
      ...contextPayload
    };

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
      inputsSoloVista.propina.value = data.propina ?? "";
      inputsSoloVista.domicilios.value = data.domicilios ?? "";

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

  btnVerificar.addEventListener("click", async () => {
    setStatus("Verificando...");

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
        }
      },
      comentarios: comentarios.value || "",
      ...contextPayload
    };

    try {
      const res = await fetch(WEBHOOK_VERIFICAR_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      setStatus(data.message || "");
      verificado = true;
      toggleButtons({ enviar: true });
    } catch (err) {
      setStatus("Error de conexión al verificar.");
    }
  });

  btnEnviar.addEventListener("click", async () => {
    setStatus("Enviando cierre...");

    const contextPayload = await getContextPayload();
    if (!contextPayload) return;

    const fechaCompleta = formatFechaCompleta(fecha.value);

    const payload = {
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
        }
      },
      comentarios: comentarios.value || "",
      ...contextPayload
    };

    try {
      const res = await fetch(WEBHOOK_SUBIR_CIERRE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      setStatus(data.message || "");
    } catch (err) {
      setStatus("Error de conexión al subir cierre.");
    }
  });

  btnLimpiar.addEventListener("click", () => {
    limpiarCamposDatos();
    setStatus("Datos limpiados.");
  });
});
