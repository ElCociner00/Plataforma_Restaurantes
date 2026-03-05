import { getUserContext } from "./session.js";
import { ENV_LOGGRO, ENV_SIIGO, setActiveEnvironment } from "./environment.js";

const btnLoggro = document.getElementById("btnEntornoLoggro");
const btnSiigo = document.getElementById("btnEntornoSiigo");
const status = document.getElementById("status");

const goByRole = async (env) => {
  const context = await getUserContext();
  if (!context) {
    status.textContent = "No se pudo validar la sesión.";
    return;
  }

  setActiveEnvironment(env);

  if (env === ENV_SIIGO) {
    if (String(context.rol || "").toLowerCase() === "operativo") {
      status.textContent = "Acceso a Siigo bloqueado para rol operativo.";
      setActiveEnvironment(ENV_LOGGRO);
      window.location.href = "/Plataforma_Restaurantes/cierre_turno/";
      return;
    }
    window.location.href = "/Plataforma_Restaurantes/siigo/subir_facturas_siigo/";
    return;
  }

  if (context.rol === "operativo") {
    window.location.href = "/Plataforma_Restaurantes/cierre_turno/";
  } else {
    window.location.href = "/Plataforma_Restaurantes/dashboard/";
  }
};

const initRoleUi = async () => {
  const context = await getUserContext().catch(() => null);
  if (!context) return;
  if (String(context.rol || "").toLowerCase() === "operativo") {
    btnSiigo.disabled = true;
    btnSiigo.title = "Bloqueado para rol operativo";
  }
};

btnLoggro?.addEventListener("click", () => goByRole(ENV_LOGGRO));
btnSiigo?.addEventListener("click", () => goByRole(ENV_SIIGO));
initRoleUi();
