/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/webhooks.js
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
// Webhooks centralizados
// ======================

// registro/registro.js (botón: "Enviar código de verificación" en Registro de Empresa)
export const WEBHOOK_CREAR_CODIGO_VERIFICACION =
  "https://n8n.enkrato.com/webhook/crear_codigo_verificacion";

// registro/registro.js (botón: "Verificar código" en Registro de Empresa)
export const WEBHOOK_VERIFICAR_CODIGO =
  "https://n8n.enkrato.com/webhook/verificar_codigo";

// registro/registro.js (botón: "Continuar registro" en Registro de Empresa)
export const WEBHOOK_REGISTRO_EMPRESA =
  "https://n8n.enkrato.com/webhook/registro";

// registro/usuario.js (botón: "Crear cuenta" en Crear usuario administrador)
export const WEBHOOK_REGISTRO_USUARIO =
  "https://n8n.enkrato.com/webhook/registro_usuario";



// configuracion/contrasena.html (botón: "Verificar" cédula o NIT para recuperación no logueada)
export const WEBHOOK_VERIFICAR_NIT_CEDULA =
  "https://n8n.enkrato.com/webhook/verificar_nit_cedula";


// configuracion/anadir_local.html (botón: "Registrar local y continuar")
export const WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE =
  "https://n8n.enkrato.com/webhook/locales/registrar_local_dependiente";

// configuracion/anadir_local_usuario.html (botón: "Crear usuario / preparar duplicación")
export const WEBHOOK_DUPLICAR_USUARIOS_LOCAL =
  "https://n8n.enkrato.com/webhook/locales/duplicar_usuarios";

// configuracion/registro_empleados.html (botón: "Registrar empleado")
export const WEBHOOK_REGISTRAR_EMPLEADO =
  "https://n8n.enkrato.com/webhook/registro_empleados";

// configuracion/registro_otros_usuarios.html (botón: "Registrar")
export const WEBHOOK_REGISTRO_OTROS_USUARIOS =
  "https://n8n.enkrato.com/webhook/registro_admins_y_revisores";

// cierre_turno/index.html (botón: "Consultar datos" en Cierre de Turno)
export const WEBHOOK_CONSULTAR_DATOS_CIERRE =
  "https://n8n.enkrato.com/webhook/consultar_datos_cierre";

// cierre_turno/index.html (botón: "Verificar" en Cierre de Turno)
export const WEBHOOK_VERIFICAR_CIERRE =
  "https://n8n.enkrato.com/webhook/verificar_cierre";

// cierre_turno/index.html (botón: "Subir cierre" en Cierre de Turno)
export const WEBHOOK_SUBIR_CIERRE =
  "https://n8n.enkrato.com/webhook/subir_cierre";

// cierre_turno/index.html (select: "Responsable" en Cierre de Turno)
export const WEBHOOK_LISTAR_RESPONSABLES =
  "https://n8n.enkrato.com/webhook/listar_responsables";

// configuracion/Loggro.html (guardar credenciales Loggro)
export const WEBHOOK_REGISTRO_CREDENCIALES =
  "https://n8n.enkrato.com/webhook/registro_credenciales";

// configuracion/credibanco.html (guardar credenciales Credibanco)
export const WEBHOOK_REGISTRAR_CREDIBANCO =
  "https://n8n.enkrato.com/webhook/registrar_credibanco";

// cierre_inventarios/index.html (auto-carga al abrir pestaña: traer productos)
export const WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS =
  "https://n8n.enkrato.com/webhook/consultar_inventarios_ingredientes";

// cierre_inventarios/index.html (botón: "Consultar" para traer stock por producto)
export const WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_inventarios";

// cierre_inventarios/index.html (botón: "Subir datos" para persistir cierre de inventarios)
export const WEBHOOK_CIERRE_INVENTARIOS_SUBIR =
  "https://n8n.enkrato.com/webhook/cierre_inventarios_subir";

// configuracion/visualizacion_cierre_inventarios.html (auto-carga productos para switches de visualización)
export const WEBHOOK_CIERRE_INVENTARIOS_VISUALIZACION_PRODUCTOS =
  "https://n8n.enkrato.com/webhook/consultar_inventarios_ingredientes";

// cierre_turno/historico_cierre_turno.html (auto-carga histórico consolidado de cierres de turno)
export const WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS =
  "https://n8n.enkrato.com/webhook/cierre_turno_historico";

