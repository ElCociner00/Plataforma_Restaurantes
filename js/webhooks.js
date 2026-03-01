// Webhooks centralizados
// ======================

// registro/registro.js (botÃ³n: "Enviar cÃ³digo de verificaciÃ³n" en Registro de Empresa)
export const WEBHOOK_CREAR_CODIGO_VERIFICACION =
  "https://n8n.globalnexoshop.com/webhook/crear_codigo_verificacion";

// registro/registro.js (botÃ³n: "Verificar cÃ³digo" en Registro de Empresa)
export const WEBHOOK_VERIFICAR_CODIGO =
  "https://n8n.globalnexoshop.com/webhook/verificar_codigo";

// registro/registro.js (botÃ³n: "Continuar registro" en Registro de Empresa)
export const WEBHOOK_REGISTRO_EMPRESA =
  "https://n8n.globalnexoshop.com/webhook/registro";

// registro/usuario.js (botÃ³n: "Crear cuenta" en Crear usuario administrador)
export const WEBHOOK_REGISTRO_USUARIO =
  "https://n8n.globalnexoshop.com/webhook/registro_usuario";

// configuracion/registro_empleados.html (botÃ³n: "Registrar empleado")
export const WEBHOOK_REGISTRAR_EMPLEADO =
  "https://n8n.globalnexoshop.com/webhook/registro_empleados";

// configuracion/registro_otros_usuarios.html (botÃ³n: "Registrar")
export const WEBHOOK_REGISTRO_OTROS_USUARIOS =
  "https://n8n.globalnexoshop.com/webhook/registro_admins_y_revisores";

// cierre_turno/index.html (botÃ³n: "Consultar datos" en Cierre de Turno)
export const WEBHOOK_CONSULTAR_DATOS_CIERRE =
  "https://n8n.globalnexoshop.com/webhook/consultar_datos_cierre";

// cierre_turno/index.html (botÃ³n: "Verificar" en Cierre de Turno)
export const WEBHOOK_VERIFICAR_CIERRE =
  "https://n8n.globalnexoshop.com/webhook/verificar_cierre";

// cierre_turno/index.html (botÃ³n: "Subir cierre" en Cierre de Turno)
export const WEBHOOK_SUBIR_CIERRE =
  "https://n8n.globalnexoshop.com/webhook/subir_cierre";

// cierre_turno/index.html (select: "Responsable" en Cierre de Turno)
export const WEBHOOK_LISTAR_RESPONSABLES =
  "https://n8n.globalnexoshop.com/webhook/listar_responsables";

// configuracion/Loggro.html (guardar credenciales Loggro)
export const WEBHOOK_REGISTRO_CREDENCIALES =
  "https://n8n.globalnexoshop.com/webhook/registro_credenciales";

// cierre_inventarios/index.html (auto-carga al abrir pestaÃ±a: traer productos)
export const WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS =
  "https://n8n.globalnexoshop.com/webhook/consultar_inventarios_ingredientes";

// cierre_inventarios/index.html (botÃ³n: "Consultar" para traer stock por producto)
export const WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR =
  "https://n8n.globalnexoshop.com/webhook/consultar_inventarios";

// cierre_inventarios/index.html (botÃ³n: "Subir datos" para persistir cierre de inventarios)
export const WEBHOOK_CIERRE_INVENTARIOS_SUBIR =
  "https://n8n.globalnexoshop.com/webhook/cierre_inventarios_subir";

// configuracion/visualizacion_cierre_inventarios.html (auto-carga productos para switches de visualizaciÃ³n)
export const WEBHOOK_CIERRE_INVENTARIOS_VISUALIZACION_PRODUCTOS =
  "https://n8n.globalnexoshop.com/webhook/consultar_inventarios_ingredientes";

// cierre_turno/historico_cierre_turno.html (auto-carga histÃ³rico consolidado de cierres de turno)
export const WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS =
  "https://n8n.globalnexoshop.com/webhook/cierre_turno_historico";

// cierre_turno/index.html (botÃ³n: "Consultar gastos" para traer gastos extras)
export const WEBHOOK_CONSULTAR_GASTOS =
  "https://n8n.globalnexoshop.com/webhook/consultar_gastos";

// cierre_turno/index.html (auto-carga catÃ¡logo de gastos extras para labels dinÃ¡micos)
export const WEBHOOK_CONSULTAR_GASTOS_CATALOGO =
  "https://n8n.globalnexoshop.com/webhook/consultar_gastos_catalogo";

// configuracion/visualizacion_cierre_turno.html (webhook: "Consultar gastos" para traer gastos extras)
export const WEBHOOK_CONSULTAR_GASTOS_VISUALIZACION =
  "https://n8n.globalnexoshop.com/webhook/consultar_gastos_visualizacion";

// cierre_inventarios/historico_cierre_inventarios.html (auto-carga histÃ³rico de cierres de inventarios)
export const WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS =
  "https://n8n.globalnexoshop.com/webhook/cierre_inventarios_historico";


// siigo/subir_facturas_siigo/index.html (consultar facturas desde correo)
export const WEBHOOK_CARGAR_FACTURAS_CORREO =
  "https://n8n.globalnexoshop.com/webhook/cargar_facturas_correo";

// siigo/subir_facturas_siigo/index.html (subir/revertir factura en Siigo)
export const WEBHOOK_SUBIR_SIIGO =
  "https://n8n.globalnexoshop.com/webhook/subir_factura_siigo";

/**
 * WEBHOOKS CENTRALIZADOS
 * InstrucciÃ³n: Para modificar URLs, cambiar SOLO aquÃ­
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

  // AquÃ­ irÃ¡n otros webhooks SOLO para escritura
  EJEMPLO_OTRO: {
    url: "...",
    archivos_que_usan: []
  }
};

// NOTA: Los permisos de LECTURA van DIRECTOS a Supabase, no pasan por webhook

WEBHOOKS.COMPROBANTE_PAGO = {
  url: "https://tu-n8n-instancia.com/webhook/comprobante-pago",
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
