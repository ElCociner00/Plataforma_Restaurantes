import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

document.addEventListener("DOMContentLoaded", async () => {
  const context = await getUserContext();

  if (!context) return;

  const header = document.createElement("header");
  header.className = "app-header";

  let menu = "";

  if (context.rol !== "operativo") {
    menu += `<a href="/Plataforma_Restaurantes/dashboard/">Dashboard</a>`;
  }

  menu += `<a href="/Plataforma_Restaurantes/cierre_turno/">Cierre de Turno</a>`;
  menu += `<a href="/Plataforma_Restaurantes/cierre_inventarios/">Cierre inventarios</a>`;

  if (context.rol === "admin_root" || context.rol === "admin") {
    menu += `<a href="/Plataforma_Restaurantes/configuracion/">Configuración</a>`;
  }

  menu += `<button id="logoutBtn" class="logout-btn">Salir</button>`;

  header.innerHTML = `
    <div class="logo">🍽 Plataforma Restaurantes</div>
    <nav>${menu}</nav>
  `;

  document.body.prepend(header);

  document.getElementById("logoutBtn").onclick = async () => {
    await supabase.auth.signOut();
    window.location.href = "/Plataforma_Restaurantes/index.html";
  };
});