// cierre_turno/index.html (botón: "Consultar gastos" para traer gastos extras)
export const WEBHOOK_CONSULTAR_GASTOS =
  "https://n8n.enkrato.com/webhook/consultar_gastos";

// cierre_turno/index.html (auto-carga catálogo de gastos extras para labels dinámicos)
export const WEBHOOK_CONSULTAR_GASTOS_CATALOGO =
  "https://n8n.enkrato.com/webhook/consultar_gastos_catalogo";

// configuracion/visualizacion_cierre_turno.html (webhook: "Consultar gastos" para traer gastos extras)
export const WEBHOOK_CONSULTAR_GASTOS_VISUALIZACION =
  "https://n8n.enkrato.com/webhook/consultar_gastos_visualizacion";

// cierre_inventarios/historico_cierre_inventarios.html (auto-carga histórico de cierres de inventarios)
export const WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS =
  "https://n8n.enkrato.com/webhook/cierre_inventarios_historico";

// cierre_turno y cierre_inventarios (alerta de posible manipulacion tras generar constancia visual)
export const WEBHOOK_ALERTA_MANIPULACION_CIERRE =
  "https://tu-n8n-instancia.com/webhook/alerta-manipulacion-cierre";


// siigo/subir_facturas_siigo/index.html (consultar facturas desde correo)
export const WEBHOOK_CARGAR_FACTURAS_CORREO =
  "https://n8n.enkrato.com/webhook/cargar_facturas_correo";

// siigo/subir_facturas_siigo/index.html (subir/revertir factura en Siigo)
export const WEBHOOK_SUBIR_SIIGO =
  "https://n8n.enkrato.com/webhook/subir_factura_siigo";

// siigo/subir_facturas_siigo/index.html (corregir facturas en panel de revision)
export const WEBHOOK_CORREGIR_FACTURA_INCONVENIENTE =
  "https://n8n.enkrato.com/webhook/corregir_factura_inconveniente";

// siigo/configuracion_siigo/proveedores_siigo.html (listar proveedores del tenant)
export const WEBHOOK_SIIGO_PROVEEDORES_LISTAR =
  "https://n8n.enkrato.com/webhook/siigo_proveedores_listar";

// siigo/configuracion_siigo/proveedores_siigo.html (registrar nuevo proveedor)
export const WEBHOOK_SIIGO_PROVEEDORES_REGISTRAR =
  "https://n8n.enkrato.com/webhook/siigo_proveedores_registrar";

// nomina/index.html (botón: "Consultar nómina")
export const WEBHOOK_NOMINA_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_nomina";

// nomina/index.html (botón: "Descargar Excel empleado")
export const WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO =
  "https://n8n.enkrato.com/webhook/consultar_histórico_empleado";

// configuracion/parametros_nomina.html (selector: "Concepto")
export const WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_concepto_nómina";

// configuracion/parametros_nomina.html (selector: "Tiempo")
export const WEBHOOK_NOMINA_TIEMPOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_tiempo_nómina";

// configuracion/parametros_nomina.html (botón: "Guardar parámetro")
export const WEBHOOK_NOMINA_PARAMETROS_REGISTRAR =
  "https://n8n.enkrato.com/webhook/nuevo_parametro_nómina";

// dashboard/index.html (auto-carga inicial de métricas)
export const WEBHOOK_DASHBOARD_DATOS =
  "https://n8n.enkrato.com/webhook/dashboard";

// compras/index.html (auto-carga al entrar: listar facturas de compras pendientes/revisadas)
export const WEBHOOK_COMPRAS_VERIFICACION_FACTURAS =
  "https://n8n.enkrato.com/webhook/Verificacion_Compras";

// compras/index.html (detalle factura: lista de productos inventario)
export const WEBHOOK_COMPRAS_DATOS_FACTURA =
  "https://n8n.enkrato.com/webhook/Datos_Compras";

// compras/index.html (detalle factura: lista de productos inventario)
export const WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS =
  "https://n8n.enkrato.com/webhook/consultar_inventarios";

// compras/index.html (botón: "Enviar match", subir match factura vs inventario)
export const WEBHOOK_COMPRAS_SUBIR_MATCH =
  "https://n8n.enkrato.com/webhook/Subir_Compras";

