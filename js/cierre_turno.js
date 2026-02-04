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

  // NUEVA FUNCIÓN: Convertir hora HH:mm a formato completo
  const convertirHoraCompleta = (fechaValue, horaValue) => {
    if (!fechaValue || !horaValue) return "";
    
    // Asegurar que la fecha tenga el formato correcto
    const fechaFormateada = fechaValue.replace(/-/g, "/");
    
    // Crear objeto Date con fecha y hora
    const [horas, minutos] = horaValue.split(":");
    const fechaHora = new Date(`${fechaFormateada}T${horaValue}:00`);
    
    // OPCIÓN 1: Formato ISO (recomendado para APIs)
    const isoString = fechaHora.toISOString();
    
    // OPCIÓN 2: Formato legible con AM/PM
    const opciones = { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    };
    const horaConAmPm = fechaHora.toLocaleTimeString('es-ES', opciones);
    
    // OPCIÓN 3: Formato 24 horas completo
    const formato24Horas = fechaHora.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    
    return {
      iso: isoString,                     // "2025-02-04T08:00:00.000Z"
      legible: horaConAmPm,               // "08:00 AM" o "13:00 PM"
      formato24: formato24Horas,          // "08:00" o "13:00"
      periodo: parseInt(horas) >= 12 ? "PM" : "AM", // "AM" o "PM"
      timestamp: fechaHora.getTime()      // timestamp en milisegundos
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

    // Convertir horas a formato completo
    const horaInicioCompleta = convertirHoraCompleta(fecha.value, horaInicio.value);
    const horaFinCompleta = convertirHoraCompleta(fecha.value, horaFin.value);

    const payload = {
      fecha: fecha.value,
      responsable: responsable.value,
      turno: {
        inicio: horaInicio.value,          // Mantener formato original
        fin: horaFin.value,                // Mantener formato original
        inicio_completo: horaInicioCompleta, // NUEVO: objeto completo
        fin_completo: horaFinCompleta,       // NUEVO: objeto completo
        inicio_iso: horaInicioCompleta?.iso, // Para APIs
        fin_iso: horaFinCompleta?.iso,       // Para APIs
        periodo_inicio: horaInicioCompleta?.periodo, // "AM" o "PM"
        periodo_fin: horaFinCompleta?.periodo        // "AM" o "PM"
      },
      metadata: {
        timestamp_envio: new Date().toISOString(),
        momento_dia: determinarMomentoDia(horaInicio.value, horaFin.value)
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

    // Convertir horas a formato completo
    const horaInicioCompleta = convertirHoraCompleta(fecha.value, horaInicio.value);
    const horaFinCompleta = convertirHoraCompleta(fecha.value, horaFin.value);

    const payload = {
      fecha: fecha.value,
      responsable: responsable.value,
      turno: {
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_completo: horaInicioCompleta,
        fin_completo: horaFinCompleta,
        inicio_iso: horaInicioCompleta?.iso,
        fin_iso: horaFinCompleta?.iso,
        periodo_inicio: horaInicioCompleta?.periodo,
        periodo_fin: horaFinCompleta?.periodo
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
      metadata: {
        timestamp_envio: new Date().toISOString(),
        momento_dia: determinarMomentoDia(horaInicio.value, horaFin.value)
      },
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
    
    // Convertir horas a formato completo
    const horaInicioCompleta = convertirHoraCompleta(fecha.value, horaInicio.value);
    const horaFinCompleta = convertirHoraCompleta(fecha.value, horaFin.value);

    const payload = {
      fecha: fecha.value,
      responsable: responsable.value,
      turno: {
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_completo: horaInicioCompleta,
        fin_completo: horaFinCompleta,
        inicio_iso: horaInicioCompleta?.iso,
        fin_iso: horaFinCompleta?.iso,
        periodo_inicio: horaInicioCompleta?.periodo,
        periodo_fin: horaFinCompleta?.periodo,
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
      metadata: {
        timestamp_envio: new Date().toISOString(),
        momento_dia: determinarMomentoDia(horaInicio.value, horaFin.value)
      },
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
  
  // FUNCIÓN AUXILIAR: Determinar momento del día basado en horarios
  function determinarMomentoDia(horaInicio, horaFin) {
    const [horaInicioNum] = horaInicio.split(":").map(Number);
    const [horaFinNum] = horaFin.split(":").map(Number);
    
    if (horaInicioNum >= 5 && horaFinNum <= 11) {
      return "MAÑANA";
    } else if (horaInicioNum >= 12 && horaFinNum <= 17) {
      return "TARDE";
    } else if (horaInicioNum >= 18 && horaFinNum <= 23) {
      return "NOCHE";
    } else if (horaInicioNum >= 0 && horaFinNum <= 4) {
      return "MADRUGADA";
    } else {
      return "MIXTO";
    }
  }
});
