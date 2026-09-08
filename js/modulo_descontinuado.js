/**
 * Degradación de pantallas cuyo backend en n8n ya no existe.
 *
 * El problema que resuelve: al desconectar n8n, los formularios que apuntaban
 * a un webhook muerto quedaban con el botón activo. El usuario rellenaba,
 * pulsaba y se quedaba mirando un "Guardando..." que no terminaba nunca,
 * porque el fetch tardaba hasta agotar el timeout del navegador y luego fallaba
 * con un error de red sin explicación.
 *
 * En vez de eso: se avisa antes de tocar nada y se bloquean los controles.
 *
 * Uso típico, justo después de resolver las referencias del DOM:
 *
 *   if (!webhookVigente(WEBHOOK_X)) {
 *     avisarModuloDescontinuado({
 *       motivo: motivoObsoleto(WEBHOOK_X),
 *       status,
 *       formularios: [form],
 *     });
 *   }
 */

const CLASE_AVISO = "aviso-modulo-descontinuado";

/**
 * Muestra el motivo y deshabilita los controles de la pantalla.
 *
 * @param {object} opciones
 * @param {string} opciones.motivo       Texto de WEBHOOKS_MUERTOS.
 * @param {Element|null} [opciones.status]      Elemento donde escribir el aviso.
 * @param {Array<Element|null>} [opciones.formularios] Formularios a bloquear.
 * @param {Array<Element|null>} [opciones.controles]   Botones sueltos a bloquear.
 * @returns {boolean} Siempre true, para poder escribir `return avisar(...)`.
 */
export function avisarModuloDescontinuado({
  motivo,
  status = null,
  formularios = [],
  controles = [],
} = {}) {
  const texto = motivo || "Este módulo ya no está disponible.";

  if (status) {
    status.textContent = texto;
    status.classList.add(CLASE_AVISO);
  }

  for (const formulario of formularios) {
    if (!formulario) continue;
    for (const campo of formulario.querySelectorAll("input, select, textarea, button")) {
      campo.disabled = true;
    }
    formulario.setAttribute("aria-disabled", "true");
  }

  for (const control of controles) {
    if (!control) continue;
    control.disabled = true;
    control.setAttribute("aria-disabled", "true");
  }

  console.info("[modulo-descontinuado]", texto);
  return true;
}
