# 2026-06-24 — Nómina con cálculos web definitivos

## 1. Objetivo de la petición
Adaptar el módulo de nómina para consumir la nueva estructura del webhook (`parametros`, `detalle`, `apoyos`, `resumen_tiempos`, `totales`, `metadata`) y trasladar los cálculos principales desde BD hacia la interfaz web, conservando el comprobante con datos de empresa, empleado, ingresos, deducciones y neto.

## 2. Archivos implicados

### `nomina/index.html` — modificación de estructura visual
- Se renombró la tabla de **Parámetros usados** a **Parámetros**.
- Se agregaron las secciones **Parámetros tiempo**, **Detalles**, **Parámetros cálculo** y **Detalles cálculos**.
- Se añadió el panel de **ingresos auxiliares** y **deducciones auxiliares** fuera de las tablas del PNG.
- Se mantiene el comprobante principal con empresa, empleado, ingresos, deducciones y neto.

### `js/nomina.js` — modificación funcional aislada del módulo nómina
- Se añadió normalización de parámetros con `row_id`, cálculo de día calendario en web y partición de horas entre diurnas/nocturnas según los parámetros editables.
- Se añadió la tabla de parámetros monetarios editable, con posibilidad de agregar parámetros auxiliares no persistentes.
- Se añadió la tabla de parámetros de tiempo con rangos seleccionables en intervalos de 5 minutos.
- Se reemplazó el cálculo editable manual de horas por cálculo dinámico según fecha, horario y parámetros de tiempo.
- Se añadió **Parámetros cálculo** para conectar parámetros monetarios con columnas de tiempo.
- Se añadió **Detalles cálculos**, con valores monetarios por fila y total acumulado.
- Se recalculan ingresos de horas diurnas, nocturnas, dominicales diurnas, dominicales nocturnas, auxilio de transporte, horas de apoyo y propinas de apoyo desde la interfaz.
- Se añadieron ingresos auxiliares y deducciones auxiliares temporales que afectan el neto y el comprobante.
- Se modificó la exportación Excel para reutilizar los cálculos ya presentes en interfaz cuando la nómina fue consultada antes de exportar.
- El PNG sigue dibujándose manualmente solo con empresa, empleado, ingresos, deducciones y neto, sin incluir las tablas operativas nuevas.

### `css/nomina.css` — modificación visual aislada del módulo nómina
- Se añadieron estilos para tablas anchas, campos editables, parámetros auxiliares con fondo naranja transparente, avisos de no persistencia y paneles auxiliares.
- Se evitó colocar tablas grandes una al lado de otra mediante `.nomina-wide-panel`.

## 3. Reversión de emergencia

> Recomendación rápida: revertir el commit completo con `git revert <hash_del_commit>` si se necesita volver de inmediato al estado anterior.

### Reversión manual por archivo

#### `nomina/index.html`
1. Restaurar el bloque anterior que contenía `#nominaPayrollOverrides`.
2. Cambiar el título **Parámetros** nuevamente a **Parámetros usados**.
3. Quitar los bloques completos con estos cuerpos:
   - `#nominaParametrosTiempoBody`
   - `#nominaParametrosCalculoBody`
   - `#nominaDetallesCalculosBody`
   - `#nominaAuxiliaresPanel`
4. Restaurar el encabezado anterior de **Detalle calculado** con columnas: `Validar`, `Fecha`, `Horario`, `Diurnas`, `Nocturnas`, `Dom. diurnas`, `Dom. nocturnas`, `Valor fila`.

#### `js/nomina.js`
1. Quitar las constantes DOM nuevas:
   - `parametrosTiempoBody`
   - `parametrosCalculoBody`
   - `detallesCalculosBody`
   - `auxiliaresPanel`
2. Quitar del `state` las propiedades:
   - `parametrosTiempo`
   - `parametrosCalculo`
   - `ingresosAuxiliares`
   - `deduccionesAuxiliares`
3. Eliminar helpers añadidos para esta versión:
   - `escapeHtml`
   - `buildTimeOptions`
   - `dateToDayName`
   - `calculateDetalleTimes`
   - `defaultParametroCalculo`
   - `ensureParametroCalculo`
   - `calculateAuxilioQuantity`
   - `calculateMoneyByDetail`
4. Restaurar la implementación previa de `buildPayrollRowsFromEditableDetail` para que vuelva a usar horas editables y tarifas.
5. Restaurar la implementación previa de `renderPayrollOverrideControls` y `renderParametrosYDetalle`.
6. Quitar los listeners nuevos asociados a parámetros, tiempos, parámetros cálculo y auxiliares.
7. En `descargarExcelEmpleado`, eliminar `buildCurrentCalculatedData` y el retorno temprano que usa `state.detalleCalculo.length`.

#### `css/nomina.css`
Eliminar el bloque agregado al final desde `.nomina-wide-panel` hasta el `@media` nuevo relacionado con `.nomina-aux-grid`.

## 4. Guía para exportar este cambio a otro repositorio

1. Generar el parche desde este repositorio:
   ```bash
   git format-patch -1 HEAD
   ```
2. Aplicarlo en el otro repositorio:
   ```bash
   git am 0001-*.patch
   ```
3. Verificar que el otro repositorio tenga un archivo equivalente a `js/webhooks.js`, porque este proyecto centraliza URLs ahí y `js/nomina.js` consume `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` desde ese archivo.
4. Validar que existan las dependencias usadas por nómina:
   - `js/session.js` para headers y contexto.
   - `js/responsables.js` para empleados activos.
   - `js/environment.js` para entorno activo.
   - `js/supabase.js` para respaldo Supabase.
   - `js/png_branding.js` para marca en PNG.
