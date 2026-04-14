import { protectCurrentPage } from "./router.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";

/**
 * Wrapper de compatibilidad para páginas que ya usan guardPage("modulo").
 */
export async function guardPage(_pageKey = "") {
  await protectCurrentPage({ loginUrl: LOGIN_URL });
}
