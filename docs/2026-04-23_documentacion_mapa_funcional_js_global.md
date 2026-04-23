# 2026-04-23 — Documentación técnica: mapa funcional en archivos JS

## 1) Objetivo de la petición
Agregar notas de mantenimiento dentro de **cada archivo JS del repositorio** para separar conceptualmente bloques de trabajo y facilitar ubicación rápida de funciones durante cambios manuales o correcciones de errores.

---

## 2) Archivos implicados, tipo de modificación y objetivo

### Tipo de modificación aplicada (uniforme en todos los archivos listados)
- **Tipo:** documentación inline (comentarios no ejecutables).
- **Qué se hizo:** se agregó al inicio de cada archivo un bloque `MAPA DE MANTENIMIENTO` con:
  - partes generales del archivo (imports/constantes, utilidades, lógica principal, eventos/integraciones),
  - índice de funciones/bloques con línea aproximada y descripción rápida,
  - nota explícita de no impacto funcional.
- **Objetivo explícito:** hacer más simple el mantenimiento manual y la navegación por código sin afectar comportamiento.

### Archivos modificados
- `js/access_control.local.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/anuncio_impago.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/anuncio_impago_config.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/api_integraciones_siigo.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/apoyos.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/auth.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/billing_config.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/cierre_inventarios.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/cierre_turno.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/cierre_turno_png.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/config.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/configuracion.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/correo_facturas_siigo.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/entorno_selector.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/environment.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/facturacion.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/footer.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/gestion_empresas.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/gestion_usuarios.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/header.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/historico_cierre_inventarios.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/historico_cierre_turno.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/input_utils.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/loggro.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/mobile_shell.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/nomina.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/permisos.core.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/permisos.emergencia.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/permisos.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/permisos.sync.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/permisosService.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/permissions.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/plan.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/post_login_route.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/proveedores_siigo.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/public_chrome.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/registro.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/registro_empleados.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/registro_otros_usuarios.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/responsables.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/revision_pagos.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/router.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/session.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/subir_facturas_siigo.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/supabase.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/urls.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/usuario.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/visualizacion_cierre_inventarios.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/visualizacion_cierre_inventarios_historico.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/visualizacion_cierre_turno.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/visualizacion_cierre_turno_historico.js` — añadido encabezado de mapa funcional para mantenimiento.
- `js/webhooks.js` — añadido encabezado de mapa funcional para mantenimiento.

---

## 3) Plan de emergencia / reversión detallada
Si se requiere revertir este cambio masivo de comentarios:
1. En cada archivo JS listado, eliminar únicamente el bloque inicial delimitado por:
   - Inicio: `/**` + línea con `MAPA DE MANTENIMIENTO`
   - Fin: `*/`
2. Verificar que el primer código ejecutable del archivo vuelva a iniciar donde iniciaba antes (imports, constantes o listeners).
3. Ejecutar validación de sintaxis para todos los JS:
   - `for f in js/*.js; do node --check "$f"; done`

> Nota de seguridad: la reversión toca solo comentarios, no funciones ni lógica de negocio.

---

## 4) Nombre del documento
- `2026-04-23_documentacion_mapa_funcional_js_global.md`

---

## 5) Guía para exportar este cambio masivo a otro repositorio
1. Identificar todos los archivos JS del repo destino.
2. Insertar al inicio de cada archivo un bloque homogéneo de mapa funcional (mismo formato de secciones e índice).
3. Validar que la inyección ocurra **antes** del primer bloque ejecutable y no rompa imports ES Modules.
4. Ejecutar chequeo de sintaxis completo (`node --check`) archivo por archivo.
5. Confirmar que no haya herramientas que eliminen comentarios en desarrollo (linters/formatters personalizados).

### Particularidades de este repositorio
- Existe centralización de rutas/webhooks en archivos dedicados (`js/urls.js`, `js/webhooks.js`); mantener sus encabezados descriptivos facilita ubicar dependencias globales.
- Los módulos funcionales de cierre (`cierre_turno`, `cierre_inventarios`, históricos y visualizaciones) comparten naming y flujo por eventos DOM; el mapa agregado mejora el rastreo cruzado.

---

## 6) Check funcional (logs)
- ✅ **Sintaxis JS global:** correcta tras agregar comentarios en todos los archivos.
- ✅ **Lógica de ejecución:** sin cambios (se añadieron solo comentarios).
- ✅ **cierre_turno / cierre_inventarios / históricos:** se mantienen funcionalmente intactos por no alterarse código ejecutable.

---

## 7) Política de parches
Si se agregan más notas sobre esta misma base, extender este documento con sección “parche posterior” y ajustar el nombre según contador de parches definido por la guía.