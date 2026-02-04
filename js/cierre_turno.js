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

  const inputsFinanzas = {
    efectivo: {
      sistema: document.getElementById("efectivo_sistema"),
      real: document.getElementById("efectivo_real"),
    },
    datafono: {
      sistema: document.getElementById("datafono_sistema"),
      real: document.getElementById("datafono_real"),
    },
    transferencias: {
      sistema: document.getElementById("transferencias_sistema"),
      real: document.getElementById("transferencias_real"),
    }
  };

  enforceNumericInput([
    inputsFinanzas.efectivo.sistema,
    inputsFinanzas.efectivo.real,
    inputsFinanzas.datafono.sistema,
    inputsFinanzas.datafono.real,
    inputsFinanzas.transferencias.sistema,
    inputsFinanzas.transferencias.real
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

  const toggleButtons = ({ consultar, verificar, enviar }) => {
    if (typeof consultar === "boolean") btnConsultar.disabled = !consultar;
    if (typeof verificar === "boolean") btnVerificar.disabled = !verificar;
    if (typeof enviar === "boolean") btnEnviar.disabled = !enviar;
  };

  toggleButtons({ consultar: true, verificar: false, enviar: false });

  btnConsultar.addEventListener("click", async () => {
    setStatus("Consultando datos...");

    if (!fecha.value || !responsable.value || !horaInicio.value || !horaFin.value) {
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
        fin: horaFin.value
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
      inputsFinanzas.transferencias.sistema.value = data.transferencias_sistema ?? "";

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
        fin: horaFin.value
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
});