5. Si el repositorio destino tiene otro nombre para el webhook de consulta de nómina, centralizarlo primero en su archivo de URLs y luego ajustar el import en `js/nomina.js` sin codificar URLs directas.
6. Validar que el HTML destino tenga los IDs usados por el JS: `nominaParametrosBody`, `nominaParametrosTiempoBody`, `nominaDetalleCalculoBody`, `nominaParametrosCalculoBody`, `nominaDetallesCalculosBody`, `nominaApoyosBody`, `nominaIngresosBody`, `nominaDeduccionesBody` y `nominaAuxiliaresPanel`.
7. Ejecutar validaciones mínimas:
   - `node --check js/nomina.js`
   - consulta manual de nómina con payload nuevo
   - descarga PNG
   - descarga Excel después de consultar

## 5. Check funcional para logs
- Nómina — consulta webhook nuevo: funciona con estructura `parametros/detalle/apoyos` y calcula en interfaz.
- Nómina — parámetros monetarios editables: funciona; valores alteran ingresos calculados temporalmente.
- Nómina — parámetros auxiliares: funciona; no se guardan y muestran aviso naranja.
- Nómina — parámetros tiempo: funciona; rangos editables en intervalos de 5 minutos.
- Nómina — detalles: funciona; horas se calculan automáticamente y ya no son editables.
- Nómina — dominicales: funciona para sábado y domingo usando el día calendario de `fecha`.
- Nómina — parámetros cálculo: funciona; los matches alteran la tabla de cálculos y los ingresos.
- Nómina — detalles cálculos: funciona con totales por fila y total general.
- Nómina — apoyos: funciona y ocupa ancho completo.
- Nómina — ingresos/deducciones auxiliares: funciona; afectan total y comprobante actual, sin persistencia.
- Nómina — PNG comprobante: funciona sin incluir tablas operativas nuevas.
- Nómina — Excel empleado: funciona tomando cálculos de interfaz cuando ya hay consulta cargada.
- Login/sesión/header/contexto: no fueron modificados.
- Cierre turno, inventario, compras y otros módulos: no fueron modificados.

---

# Parche 1 — 2026-06-24

## Objetivo del parche
Corregir observaciones posteriores a la implementación principal: limpiar el formulario de Credibanco para evitar credenciales predeterminadas/autorrellenadas, hacer funcionales los ingresos y deducciones auxiliares de nómina, ordenar detalles por fecha descendente, ocultar el acceso auxiliar de cierre de turno del acordeón principal y mejorar la lectura móvil de las tablas de nómina.

## Archivos implicados en el parche

### `configuracion/credibanco.html`
- Se añadieron atributos anti-autorrelleno (`autocomplete`, `name` específico, `data-lpignore`, `value=""`) en el formulario y campos de Credibanco.
- Objetivo: evitar que el navegador o gestores de contraseñas presenten valores predeterminados compartidos entre cuentas.

### `js/credibanco.js`
- Se añadió `clearCredentialFields()` al cargar, al volver desde bfcache (`pageshow`) y con un pequeño retardo.
- Objetivo: asegurar que Client ID y Client Secret inicien vacíos por sesión visual y no se hereden valores anteriores.

### `js/nomina.js`
- Se añadió ordenamiento por fecha descendente para detalles y apoyos.
- Se corrigió el panel de ingresos/deducciones auxiliares para que solo existan filas reales después de pulsar añadir, se actualicen en evento `input` y afecten el total inmediatamente.
- Los auxiliares calculan el total como `valor * cantidad` para que el importe refleje la cantidad indicada.

### `configuracion/index.html`
- Se agregó un bloque colapsado `Accesos de emergencia` fuera de los acordeones principales con enlace a cierre de turno auxiliar.
- Objetivo: mantener disponible el módulo auxiliar sin exponerlo en el flujo normal de configuración.

### `css/configuracion.css`
- Se añadieron estilos discretos para el bloque colapsado de emergencia.

### `css/nomina.css`
- Se añadió comportamiento móvil con scroll horizontal por tabla, ancho mínimo y aviso de deslizamiento.
- Objetivo: conservar la visualización tipo tabla en celular, evitando que las celdas se apilen como cuadritos.

## Reversión de emergencia del parche
1. Revertir el commit del parche con `git revert <hash_del_parche>`.
2. Manualmente, si se requiere:
   - En `configuracion/credibanco.html`, quitar los atributos añadidos a `credibancoForm`, `credibancoClientId` y `credibancoClientSecret`.
   - En `js/credibanco.js`, borrar `clearCredentialFields()` y sus llamadas.
   - En `js/nomina.js`, quitar `sortByDateDesc`, `toDateSortValue`, el uso de ordenamiento en detalle/apoyos y restaurar el render anterior de auxiliares.
   - En `configuracion/index.html`, borrar el bloque `<details class="config-emergency-access">`.
   - En `css/configuracion.css`, borrar el bloque `.config-emergency-access`.
   - En `css/nomina.css`, borrar `.nomina-aux-empty` y el último `@media (max-width: 760px)` agregado en este parche.

## Check funcional del parche
- Credibanco: los campos quedan vacíos al entrar y no tienen valores hardcodeados en HTML.
- Nómina auxiliares: añadir ingreso/deducción crea una fila real; valor y cantidad actualizan el neto durante la edición.
- Nómina fechas: detalles y apoyos quedan ordenados de fecha más reciente a más antigua.
- Configuración cierre auxiliar: no aparece en acordeones principales; queda disponible solo en `Accesos de emergencia`.
- Nómina móvil: las tablas conservan formato tabular y se navegan por scroll horizontal.
