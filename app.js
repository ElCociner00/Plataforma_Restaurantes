function mostrarExtension() {
  document.getElementById("bloque_extension").style.display =
    document.getElementById("extendido").value === "Si" ? "block" : "none";
}

function obtenerDatos() {
  const campos = [
    "fecha", "responsable", "hora_inicio", "hora_fin", "efectivo_apertura", "compras_turno", "domicilios_turno",
    "efectivo_sistema", "efectivo_real", "datafono_sistema", "datafono_real",
    "transferencias_sistema", "transferencia_real", "rappi_sistema", "rappi_real", "bolsa", "caja", "meta"
  ];

  for (let c of campos) {
    if (document.getElementById(c).value === "") {
      mostrarMensaje(`Falta el campo: ${c}`, "error");
      return null;
    }
  }

  return {
    fecha: fecha.value,
    responsable: responsable.value,
    hora_inicio: hora_inicio.value,
    hora_fin: hora_fin.value,
    extendido: extendido.value,
    minutos: extendido.value === "Si" ? cuanto.value : 0,
    efectivo_apertura: efectivo_apertura.value,
    compras: compras_turno.value,
    domicilios: domicilios_turno.value,
    efectivo_sistema: efectivo_sistema.value,
    efectivo_real: efectivo_real.value,
    datafono_sistema: datafono_sistema.value,
    datafono_real: datafono_real.value,
    transferencias_sistema: transferencias_sistema.value,
    transferencia_real: transferencia_real.value,
    rappi_sistema: rappi_sistema.value,
    rappi_real: rappi_real.value,
    bolsa: bolsa.value,
    caja: caja.value,
    meta: meta.value,
    comentarios: comentarios.value
  };
}

function mostrarMensaje(msg, tipo) {
  const s = document.getElementById("status");
  s.className = tipo;
  s.innerText = msg;
  setTimeout(() => { s.innerText = ""; }, 5000);
}

function limpiar() {
  document.querySelectorAll("input,textarea,select").forEach(e => e.value = "");
}

function enviar() {
  const data = obtenerDatos();
  if (!data) return;

  mostrarMensaje("Enviando...", "loading");

  fetch("https://n8n.globalnexoshop.com/webhook/abeb7f0c-228e-429f-8abd-3cf0d21a962d", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  }).then(() => {
    mostrarMensaje("Cierre enviado ✔", "success");
    setTimeout(limpiar, 3000);
  });
}

function verificar() {
  const data = obtenerDatos();
  if (!data) return;

  document.getElementById("verificacion").innerText = "Verificando…";

  fetch("https://n8n.globalnexoshop.com/webhook/verificar", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  })
    .then(r => r.json())
    .then(res => {
      const r = res[0];   // n8n siempre responde en un array

      const html = `
    <div style="padding:15px;border-radius:8px;background:#f4f4f4;margin-top:10px;">
      <h3>${r.status.toUpperCase()}</h3>
      <p>${r.message}</p>
      <hr>
      <p><b>Datafono:</b> ${r.valores.datafono}</p>
      <p><b>Transferencias:</b> ${r.valores.transferencias}</p>
      <p><b>Efectivo esperado:</b> ${r.valores.efectivoEsperado}</p>
      <p><b>Caja:</b> ${r.valores.caja}</p>
      <p><b>Diferencia:</b> ${r.valores.diferenciaCaja}</p>
    </div>
  `;

      document.getElementById("verificacion").innerHTML = html;
    });
}
