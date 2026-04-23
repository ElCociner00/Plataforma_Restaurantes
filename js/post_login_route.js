/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/post_login_route.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - Este archivo está orientado a configuración/arranque sin funciones explícitas extensas.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { getUserContext } from "./session.js";
import { getPermisosEfectivos } from "./permisos.core.js";
import { resolveFirstAllowedRoute } from "./access_control.local.js";
import { ENV_LOGGRO } from "./environment.js";
import { APP_URLS } from "./urls.js";

export async function resolvePostLoginRoute() {
  const context = await getUserContext().catch(() => null);
  if (!context) return APP_URLS.dashboard;

  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id || null;
  const permisos = userId ? await getPermisosEfectivos(userId, empresaId).catch(() => []) : [];
  return resolveFirstAllowedRoute(context?.rol, ENV_LOGGRO, permisos);
}
