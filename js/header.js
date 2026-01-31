import { getUserContext } from "./session.js";

const context = await getUserContext();
if (!context) return;

const header = document.createElement("div");
header.className = "header";

let menu = "";

if (context.rol !== "operativo") {
  menu += `<a href="/Plataforma_Restaurantes/dashboard/">Dashboard</a>`;
}

menu += `<a href="/Plataforma_Restaurantes/cierre_turno/">Cierre Turno</a>`;

if (context.rol === "admin_root") {
  menu += `<a href="/Plataforma_Restaurantes/config/">Configuración</a>`;
}

menu += `<button id="logout">Salir</button>`;

header.innerHTML = `
  <strong>Empresa ${context.empresa_id}</strong>
  <nav>${menu}</nav>
`;

document.body.prepend(header);

document.getElementById("logout").onclick = async () => {
  const { supabase } = await import("./supabase.js");
  await supabase.auth.signOut();
  window.location.href = "/Plataforma_Restaurantes/login/";
};
