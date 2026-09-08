# Cierre de turno: locales, propinas y exportable

## Objetivo

Corregir el cierre de turno usado desde un local, asegurar que sus apoyos se consulten en las tablas `_locales`, distribuir exactamente la propina general y guardar en `propina_global` sólo la parte correspondiente al responsable principal. El comprobante conserva el formato PNG multipágina existente, pero aclara el nombre "Propina general" y muestra el desglose de responsable y apoyos.

## Archivos implicados

- `js/cierre_turno.js`: envía como `propina_global` la parte del responsable (`data-propina-responsable`), conserva el total en `resumen.total_propinas`, informa al backend si el contexto esperado es local y rechaza visualmente una respuesta cuyo destino no coincida.
- `js/apoyos.js`: no fue modificado; sigue aplicando al DOM el resultado de la Edge Function y conserva separadas la propina general y la del responsable.
- `supabase/functions/consultar-propina-apoyos/index.ts`: concilia el reparto en centavos mediante residuos mayores. Las propinas con fecha inválida o fuera de la jornada no se contabilizan como distribuidas.
- `js/historico_cierre_turno.js`: selecciona `apoyos_turno_locales` en contexto local, incluye `numero_turno` en el enlace y recompone `propinas = responsable + apoyos`, exponiendo ambos subtotales. Para cierres anteriores al 2026-08-28 interpreta el valor legado como total y resta apoyos, evitando duplicarlos.
- `js/cierre_turno_png.js`: cambia la etiqueta financiera a "Propina general". Mantiene paginación PNG y la tabla final con responsable/apoyos.
- `cierre_turno/index.html` y `cierre_turno/historico_cierre_turno.html`: textos aclaratorios y versiones de caché de los JavaScript modificados.

No se modificaron login, sesión, contexto, encabezado ni archivos matrices de navegación.

## Simulación ficticia de Loggro

Se simuló la estructura relevante de una respuesta de facturas pagadas: facturas con `paid.paymentMethodValue[]`, cada pago con `tip` y `createdOn`, y personas activas según el instante. Casos ejecutados: sin apoyo, apoyo parcial, dos apoyos simultáneos, pago en límite horario y turno que cruza medianoche.

Resultados: en los cinco casos `responsable + apoyos = propina general`, sin sobrepasar el total. Ejemplo de $40.000 con un apoyo presente sólo durante $30.000 de propinas: responsable $25.000, apoyo $15.000, suma $40.000. En una división no exacta de $20.000 entre distintos bloques, el residuo se concilió a centavos y la suma final continuó siendo $20.000.

## Verificaciones y estado

- [x] BATUT VIVA está clasificado en producción como local (`app_es_local = true`).
- [x] El RPC activo contiene la ruta a `cierres_turno_final_locales`.
- [x] La consulta de producción confirma que el último cierre de BATUT VIVA guardado es del 2026-08-23; no se insertaron datos ficticios.
- [x] Sintaxis de `cierre_turno.js`, `apoyos.js`, `cierre_turno_png.js` e `historico_cierre_turno.js` validada con `node --check`.
- [x] Edge Function validada con `deno check`.
- [x] Cinco escenarios ficticios conciliaron exactamente la propina.
- [x] Cierre principal: su tabla y flujo permanecen diferenciados.
- [x] Cierre local: el RPC resuelve tabla local y el cliente valida la respuesta.
- [x] Histórico local: consulta cierres y apoyos locales.
- [x] Exportable: mantiene marca de agua, divide apoyos en varias imágenes si hace falta y muestra el desglose.
- [x] Prueba controlada autenticada: el RPC guardó 3 filas en `cierres_turno_final_locales` y 1 en `apoyos_turno_locales`; devolvió `es_local: true`, `variables_guardadas: 3` y `apoyos_guardados: 1`.
- [x] Persistencia comprobada antes de limpiar: responsable $25.000, apoyo $15.000 y total reconstruido $40.000.
- [x] Limpieza comprobada: se borraron exactamente 3 filas del cierre y 1 del apoyo; consulta posterior devolvió cero filas restantes para el token de prueba.
- [x] Edge Function y Firebase Hosting desplegados el 2026-08-28.
- [ ] Login/sesión/header: no modificados; fuera del alcance funcional de este parche.

