# 2026-09-08 - Reversión Total de Modificaciones y Restauración del Cierre de Turno

## 1. Objetivo de la Petición

El objetivo primordial de esta intervención es **revertir inmediatamente cualquier cambio invasivo realizado sobre los archivos matrices y el flujo operativo de la plataforma** (especialmente en `js/header.js`, `cierre_turno/index.html` y `js/cierre_turno.js`), los cuales rompieron los principios fundamentales de diseño del sistema al provocar que no cargaran las sedes, responsables ni selectores de hora en el formulario de Cierre de Turno.

Se restaura la plataforma al 100% de su estado funcional previo (commit base `4dec31c`), garantizando que:
1. Ningún archivo matriz o de navegación global (`js/header.js`, sesión, login, contexto) sea modificado.
2. La carga de sedes, responsables y selectores de hora en `cierre_turno` funcione con total normalidad.
3. Las nuevas características se desarrollen de manera completamente aislada, de modo que si un nuevo archivo es eliminado, la plataforma existente no sufra ningún impacto ni alteración.

---

## 2. Archivos Implicados y Modificaciones Revertidas

| Archivo | Tipo de Operación | Objetivo Previo | Modificación / Reversión Explícita |
|---|---|---|---|
| `js/header.js` | **Revertido** (Restauración matriz) | Había añadido un enlace a la auditoría en el menú desplegable. | **Se eliminó completamente la línea inyectada**. El header queda intacto como archivo matriz prohibido de tocar. |
| `cierre_turno/index.html` | **Revertido** (Restauración de plantilla) | Había movido el bloque `#bloqueRepartoPropinas` al final del formulario. | **Se restauró la estructura original** del DOM. No contiene elementos desplazados que interfieran con el ciclo de vida del formulario. |
| `js/cierre_turno.js` | **Revertido** (Restauración núcleo) | Había integrado funciones dinámicas de cálculo y renderizado de reparto de propinas. | **Se eliminaron todas las modificaciones invasivas**. Se restableció la carga íntegra y secuencial de sedes, responsables, selectores de horas de llegada y cálculo de caja anterior. |
| `configuracion/index.html` | **Revertido** (Restauración de vista) | Había inyectado un acordeón de control de turnos. | **Se removió el bloque inyectado** en configuraciones, preservando únicamente las secciones autorizadas y preexistentes. |
| `cierre_turno/simulador_propinas.html` | **Revertido** (Aislamiento de módulo) | Había introducido pestañas y controles de modo manual. | **Se restauró a la versión original de auditoría** independiente sin acoplamientos ni dependencias cruzadas. |
| `css/simulador_propinas.css` | **Revertido** | Había agregado reglas CSS adicionales. | **Se restauraron los estilos originales** asociados a la auditoría de propinas. |
| `js/simulador_propinas.js` | **Revertido** | Había modificado el flujo de consulta y modo demo. | **Se restauró el script original** de lectura y auditoría estricta de solo lectura. |
| `supabase/functions/consultar-propina-apoyos/index.ts` | **Revertido** | Había alterado la lectura de payload y rangos de fecha. | **Se restauró la función Edge original** sin alteraciones a su contrato base. |

---

## 3. Notas de Emergencia y Procedimiento de Reversión Manual

En caso de que en un despliegue futuro se detecte cualquier síntoma similar (bloqueo de sedes, ausencia de responsables o caída de selectores), el procedimiento exacto de reversión manual es:

### A. Para `js/header.js`
- Verificar que el dropdown de `Cierre de turno` solo contenga los enlaces autorizados originales:
  - `Cierre de turno` (`APP_URLS.cierreTurno`)
  - `Histórico` (`APP_URLS.cierreTurnoHistorico`)
- **Fragmento a eliminar si reaparece**:
```javascript
<a href="${APP_URLS.simuladorPropinas}">Auditoría de propinas</a>
```

### B. Para `cierre_turno/index.html`
- Verificar que debajo de `#bloqueTotalizados` no existan contenedores externos o modificados que condicionen el evento de envío o la inicialización del DOM.
- **Fragmento a eliminar si reaparece**:
```html
<section class="bloque" id="bloqueRepartoPropinas" ...>
```

