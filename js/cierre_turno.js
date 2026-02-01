// ../js/cierre_turno.js

document.addEventListener("DOMContentLoaded", () => {
  const fecha = document.getElementById("fecha");
  const responsable = document.getElementById("responsable");
  const horaInicio = document.getElementById("hora_inicio");
  const horaFin = document.getElementById("hora_fin");
  const status = document.getElementById("status");

  const btnVerificar = document.getElementById("verificar");
  const btnEnviar = document.getElementById("enviar");

  // Inputs financieros (ordenados)
  const inputsFinanzas = {
    efectivo: {
      sistema: document.querySelectorAll(".finanzas-grid input")[0],
      real: document.querySelectorAll(".finanzas-grid input")[1],
    },
    datafono: {
      sistema: document.querySelectorAll(".finanzas-grid input")[2],
      real: document.querySelectorAll(".finanzas-grid input")[3],
    },
    transferencias: {
      sistema: document.querySelectorAll(".finanzas-grid input")[4],
      real: document.querySelectorAll(".finanzas-grid input")[5],
    }
  };

  const comentarios = document.querySelector("textarea");

  btnVerificar.addEventListener("click", () => {
    status.textContent = "";

    if (!fecha.value || !responsable.value || !horaInicio.value || !horaFin.value) {
      status.textContent = "⚠️ Completa todos los datos del turno.";
      return;
    }

    status.textContent = "✅ Datos básicos completos. Puedes enviar el cierre.";
  });

  btnEnviar.addEventListener("click", async () => {
    status.textContent = "⏳ Enviando cierre...";

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
      comentarios: comentarios.value || ""
    };

    console.log("Payload cierre turno:", payload);

    // 🔌 Aquí luego conectas webhook / Supabase
    setTimeout(() => {
      status.textContent = "✅ Cierre enviado correctamente (mock).";
    }, 1200);
  });
});
