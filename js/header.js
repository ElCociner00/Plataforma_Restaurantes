import { getUserContext } from "./session.js";

const context = await getUserContext();
if (!context) return;

const header = document.createElement("header");
header.className = "app-header";

let menu = "";

if (context.rol !== "operativo") {
  menu += `<a href="/Plataforma_Restaurantes/dashboard/">Dashboard</a>`;
}

menu += `<a href="/Plataforma_Restaurantes/cierre_turno/">Cierre Turno</a>`;

if (context.rol === "admin_root") {
  menu += `<a href="/Plataforma_Restaurantes/config/">Configuración</a>`;
}

menu += `<a href="#" id="logoutBtn">Salir</a>`;

header.innerHTML = `
  <div class="logo">🍽 Plataforma Restaurantes</div>
  <nav>${menu}</nav>
`;

document.body.prepend(header);

document.getElementById("logoutBtn").onclick = async () => {
  const { supabase } = await import("./supabase.js");
  await supabase.auth.signOut();
  window.location.href = "/Plataforma_Restaurantes/login/";
};