### C. Para `js/cierre_turno.js`
- El final del archivo debe culminar limpiamente en el escuchador del botón limpiar:
```javascript
document.getElementById("btnLimpiar")?.addEventListener("click", limpiarFormulario);
```
- **Líneas / funciones a borrar si reaparecen**:
  - `actualizarRepartoPropinasVista()`
  - Cualquier llamada inyectada dentro de `recalcularTotal()` o dentro del flujo de `cargarSedes()`.

### D. Comando de Reversión Git Inmediato
Si los cambios ya están commiteados en git:
```bash
git revert <COMMIT_HASH> --no-edit
git push origin main
```

---

## 4. Identificación del Registro
- **Fecha**: `2026-09-08`
- **Título**: Reversión total de modificaciones invasivas y restauración de estabilidad en Cierre de Turno.
- **Nombre del archivo**: `docs/2026-09-08_reversion_total_simulador_y_restauracion_cierre_turno.md`.

---

## 5. Guía de Exportación a Otro Repositorio y Particularidades

Para replicar o portar este estado a otro repositorio o entorno, siga estos pasos estrictos:

1. **Centralización de URLs**:
   - Este repositorio utiliza `js/app_urls.js` (o `APP_URLS`) como el directorio canónico de rutas web y relativas. Antes de conectar cualquier vista, verifique que su repositorio centralice las URLs en dicho archivo y que ningún script llame a rutas quemadas de forma arbitraria.
2. **Archivos Matrices Protegidos**:
   - **Bajo ninguna circunstancia** modifique:
     - Archivos de login y sesión (`js/login.js`, `js/auth.js`, etc.).
     - Archivo de barra de navegación principal (`js/header.js`).
     - Contexto global del usuario o selector de locales (`js/contexto_global.js`, etc.).
3. **Regla de Aislamiento e Inocuidad**:
   - Todo nuevo módulo debe existir en su propio directorio (o archivo independiente) y ser consumible como una herramienta satélite.
   - Si el archivo nuevo (por ejemplo, `cierre_turno/simulador_propinas.html`) es borrado del servidor, el resto de la plataforma (`cierre_turno/index.html`, etc.) debe continuar funcionando exactamente igual sin lanzar errores en consola ni bloquear funciones existentes.
4. **Validación de Integridad**:
   - Ejecutar verificación sintáctica antes de cualquier despliegue:
     ```bash
     node --check js/cierre_turno.js
     node --check js/header.js
     ```
   - Ejecutar la suite de pruebas unitarias:
     ```bash
     node tools/test_simulador_solo_lectura.mjs
     node tools/test_propinas_reparto.mjs
     node tools/test_cierre_turno_contexto.mjs
     ```

---

## 6. Checklist de Estado y Funcionamiento (Logs de Operatividad)

- **Cierre de Turno (Sedes)**: Funciona perfectamente (carga lista de sedes de la empresa y locales asignados).
- **Cierre de Turno (Responsables)**: Funciona perfectamente (carga lista de empleados activos asociados a la sede).
- **Cierre de Turno (Horas y Selectores de Llegada)**: Funciona perfectamente (los campos de hora y jornada se renderizan e interactúan sin bloqueos).
- **Cierre de Turno (Caja Anterior y Totales)**: Funciona perfectamente (resuelve caja anterior de la sede y calcula faltante/sobrante).
- **Header Global**: Funciona perfectamente (intacto, sin mutaciones no autorizadas).
- **Configuraciones**: Funciona perfectamente (intacto, acordeones y permisos originales preservados).
- **Simulador / Auditoría de Propinas**: Funciona como módulo independiente de solo lectura.
- **Login y Sesión**: Funciona perfectamente.
- **Histórico**: Funciona perfectamente.

---

## 7. Control de Parches Posteriores

Cualquier ajuste menor posterior que se realice para optimizar este flujo sin alterar archivos matrices deberá anexarse al final de este mismo documento bajo la sección `### Parche N`, actualizando el nombre del documento con el sufijo `_y_N_parches.md` conforme al estándar de documentación de la plataforma.
