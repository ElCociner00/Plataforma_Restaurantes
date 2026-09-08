/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/local_scope.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `resolverEsLocal` (línea aprox. 45): pregunta a la base si la empresa es una sede local.
 * - `tablaSegunSede` (línea aprox. 75): elige la tabla principal o la `_locales`.
 * - `olvidarSede` (línea aprox. 88): invalida la caché al cambiar de contexto.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */

// Resolución de sede: UNA sola fuente de verdad.
// =============================================
// Cada módulo que guarda o lee turnos tiene que decidir si trabaja contra la
// tabla principal (`cierres_turno_final`) o contra la de sedes
// (`cierres_turno_final_locales`). Esa decisión la toma la base con
// `app_es_local()`: es la misma función que usan las políticas RLS y el RPC
// `subir_cierre_turno`, así que preguntarle garantiza que la pantalla lea
// exactamente de donde se escribió.
//
// Antes cada pantalla lo deducía por su cuenta comparando `empresa_id` contra
// `empresa_principal_id` del contexto de sesión. Cuando esa deducción no
// coincidía con la de la base, la pantalla consultaba la tabla equivocada y
// devolvía cero filas — indistinguible de "no hay datos". Eso fue lo que hizo
// creer que no se estaban guardando los turnos.
//
// Regla: si la sede no se puede resolver, esto LANZA. Nunca se elige una tabla
// por defecto. Una pantalla en blanco con un error es diagnosticable; una
// pantalla en blanco sin error costó quince días de turnos.

import { supabase } from "./supabase.js";

const cachePorEmpresa = new Map();

/**
 * ¿La empresa es una sede local? Lo responde `app_es_local()` en la base.
 * El resultado se cachea por empresa: no cambia dentro de una sesión.
 *
 * @param {string} empresaId UUID de la empresa/sede en curso.
 * @returns {Promise<boolean>}
 * @throws si falta la empresa o el RPC falla.
 */
export async function resolverEsLocal(empresaId) {
  const id = String(empresaId || "").trim();
  if (!id) {
    throw new Error("No se pudo identificar la sede: falta el identificador de empresa.");
  }

  if (cachePorEmpresa.has(id)) return cachePorEmpresa.get(id);

  const { data, error } = await supabase.rpc("app_es_local", { p_empresa_id: id });

  if (error) {
    console.error("[local_scope] app_es_local fallo", { empresa_id: id, error });
    throw new Error("No se pudo determinar si esta empresa es una sede. Recarga la página e intenta de nuevo.");
  }

  const esLocal = data === true;
  cachePorEmpresa.set(id, esLocal);
  return esLocal;
}

/**
 * Elige la tabla correcta a partir de una sede YA resuelta.
 *
 * @param {{principal: string, local: string}} tablas
 * @param {boolean} esLocal resultado de `resolverEsLocal`.
 * @returns {string} nombre de la tabla o vista.
 * @throws si `esLocal` todavía no se resolvió.
 */
export function tablaSegunSede(tablas, esLocal) {
  if (esLocal !== true && esLocal !== false) {
    throw new Error("La sede aún no se ha resuelto: no se puede elegir la tabla de consulta.");
  }
  return tablas[esLocal ? "local" : "principal"];
}

/** Invalida la caché de una sede, o la de todas si no se indica ninguna. */
export function olvidarSede(empresaId) {
  const id = String(empresaId || "").trim();
  if (id) cachePorEmpresa.delete(id);
  else cachePorEmpresa.clear();
}