## Evidencia visual posterior

La primera renderización de prueba descubrió que un nombre largo de local podía superponerse al título. Se añadió ajuste automático del tamaño de fuente y se repitió la prueba. La evidencia corregida está en `docs/evidencia_2026-08-28_png_propinas_corregida.png`: muestra propina general $40.000, responsable $25.000, apoyos $10.000 y $5.000, tiempos, rangos y marca de agua sin tablas cortadas.

### Prueba adicional por bloques horarios

Se detectó y corrigió que el backend consideraba al principal presente durante todo el día. Ahora usa `apoyo.hora_inicio` y `apoyo.hora_fin`, igual que cada apoyo usa su rango propio. Prueba solicitada:

| Horas Loggro | Presentes | Asignación por movimiento |
|---|---|---|
| 06:00 a 16:00 (11 movimientos de $1.000) | Principal | $11.000 al principal |
| 17:00 y 18:00 (2 movimientos de $1.000) | Principal + apoyo | $500 para cada persona por movimiento |
| **Resultado** | | **Principal $12.000 + apoyo $1.000 = Loggro $13.000** |

Los extremos son inclusivos: un movimiento exactamente a las 17:00 o a las 18:00 cuenta para el apoyo cuyo rango es 17:00–18:00. Un movimiento posterior a las 18:00 no cuenta para ese apoyo. La simulación procesó los 13 movimientos individualmente y verificó igualdad exacta. El PNG producido por el generador real está en `docs/evidencia_2026-08-28_png_bloques_tiempo.png` y contiene propina general $13.000, principal $12.000, apoyo $1.000 y ambas franjas.

## Reversión de emergencia

1. En `js/cierre_turno.js`, volver `global.propina_global` a `inputsSoloVista.propina.value || 0`, borrar `es_local_contexto` y el bloque que compara `data.es_local`.
2. En `js/historico_cierre_turno.js`, borrar `APOYO_TABLES`, volver `.from("apoyos_turno")`, quitar `numero_turno` del `select` y de ambas claves, y borrar las cuatro líneas que calculan `propinaResponsable`, `propinaApoyos` y actualizan `row.general`.
3. En `consultar-propina-apoyos/index.ts`, restaurar `totalRealPropinas += propina` antes de validar fecha/participantes y sustituir el bloque de conciliación por el redondeo individual anterior.
4. Restaurar "Propina" en `cierre_turno_png.js` y en la fila financiera del HTML; restaurar "Propina" en el encabezado de apoyos si se desea.
5. Restaurar las versiones anteriores de los query strings de ambos HTML y redesplegar Hosting. Si la Edge Function ya fue desplegada, desplegar la revisión anterior con `npx supabase functions deploy consultar-propina-apoyos`.

## Exportación a otro repositorio

Copiar los siete archivos modificados conservando sus rutas relativas. Este repositorio centraliza Supabase en `js/supabase.js` y el contexto en `js/session.js`; no duplique URLs ni credenciales. El repositorio destino debe mantener esos puntos centrales, las tablas gemelas `cierres_turno_final`/`cierres_turno_final_locales` y `apoyos_turno`/`apoyos_turno_locales`, y un RPC `subir_cierre_turno(jsonb)` que devuelva `es_local`.

Antes de integrar: revisar conflictos, ejecutar los cuatro `node --check`, ejecutar `deno check supabase/functions/consultar-propina-apoyos/index.ts`, repetir la matriz ficticia, desplegar primero la Edge Function y después Hosting. Finalmente hacer un cierre controlado autenticado en un local y comprobar por lectura que la fila esté en `_locales`, que `propina_global` sea la del responsable y que la suma con apoyos reproduzca la propina general.
