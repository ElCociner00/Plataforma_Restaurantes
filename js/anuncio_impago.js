import { getSessionConEmpresa } from "./session.js";

let anuncioInyectado = false;

export async function verificarYMostrarAnuncio() {
  const session = await getSessionConEmpresa();
  if (!session?.empresa?.mostrar_anuncio_impago) {
    ocultarAnuncio();
    return;
  }
  mostrarAnuncio();
}

function mostrarAnuncio() {
  if (anuncioInyectado) return;

  const anuncio = document.createElement("div");
  anuncio.id = "anuncio-impago";
  anuncio.innerHTML = `
    <div style="
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #dc2626;
      color: white;
      text-align: center;
      padding: 8px;
      z-index: 9999;
      font-weight: bold;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.2);
    ">
      ESTA EMPRESA TIENE PAGOS PENDIENTES - POR FAVOR REGULARIZAR SU SITUACION
    </div>
  `;
  document.body.appendChild(anuncio);
  anuncioInyectado = true;
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  anuncioInyectado = false;
}

document.addEventListener("DOMContentLoaded", verificarYMostrarAnuncio);
window.addEventListener("empresaCambiada", verificarYMostrarAnuncio);
