# 2026-08-23_Correccion_visualizacion_cierre_inventarios

## 1. Objetivo
El objetivo de esta actualización fue solucionar un error crítico en la pantalla de `visualizacion_cierre_inventarios.html` que impedía cargar la lista de productos y mostraba el mensaje "Error cargando productos de visualización".

## 2. Archivos implicados
- **Modificados:**
  - `supabase/functions/consultar-inventarios/index.ts`

### Detalles de la modificación:
La función Edge (`consultar-inventarios`) fue adaptada para imitar con exactitud el comportamiento original ("Fallback seguro") del flujo de n8n antiguo (`Llamar_Inventarios.txt`).
En la versión anterior, si el cliente (como la pantalla de visualización) no proveía explícitamente una fecha de consulta en el `body`, el script construía un rango de fecha asumiendo el día de "hoy" (de `00:00:00` a `23:59:59`). 

Sin embargo, al migrar esto a Edge Functions, si el campo `fecha` llegaba vacío, la consulta a Loggro se generaba *sin parámetros de fecha*. Esto causaba que la API de Pirpos `/Ingredients` rechazara la petición, lo que arrojaba un error en la cadena y terminaba en el fallo de la interfaz web.

**Cambios explícitos:**
- Se importó la función auxiliar `hoyLocal()` desde `../_shared/fechas.ts`.
- En `index.ts`, en la línea donde se declara la variable `fecha`, se configuró para usar `hoyLocal()` en caso de que `cuerpo.fecha` venga vacío o nulo.
- De esta manera, el parámetro URLSearchParams siempre incluirá un `dateInit` y un `dateEnd`, satisfaciendo la API externa de Loggro/Pirpos.

## 3. Instrucciones de emergencia (Reversión)
Si estos cambios causan algún fallo colateral o es necesario regresar a la versión anterior que enviaba parámetros vacíos cuando no había fecha, se debe realizar lo siguiente:

1. Abrir `supabase/functions/consultar-inventarios/index.ts`.
2. Remover la importación de `hoyLocal` en la cabecera.
3. Buscar esta línea:
   ```typescript
   const fecha = String(cuerpo.fecha ?? "").trim() || hoyLocal();
   ```
4. Y restaurarla a su versión anterior:
   ```typescript
   const fecha = String(cuerpo.fecha ?? "").trim();
   ```
5. Esto restaurará el comportamiento donde el bloque `if (fecha)` es ignorado por completo cuando la interfaz de configuración no envía una fecha.

## 4. Portabilidad y validaciones
Al exportar este cambio a otro repositorio:
- Es crucial verificar que exista el archivo `_shared/fechas.ts` y que posea la función exportada `hoyLocal()`.
- Validar que cualquier cliente nuevo que se conecte a `consultar-inventarios` soporte este fallback, lo que significa que recibirán la respuesta asumiendo que el usuario quiere ver los datos de 'hoy' si no especifican un rango explícitamente.

## 5. Check de funcionalidades (Logs)
- **Consulta con fecha explícita (Cierre Turno Inventarios):** Funciona perfectamente (comprobado que envía los rangos de horas precisos).
- **Consulta sin fecha (Configuración Visualización):** Funciona y carga el listado para apagar/encender ingredientes, mitigando el "Error cargando productos de visualización".