/**
 * WEBHOOKS CENTRALIZADOS
 * Instrucción: Para modificar URLs, cambiar SOLO aquí
 */
export const WEBHOOKS = {
  // Permisos excepcionales (crear/actualizar)
  PERMISOS_EXCEPCION: {
    url: "https://ivgzwgyjyqfunheaesxx.supabase.co/rest/v1/rpc/guardar_permiso_excepcion",
    archivos_que_usan: [
      "js/permisos.js"
    ],
    metodo: "POST",
    descripcion: "Guarda permisos especiales por usuario (override)"
  },

  // Aquí irán otros webhooks SOLO para escritura
  EJEMPLO_OTRO: {
    url: "...",
    archivos_que_usan: []
  }
};

// NOTA: Los permisos de LECTURA van DIRECTOS a Supabase, no pasan por webhook

WEBHOOKS.COMPROBANTE_PAGO = {
  url: "https://n8n.enkrato.com/webhook/verificar_pagos",
  archivos_que_usan: [],
  metodo: "POST",
  descripcion: "Recibe comprobantes de pago adjuntos por usuarios"
};

WEBHOOKS.QR_GENERATOR = {
  url: "https://api.qrserver.com/v1/create-qr-code/",
  archivos_que_usan: ["js/facturacion.js"],
  metodo: "GET",
  descripcion: "Generador de QR para mostrar pago en modulo de facturacion"
};

WEBHOOKS.NOTIFICACION_IMAGO = {
  url: "https://tu-n8n-instancia.com/webhook/notificar-impago",
  archivos_que_usan: ["js/gestion_empresas.js"],
  metodo: "POST",
  descripcion: "Notifica cuando una empresa se marca como impaga"
};

WEBHOOKS.FACTURACION_RESUMEN = {
  url: "https://tu-n8n-instancia.com/webhook/facturacion-resumen",
  archivos_que_usan: ["js/facturacion.js"],
  metodo: "POST",
  descripcion: "Fuente opcional para obtener datos de factura por tenant cuando Supabase no responda o se quiera usar intermediario"
};

WEBHOOKS.NOMINA_CONSULTAR = {
  url: WEBHOOK_NOMINA_CONSULTAR,
  archivos_que_usan: ["js/nomina.js"],
  metodo: "POST",
  descripcion: "Consulta movimientos de nómina por empresa, empleado y rango de fechas"
};

WEBHOOKS.NOMINA_CONCEPTOS_CONSULTAR = {
  url: WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR,
  archivos_que_usan: ["js/parametros_nomina.js"],
  metodo: "POST",
  descripcion: "Carga la lista de conceptos disponibles para parámetros de nómina"
};

WEBHOOKS.NOMINA_TIEMPOS_CONSULTAR = {
  url: WEBHOOK_NOMINA_TIEMPOS_CONSULTAR,
  archivos_que_usan: ["js/parametros_nomina.js"],
  metodo: "POST",
  descripcion: "Carga la lista de tiempos disponibles para parámetros de nómina"
};

WEBHOOKS.NOMINA_PARAMETROS_REGISTRAR = {
  url: WEBHOOK_NOMINA_PARAMETROS_REGISTRAR,
  archivos_que_usan: ["js/parametros_nomina.js"],
  metodo: "POST",
  descripcion: "Registra el valor de una combinación de tiempo y concepto para parámetros de nómina por tenant"
};


WEBHOOKS.BILLING_DAILY_ENFORCER = {
  url: "https://n8n.enkrato.com/webhook/billing_daily_enforcer",
  archivos_que_usan: ["n8n workflow", "docs/operacion"],
  metodo: "POST",
  descripcion: "Enforcer diario de facturación (banner, suspension, restauracion)"
};

WEBHOOKS.BILLING_NOTIFICACIONES_PAGOS = {
  url: "https://n8n.enkrato.com/webhook/notificaciones_pagos",
  archivos_que_usan: ["js/revision_pagos.js"],
  metodo: "POST",
  descripcion: "Dispara notificaciones cuando pagos son aprobados/rechazados"
};

WEBHOOKS.BILLING_CREAR_CICLOS = {
  url: "https://n8n.enkrato.com/webhook/crear_ciclos_mensuales",
  archivos_que_usan: ["n8n workflow", "docs/operacion"],
  metodo: "POST",
  descripcion: "Crea ciclos mensuales de facturacion"
};
