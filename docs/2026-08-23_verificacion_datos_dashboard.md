# Verificación de datos del Dashboard Analítico

**Fecha:** 2026-08-23
**Base:** copia de desarrollo «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`)
**Cuenta usada:** `admin_root` de BATUT VIVA, con acceso a 2 sedes
(BATUT VIVA y BATUT LE MERIDIEM)

---

## 1 · Método

Para que la comprobación valga algo, el número de control no puede salir de la
misma cañería que se está comprobando. Se usaron **dos caminos independientes**:

| | Camino |
|---|---|
| **Medido** | `dashboard_ventas()` y `dashboard_conciliacion()` — el RPC real que llama el navegador, con RLS y filtro de empresa incluidos |
| **Control** | `turnos_agrupados` + `turnos_agrupados_locales`, columna `ventas_brutas` — tablas que el sistema escribe por separado y que el dashboard **no toca** |

El camino medido parte de `cierres_turno_final*` (modelo línea a línea, tipo
EAV) y lo pivota. El control es un total por turno ya consolidado en otra
tabla. Si ambos coinciden, el error tendría que estar en los dos sitios a la
vez y del mismo tamaño.

---

## 2 · Resultado: cuadre exacto, 7 de 7 meses

| Mes | Turnos RPC | Turnos control | Ventas RPC | Ventas control | Diferencia |
|---|---:|---:|---:|---:|---:|
| 2026-02 | 22 | 22 | 27.656.323 | 27.656.323 | **0** |
| 2026-03 | 42 | 42 | 52.208.534 | 52.208.534 | **0** |
| 2026-04 | 48 | 48 | 64.946.587 | 64.946.587 | **0** |
| 2026-05 | 61 | 61 | 84.630.525 | 84.630.525 | **0** |
| 2026-06 | 61 | 61 | 86.036.809 | 86.036.809 | **0** |
| 2026-07 | 93 | 93 | 118.006.572 | 118.006.572 | **0** |
| 2026-08 | 86 | 86 | 114.883.698 | 114.883.698 | **0** |
| **Total** | **413** | **413** | **548.369.048** | **548.369.048** | **0** |

Coinciden al peso y turno por turno: los 413 turnos del pivote emparejan con
los 413 del control, sin sobrantes por ningún lado.

---

## 3 · Comprobaciones de integridad

| Comprobación | Resultado |
|---|---|
| Turnos presentes a la vez en `cierres_turno_final` y en su gemela `_locales` | **0** — no hay doble conteo entre sedes madre y locales |
| Líneas duplicadas por `(empresa, fecha, turno, variable, categoría)` | **123 de 7.802** — el `DISTINCT ON` de `v_turnos_lineas` las descarta correctamente; sin él los canales saldrían inflados |
| Turnos con `total_global` inconsistente entre sus líneas | **1 de 413** — ver hallazgo H1 |

---

## 4 · Hallazgos

### H1 · Un turno con dos totales, y el pivote se queda con el viejo

**BATUT LE MERIDIEM, 2026-06-10, turno 1.**

Cronología de las líneas de ese turno:

| Momento | Líneas | `total_global` |
|---|---:|---:|
| 20:17:01 | 2 | 1.185.400 |
| 20:20:56 – 20:20:58 | 16 | **1.155.900** |

El turno se volvió a subir cuatro minutos después con un total corregido de
**1.155.900**, pero dos líneas del primer envío sobrevivieron: corresponden a
combinaciones de `variable`/`categoría` que el segundo envío no traía, así que
el `DISTINCT ON` no tenía con qué reemplazarlas.

`v_turnos_pivote` resuelve el conflicto con `MAX(total_global)`, y **el máximo
es el valor viejo**: se queda con 1.185.400 en vez de 1.155.900.

- **Impacto:** 29.500 pesos de más en junio de 2026, sobre 86.036.809. Un
  0,03 %.
- **Nota:** `turnos_agrupados` arrastra el mismo valor viejo, por eso el cuadre
  del punto 2 da cero. Los dos caminos coinciden porque **los dos** heredaron
  el mismo dato obsoleto.
- **Causa de fondo:** `MAX()` no significa «el más reciente». Hoy acertó por
  casualidad —la corrección fue hacia abajo, así que el máximo era el viejo—,
  pero si una corrección fuera hacia arriba, `MAX()` tomaría la buena. Es
  aleatorio.
- **Arreglo propuesto:** en `v_turnos_pivote`, sustituir `MAX(total_global)` por
  el valor de la línea más reciente:
  `(array_agg(total_global ORDER BY created_at DESC))[1]`. Lo mismo aplica a
  `caja_global`, `propina_global`, `domicilios_global`, `bolsa_global` y
  `efectivo_apertura`, que usan `MAX` por el mismo motivo.

### H2 · La dona de canales no suma la cifra de «Ventas Totales»

La tarjeta muestra `total_global` (el total declarado del turno). La dona
muestra la suma de los canales registrados como `sistema`. No son lo mismo:

| Mes | Total declarado | Suma de canales | Brecha |
|---|---:|---:|---:|
| 2026-02 | 27.656.323 | 27.198.981 | 1,7 % |
| 2026-03 | 52.208.534 | 51.175.563 | 2,0 % |
| 2026-04 | 64.946.587 | 63.519.822 | 2,2 % |
| 2026-05 | 84.630.525 | 81.075.351 | 4,2 % |
| 2026-06 | 86.036.809 | 83.528.505 | 2,9 % |
| 2026-07 | 118.006.572 | 111.178.828 | 5,8 % |
| 2026-08 | 114.883.698 | 112.291.155 | 2,3 % |
| **Total** | **548.369.048** | **529.968.205** | **3,4 %** |

Comprobado que **no** se explica por propinas ni domicilios: en julio la brecha
es de 6.827.744 y propinas + domicilios suman 4.207.933.

Esto no es un fallo introducido por los arreglos: es una diferencia real entre
dos magnitudes que la pantalla presenta juntas sin decir que son distintas.
Quien sume la dona a mano va a encontrar que falta dinero.

**Opciones:**

1. **Etiquetar.** Poner en la dona «Reparto por medio de pago (registrado)» y
   dejar la tarjeta como «Ventas totales declaradas». Es lo más rápido y
   honesto, y no toca datos.
2. **Investigar la brecha.** Averiguar por qué el total declarado supera de
   forma sistemática lo registrado por canal. Un 3,4 % constante durante siete
   meses sugiere un concepto que no se está capturando, no errores sueltos.

Recomiendo la 1 ahora y la 2 como tarea aparte, porque la respuesta está en la
operación del restaurante, no en el código.

---

## 5 · Conclusión

**Los totales del dashboard son correctos.** Coinciden al peso con una fuente
independiente en los siete meses con datos, y el desglose por sede, turno y día
también empareja.

Los dos hallazgos son anteriores a este trabajo y ninguno invalida las cifras:
H1 vale 29.500 pesos en un turno de 413, y H2 no es un error de cálculo sino
dos magnitudes distintas mostradas juntas.

---

## 6 · Decisiones pendientes

1. **¿Arreglo H1** cambiando `MAX(...)` por «la línea más reciente» en
   `v_turnos_pivote`? Es un `CREATE OR REPLACE VIEW`, no toca datos.
2. **¿Etiqueto la dona** como propone la opción 1 de H2?
3. **¿Abro la investigación de la brecha del 3,4 %** como tarea aparte?
