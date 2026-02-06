// Webhooks centralizados
// ======================

// registro/registro.js (botón: "Enviar código de verificación" en Registro de Empresa)
export const WEBHOOK_CREAR_CODIGO_VERIFICACION =
  "https://n8n.globalnexoshop.com/webhook/crear_codigo_verificacion";

// registro/registro.js (botón: "Verificar código" en Registro de Empresa)
export const WEBHOOK_VERIFICAR_CODIGO =
  "https://n8n.globalnexoshop.com/webhook/verificar_codigo";

// registro/registro.js (botón: "Continuar registro" en Registro de Empresa)
export const WEBHOOK_REGISTRO_EMPRESA =
  "https://n8n.globalnexoshop.com/webhook/registro";

// registro/usuario.js (botón: "Crear cuenta" en Crear usuario administrador)
export const WEBHOOK_REGISTRO_USUARIO =
  "https://n8n.globalnexoshop.com/webhook/registro_usuario";

// configuracion/registro_empleados.html (botón: "Registrar empleado")
export const WEBHOOK_REGISTRAR_EMPLEADO =
  "https://n8n.globalnexoshop.com/webhook/registro_empleados";

// configuracion/registro_otros_usuarios.html (botón: "Registrar")
export const WEBHOOK_REGISTRO_OTROS_USUARIOS =
  "https://n8n.globalnexoshop.com/webhook/registro_admins_y_revisores";

// cierre_turno/index.html (botón: "Consultar datos" en Cierre de Turno)
export const WEBHOOK_CONSULTAR_DATOS_CIERRE =
  "https://n8n.globalnexoshop.com/webhook/consultar_datos_cierre";

// cierre_turno/index.html (botón: "Verificar" en Cierre de Turno)
export const WEBHOOK_VERIFICAR_CIERRE =
  "https://n8n.globalnexoshop.com/webhook/verificar_cierre";

// cierre_turno/index.html (botón: "Subir cierre" en Cierre de Turno)
export const WEBHOOK_SUBIR_CIERRE =
  "https://n8n.globalnexoshop.com/webhook/subir_cierre";

// cierre_turno/index.html (select: "Responsable" en Cierre de Turno)
export const WEBHOOK_LISTAR_RESPONSABLES =
  "https://n8n.globalnexoshop.com/webhook/listar_responsables";

// configuracion/Loggro.html (guardar credenciales Loggro)
export const WEBHOOK_REGISTRO_CREDENCIALES =
  "https://n8n.globalnexoshop.com/webhook/registro_credenciales";

// cierre_inventarios/index.html (auto-carga al abrir pestaña: traer productos)
export const WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS =
  "https://n8n.globalnexoshop.com/webhook/consultar_inventarios_productos";

// cierre_inventarios/index.html (botón: "Consultar" para traer stock por producto)
export const WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR =
  "https://n8n.globalnexoshop.com/webhook/consultar_inventarios";

// cierre_inventarios/index.html (botón: "Verificar" para calcular/traer restante por producto)
export const WEBHOOK_CIERRE_INVENTARIOS_VERIFICAR =
  "https://n8n.globalnexoshop.com/webhook/cierre_inventarios_verificar";

// cierre_inventarios/index.html (botón: "Subir datos" para persistir cierre de inventarios)
export const WEBHOOK_CIERRE_INVENTARIOS_SUBIR =
  "https://n8n.globalnexoshop.com/webhook/cierre_inventarios_subir";

// configuracion/visualizacion_cierre_inventarios.html (auto-carga productos para switches de visualización)
export const WEBHOOK_CIERRE_INVENTARIOS_VISUALIZACION_PRODUCTOS =
  "https://n8n.globalnexoshop.com/webhook/consultar_inventarios_productos";

// cierre_turno/historico_cierre_turno.html (auto-carga histórico consolidado de cierres de turno)
export const WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS =
  "https://n8n.globalnexoshop.com/webhook/historico_cierre_turno_datos";

// configuracion/visualizacion_cierre_turno_historico.html (auto-carga columnas disponibles del histórico)
export const WEBHOOK_HISTORICO_CIERRE_TURNO_COLUMNAS =
  "https://n8n.globalnexoshop.com/webhook/historico_cierre_turno_columnas";

// cierre_turno/index.html (botón: "Consultar gastos" para traer gastos extras)
export const WEBHOOK_CONSULTAR_GASTOS =
  "https://n8n.globalnexoshop.com/webhook/consultar_gastos";
