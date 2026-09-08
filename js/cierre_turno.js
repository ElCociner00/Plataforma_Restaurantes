/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/cierre_turno.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `getTimestamp` (línea aprox. 129): Obtiene un valor o recurso.
 * - `toNumberValue` (línea aprox. 143): Bloque funcional del módulo.
 * - `formatCOP` (línea aprox. 148): Formatea datos para visualización.
 * - `formatDurationLabel` (línea aprox. 155): Formatea datos para visualización.
 * - `syncEfectivoRealFromCajaBolsa` (línea aprox. 162): Sincroniza valores/estado.
 * - `getTotalGastosExtras` (línea aprox. 167): Obtiene un valor o recurso.
 * - `getEfectivoSistemaBruto` (línea aprox. 171): Obtiene un valor o recurso.
 * - `getEfectivoSistemaNeto` (línea aprox. 175): Obtiene un valor o recurso.
 * - `getTotalIngresosSistema` (línea aprox. 177): Obtiene un valor o recurso.
 * - `getTotalIngresosReales` (línea aprox. 186): Obtiene un valor o recurso.
 * - `renderTotalizados` (línea aprox. 195): Renderiza/actualiza UI.
 * - `syncEfectivoSistemaDisplay` (línea aprox. 211): Sincroniza valores/estado.
 * - `syncTotalesExtras` (línea aprox. 224): Sincroniza valores/estado.
 * - `setStatus` (línea aprox. 254): Asigna/actualiza estado.
 * - `readResponseBody` (línea aprox. 258): Bloque funcional del módulo.
 * - `enviarAlertaManipulacion` (línea aprox. 268): Bloque funcional del módulo.
 * - `refreshEstadoBotonSubir` (línea aprox. 297): Bloque funcional del módulo.
 * - `aplicarBloqueoConstancia` (línea aprox. 302): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { fetchResponsablesActivos, fetchUsuariosEmpresa } from "./responsables.js";
import { getEmpresaPolicy, puedeEnviarDatos } from "./permisos.core.js";
import { initApoyosPropinaManager } from "./apoyos.js";
import { descargarResumenCierreTurno } from "./cierre_turno_pdf.js?v=20260908pdf1";
import {
  WEBHOOK_LISTAR_RESPONSABLES,
  WEBHOOK_CONSULTAR_GASTOS_CATALOGO
} from "./webhooks.js";
import { resolverEsLocal, tablaSegunSede } from "./local_scope.js";

// ../js/cierre_turno.js

// Tabla de cierres segun la sede. La decision de cual usar NO se deduce aqui:
// la resuelve `app_es_local()` en la base a traves de js/local_scope.js.
const CIERRE_TABLES = { principal: "cierres_turno_final", local: "cierres_turno_final_locales" };

document.addEventListener("DOMContentLoaded", () => {
  const fecha = document.getElementById("fecha");
  const responsable = document.getElementById("responsable");
  const horaInicio = document.getElementById("hora_inicio");
  const horaFin = document.getElementById("hora_fin");
  const horaLlegadaHora = document.getElementById("hora_llegada_hora");
  const horaLlegadaMinuto = document.getElementById("hora_llegada_minuto");
  const horaLlegadaMomento = document.getElementById("hora_llegada_momento");
  const efectivoApertura = document.getElementById("efectivo_apertura");
  const efectivoAperturaEsperado = document.getElementById("efectivo_apertura_esperado");
  const efectivoAperturaDiferencia = document.getElementById("efectivo_apertura_diferencia");
  const efectivoAperturaOrigen = document.getElementById("efectivoAperturaOrigen");
  const efectivoAperturaNota = document.getElementById("efectivoAperturaNota");
  const jornadaSelect = document.getElementById("numeroTurno");
  const jornadaAviso = document.getElementById("jornadaAviso");
  const bolsa = document.getElementById("bolsa");
  const caja = document.getElementById("caja");
  const status = document.getElementById("status");
  const extrasList = document.getElementById("extrasList");
  const btnConsultar = document.getElementById("consultarDatos");
  const btnConsultarGastos = document.getElementById("consultarGastos");
  const btnVerificar = document.getElementById("verificar");
  const btnEnviar = document.getElementById("enviar");
  const btnLimpiar = document.getElementById("limpiarDatos");
  const confirmacionEnvio = document.getElementById("confirmacionEnvio");
  const mensajeEnvio = document.getElementById("mensajeEnvio");
  const btnConfirmarEnvio = document.getElementById("confirmarEnvio");
  const btnCancelarEnvio = document.getElementById("cancelarEnvio");
  const btnToggleEfectivoSistema = document.getElementById("toggleEfectivoSistema");
  const efectivoSistemaModo = document.getElementById("efectivoSistemaModo");
  const totalGastosExtrasEl = document.getElementById("totalGastosExtras");
  const totalIngresosSistemaEl = document.getElementById("totalIngresosSistema");
  const totalIngresosRealesEl = document.getElementById("totalIngresosReales");
  const totalGastosTurnoEl = document.getElementById("totalGastosTurno");
  const totalVentaDiaBrutaEl = document.getElementById("totalVentaDiaBruta");
  const totalVentaDiaNetaEl = document.getElementById("totalVentaDiaNeta");
  const totalDiferenciaGeneralEl = document.getElementById("totalDiferenciaGeneral");
  const apoyoHubo = document.getElementById("apoyo_hubo");
  const apoyoCantidad = document.getElementById("apoyo_cantidad");
  const apoyoCantidadWrap = document.getElementById("apoyoCantidadWrap");
  const apoyoTablaWrap = document.getElementById("apoyoTablaWrap");
  const apoyoRowsContainer = document.getElementById("apoyoRows");
  const btnConsultarPropinaApoyos = document.getElementById("consultarPropinaApoyos");
  const apoyosConsultaNota = document.getElementById("apoyosConsultaNota");
  const correccionWrap = document.getElementById("correccionWrap");
  const btnSolicitarCorreccion = document.getElementById("solicitarCorreccion");
  const modalCorreccion = document.getElementById("modalCorreccion");
  const btnAceptarCorreccion = document.getElementById("aceptarCorreccion");
  const mainContainer = document.querySelector(".main");

  const inputsFinanzas = {
    efectivo: {
      sistema: document.getElementById("efectivo_sistema"),
      real: document.getElementById("efectivo_real"),
    },
    datafono: {
      sistema: document.getElementById("datafono_sistema"),
      real: document.getElementById("datafono_real"),
    },
    rappi: {
      sistema: document.getElementById("rappi_sistema"),
      real: document.getElementById("rappi_real"),
    },
    nequi: {
      sistema: document.getElementById("nequi_sistema"),
      real: document.getElementById("nequi_real"),
    },
    transferencias: {
      sistema: document.getElementById("transferencias_sistema"),
      real: document.getElementById("transferencias_real"),
    },
    bono_regalo: {
      sistema: document.getElementById("bono_regalo_sistema"),
      real: document.getElementById("bono_regalo_real"),
    }
  };

  const inputsSoloVista = {
    propina: document.getElementById("propina"),
    domicilios: document.getElementById("domicilios"),
  };

  const inputsDiferencias = {
    efectivo: {
      input: document.getElementById("efectivo_diferencia"),
      nota: document.getElementById("efectivo_diferencia_nota")
    },
    datafono: {
      input: document.getElementById("datafono_diferencia"),
      nota: document.getElementById("datafono_diferencia_nota")
    },
    rappi: {
      input: document.getElementById("rappi_diferencia"),
      nota: document.getElementById("rappi_diferencia_nota")
    },
    nequi: {
      input: document.getElementById("nequi_diferencia"),
      nota: document.getElementById("nequi_diferencia_nota")
    },
    transferencias: {
      input: document.getElementById("transferencias_diferencia"),
      nota: document.getElementById("transferencias_diferencia_nota")
    },
    bono_regalo: {
      input: document.getElementById("bono_regalo_diferencia"),
      nota: document.getElementById("bono_regalo_diferencia_nota")
    }
  };

  const filasFinanzas = document.querySelectorAll(".finanzas-row");

  const EXTRAS_STORAGE_KEY = "cierre_turno_extras_visibilidad";
  const MAX_LOADING_MS = 5000;
  const BUTTON_LOADING_MS = 8000;
  const extrasRows = new Map();
  const getTimestamp = () => new Date().toISOString();
  let modoEfectivoSistema = "bruto";
  let efectivoSistemaLoggro = 0;
  let nombreEmpresaActual = "";
  let responsablesActivos = [];
  let resumenDescargado = false;
  let bloqueoConstanciaActivo = false;
  let verificado = false;
  let consultaCompletada = false;
  let empresaPolicy = {
    plan: "free",
    activa: true,
    solo_lectura: true
  };

  const toNumberValue = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/[^0-9,.-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") return 0;
    const sign = cleaned.startsWith("-") ? "-" : "";
    const unsigned = cleaned.replace(/-/g, "");
    const lastDot = unsigned.lastIndexOf(".");
    const lastComma = unsigned.lastIndexOf(",");
    let normalized = unsigned;
    if (lastDot >= 0 && lastComma >= 0) {
      const decimalSeparator = lastDot > lastComma ? "." : ",";
      const thousandsSeparator = decimalSeparator === "." ? "," : ".";
      normalized = unsigned.split(thousandsSeparator).join("");
      if (decimalSeparator === ",") normalized = normalized.replace(/,/g, ".");
    } else if (lastComma >= 0) {
      normalized = unsigned.replace(/\./g, "").replace(/,/g, ".");
    } else if (lastDot >= 0) {
      normalized = unsigned.replace(/,/g, "");
    }
    const parsed = Number(`${sign}${normalized}`);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatCOP = (value) => {
    const amount = Math.round(toNumberValue(value));
    const miles = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const sign = amount < 0 ? "-" : "";
    return `${sign}$${miles},00`;
  };

  const formatDurationLabel = (minutesValue) => {
    const minutes = Math.max(0, Number(minutesValue) || 0);
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours} horas ${remMinutes} minutos`;
  };

  // ── Jornada del turno ─────────────────────────────────────────────────
  // La identidad del turno es (empresa, fecha, numero_turno). La hora sigue
  // siendo libre justamente porque un turno de mañana puede cerrar a las 15:10.
  let numeroTurno = null;

  // Identificador de este intento de envío. Si el usuario hace doble clic o la
  // red obliga a reintentar, el backend reconoce el token y no duplica el
  // turno. Se renueva solo cuando un cierre entra de verdad.
  let tokenEnvio = (crypto?.randomUUID?.() || `envio-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const setJornadaAviso = (mensaje, esError = false) => {
    if (!jornadaAviso) return;
    jornadaAviso.textContent = mensaje || "";
    jornadaAviso.classList.toggle("is-hidden", !mensaje);
    jornadaAviso.classList.toggle("is-error", Boolean(esError));
  };

  // El aviso mostraba el uuid crudo de auth ("9cee41f8-dd65-4bb7-..."), que
  // para quien esta cerrando el turno no significa absolutamente nada. Se
  // traduce a nombre con la lista de responsables que la pagina ya tiene
  // cargada; si quien subio el turno no esta ahi (por ejemplo, alguien dado
  // de baja despues), se consulta una sola vez el padron completo de la
  // empresa y se guarda. Si aun asi no hay nombre, el aviso se queda SIN el
  // "por X": es preferible no decir quien lo subio a mostrar un codigo.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let padronUsuarios = null;

  const nombreDeUsuario = async (valor) => {
    const id = String(valor ?? "").trim();
    if (!id) return "";
    // Los cierres antiguos guardaban el nombre en texto plano, no el uuid.
    if (!UUID_RE.test(id)) return id;

    const activo = responsablesActivos.find((item) => String(item?.id) === id);
    if (activo?.nombre_completo) return activo.nombre_completo;

    if (padronUsuarios === null) {
      try {
        const contextPayload = await getContextPayload();
        const empresaId = contextPayload?.empresa_id || contextPayload?.tenant_id;
        padronUsuarios = empresaId ? await fetchUsuariosEmpresa(empresaId) : [];
      } catch (_error) {
        // Cachear el fallo como lista vacia evita reintentar en cada cambio
        // de fecha o de jornada; el aviso simplemente omite el nombre.
        padronUsuarios = [];
      }
    }

    const registrado = padronUsuarios.find((item) => String(item?.id) === id);
    return registrado?.nombre_completo || "";
  };

  // Avisa si ese turno ya fue subido, ANTES de que la persona rellene todo.
  const revisarTurnoExistente = async () => {
    if (!fecha?.value || !numeroTurno) {
      setJornadaAviso("");
      return;
    }

    try {
      const { data, error } = await supabase.rpc("turno_existente", {
        p_fecha: fecha.value,
        p_numero: numeroTurno
      });
      if (error || !data?.ok) return;

      if (!data.existe) {
        setJornadaAviso("");
        return;
      }

      const nombreQuienSubio = await nombreDeUsuario(data.registrado_por);
      const quien = nombreQuienSubio ? ` por ${nombreQuienSubio}` : "";
      const cuando = data.subido_en
        ? ` el ${new Date(data.subido_en).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}`
        : "";

      setJornadaAviso(
        data.puede_sobrescribir
          ? `Este turno ya fue subido${quien}${cuando}. Si continúas, reemplazarás esa versión.`
          : `Este turno ya fue subido${quien}${cuando}. Solo un administrador puede reemplazarlo.`,
        !data.puede_sobrescribir
      );
    } catch (_error) {
      // Un fallo aquí no debe impedir cerrar el turno: es solo un aviso previo.
    }
  };

  const seleccionarJornada = (valor) => {
    numeroTurno = Number(valor) || null;
    // La caja heredada depende de numero_turno tanto como de la fecha: pasar
    // de Turno 1 a Turno 2 despues de consultar dejaba en pantalla una cifra
    // que ya no correspondia a ese turno.
    limpiarEfectivoApertura();
    revisarTurnoExistente();
  };

  jornadaSelect?.addEventListener("change", () => seleccionarJornada(jornadaSelect.value));

  fecha?.addEventListener("change", () => {
    // La caja heredada depende de la fecha, así que deja de ser válida.
    limpiarEfectivoApertura();
    revisarTurnoExistente();
  });

  // ── Efectivo de apertura ──────────────────────────────────────────────
  // El esperado lo calcula el servidor. Aquí solo se muestra y se compara,
  // porque el dato que cuenta para el descuadre se vuelve a calcular al
  // guardar: si se fiara de esta pantalla, bastaría con editarla.
  function limpiarEfectivoApertura() {
    if (efectivoAperturaEsperado) efectivoAperturaEsperado.value = "";
    if (efectivoAperturaDiferencia) {
      efectivoAperturaDiferencia.value = "";
      efectivoAperturaDiferencia.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
    }
    if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "Se carga al consultar Loggro";
    if (efectivoAperturaNota) efectivoAperturaNota.textContent = "";
  }

  const actualizarDiferenciaApertura = () => {
    if (!efectivoAperturaDiferencia) return;
    const esperado = toNumberValue(efectivoAperturaEsperado?.value);
    const declarado = toNumberValue(efectivoApertura?.value);

    efectivoAperturaDiferencia.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");

    if (!efectivoAperturaEsperado?.value) {
      efectivoAperturaDiferencia.value = "";
      if (efectivoAperturaNota) efectivoAperturaNota.textContent = "";
      return;
    }

    const diferencia = declarado - esperado;
    efectivoAperturaDiferencia.value = String(diferencia);

    // Tolerancia cero: cualquier valor distinto de 0 es un descuadre. Se
    // señala con el mismo indicador que las filas de Datos Financieros, para
    // que la persona no tenga que aprender un codigo nuevo.
    if (diferencia < 0) {
      efectivoAperturaDiferencia.classList.add("diff-faltante");
      if (efectivoAperturaNota) efectivoAperturaNota.textContent = "Recibiste de menos. Esta observación no bloquea el cierre";
      return;
    }
    if (diferencia > 0) {
      efectivoAperturaDiferencia.classList.add("diff-sobrante");
      if (efectivoAperturaNota) efectivoAperturaNota.textContent = "Recibiste de más. Esta observación no bloquea el cierre";
      return;
    }
    efectivoAperturaDiferencia.classList.add("diff-ok");
    if (efectivoAperturaNota) efectivoAperturaNota.textContent = "Cuadra";
  };

  const resolverEmpresaEsLocal = async (empresaId) => resolverEsLocal(empresaId);

  // La constancia se firma contra la base, no contra el formulario.
  // El RPC devuelve la identidad del turno que guardó; aquí se vuelve a leer
  // esa fila antes de dibujar nada. Si no está, no se descarga PDF: un soporte
  // de un cierre que no entró es peor que no tener soporte.
  const confirmarCierreGuardado = async ({ empresaId, fechaTurno, numero, esLocal }) => {
    const tabla = tablaSegunSede(CIERRE_TABLES, esLocal);
    const { data, error } = await supabase
      .from(tabla)
      .select("id, empresa_id, fecha_turno, numero_turno, created_at")
      .eq("empresa_id", empresaId)
      .eq("fecha_turno", fechaTurno)
      .eq("numero_turno", numero)
      .limit(1);

    if (error) {
      console.error("[cierre_turno] no se pudo confirmar el cierre en la base", { tabla, error });
      throw new Error(`El cierre se envió, pero no se pudo confirmar en la base (${error.message}). No se descarga constancia.`);
    }

    const fila = Array.isArray(data) ? data[0] : null;
    if (!fila) {
      throw new Error(`El cierre no quedó registrado en ${tabla}. No se descarga constancia: vuelve a intentar el envío.`);
    }
    return fila;
  };

  // Carga la caja con la que cerró el turno anterior. Se llama desde el botón
  // "Consultar Loggro", nunca al abrir: la persona declara primero lo que
  // contó y solo después ve cuánto debería haber. Al revés, bastaría con
  // copiar la cifra y el control no medirá nada.
  const cargarEfectivoAperturaEsperado = async () => {
    if (!fecha?.value || !numeroTurno) return;

    const contextPayload = await getContextPayload();
    if (!contextPayload?.empresa_id) {
      if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "No se pudo identificar la sede";
      return;
    }

    // El RPC historico sustituia silenciosamente una sede no resuelta por la
    // empresa principal. Eso podia mostrar una caja real, pero de otro local.
    // Se consulta la tabla correcta y se conserva el UUID exacto como filtro.
    let esLocal = false;
    try {
      esLocal = await resolverEmpresaEsLocal(contextPayload.empresa_id);
    } catch (tipoError) {
      console.error("[cierre_turno] no se pudo resolver el tipo de sede", tipoError);
      if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "No se pudo cargar la caja anterior";
      return;
    }

    const tablaCierres = tablaSegunSede(CIERRE_TABLES, esLocal);
    // Una caja de semanas atrás no debe presentarse como si fuera la recibida
    // ayer. Para el primer turno sólo se admite el último cierre del día
    // inmediatamente anterior; para turnos posteriores se prioriza un turno
    // previo del mismo día y, si no existe, el día anterior.
    const fechaSeleccionada = new Date(`${fecha.value}T12:00:00`);
    fechaSeleccionada.setDate(fechaSeleccionada.getDate() - 1);
    const fechaAnterior = [
      fechaSeleccionada.getFullYear(),
      String(fechaSeleccionada.getMonth() + 1).padStart(2, "0"),
      String(fechaSeleccionada.getDate()).padStart(2, "0")
    ].join("-");
    const filtros = [`fecha_turno.eq.${fechaAnterior}`];
    if (numeroTurno > 1) {
      filtros.push(`and(fecha_turno.eq.${fecha.value},numero_turno.lt.${numeroTurno})`);
    }
    const filtroAnterior = filtros.join(",");
    const { data: filas, error } = await supabase
      .from(tablaCierres)
      .select("empresa_id, fecha_turno, numero_turno, caja_global, created_at")
      .eq("empresa_id", contextPayload.empresa_id)
      .or(filtroAnterior)
      .order("fecha_turno", { ascending: false })
      .order("numero_turno", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[cierre_turno] consulta directa de caja anterior fallo", {
        empresa_id: contextPayload.empresa_id,
        tabla: tablaCierres,
        error
      });
      if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "No se pudo cargar la caja anterior";
      return;
    }

    const cierreAnterior = Array.isArray(filas) ? filas[0] : null;
    if (!cierreAnterior) {
      if (efectivoAperturaEsperado) efectivoAperturaEsperado.value = "";
      if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "Sin cierre del día anterior registrado para esta sede";
      actualizarDiferenciaApertura();
      return;
    }

    if (String(cierreAnterior.empresa_id) !== String(contextPayload.empresa_id)) {
      console.error("[cierre_turno] se rechazo una caja perteneciente a otra sede", cierreAnterior);
      if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "Caja anterior rechazada por sede incorrecta";
      return;
    }

    if (efectivoAperturaEsperado) efectivoAperturaEsperado.value = String(cierreAnterior.caja_global ?? 0);
    if (efectivoAperturaOrigen) {
      const [year, month, day] = String(cierreAnterior.fecha_turno || "").split("-");
      efectivoAperturaOrigen.textContent = `Caja del ${day}/${month}/${year} turno ${cierreAnterior.numero_turno}`;
    }
    actualizarDiferenciaApertura();
  };

  const syncEfectivoRealFromCajaBolsa = () => {
    const total = toNumberValue(bolsa?.value) + toNumberValue(caja?.value);
    inputsFinanzas.efectivo.real.value = String(total);
  };

  const getTotalGastosExtras = () => Array.from(extrasRows.values())
    .filter((row) => row.visible)
    .reduce((sum, row) => sum + asNumber(row.value), 0);

  const getEfectivoSistemaBruto = () => (
    toNumberValue(efectivoApertura?.value) + toNumberValue(efectivoSistemaLoggro)
  );

  const getEfectivoSistemaNeto = () => getEfectivoSistemaBruto() - getTotalGastosExtras();

  const getTotalIngresosSistema = () => (
    toNumberValue(inputsFinanzas.efectivo.sistema?.value)
    + toNumberValue(inputsFinanzas.datafono.sistema?.value)
    + toNumberValue(inputsFinanzas.rappi.sistema?.value)
    + toNumberValue(inputsFinanzas.nequi.sistema?.value)
    + toNumberValue(inputsFinanzas.transferencias.sistema?.value)
    + toNumberValue(inputsFinanzas.bono_regalo.sistema?.value)
  );

  const getTotalIngresosReales = () => (
    toNumberValue(inputsFinanzas.efectivo.real?.value)
    + toNumberValue(inputsFinanzas.datafono.real?.value)
    + toNumberValue(inputsFinanzas.rappi.real?.value)
    + toNumberValue(inputsFinanzas.nequi.real?.value)
    + toNumberValue(inputsFinanzas.transferencias.real?.value)
    + toNumberValue(inputsFinanzas.bono_regalo.real?.value)
  );

  const renderTotalizados = () => {
    const totalSistema = getTotalIngresosSistema();
    const totalReal = getTotalIngresosReales();
    const totalGastos = getTotalGastosExtras();
    const ventaBruta = totalReal;
    const ventaNeta = totalReal - totalGastos;
    const diferenciaGeneral = totalReal - totalSistema;

    if (totalIngresosSistemaEl) totalIngresosSistemaEl.textContent = formatCOP(totalSistema);
    if (totalIngresosRealesEl) totalIngresosRealesEl.textContent = formatCOP(totalReal);
    if (totalGastosTurnoEl) totalGastosTurnoEl.textContent = formatCOP(totalGastos);
    if (totalVentaDiaBrutaEl) totalVentaDiaBrutaEl.textContent = formatCOP(ventaBruta);
    if (totalVentaDiaNetaEl) totalVentaDiaNetaEl.textContent = formatCOP(ventaNeta);
    if (totalDiferenciaGeneralEl) totalDiferenciaGeneralEl.textContent = formatCOP(diferenciaGeneral);
  };

  const syncEfectivoSistemaDisplay = () => {
    const bruto = getEfectivoSistemaBruto();
    const neto = getEfectivoSistemaNeto();
    const valor = modoEfectivoSistema === "neto" ? neto : bruto;
    inputsFinanzas.efectivo.sistema.value = String(valor);
    if (efectivoSistemaModo) {
      efectivoSistemaModo.textContent = modoEfectivoSistema === "neto"
        ? "efectivo despues de gastos"
        : "efectivo bruto";
    }
    renderTotalizados();
  };

  const syncTotalesExtras = () => {
    if (totalGastosExtrasEl) {
      totalGastosExtrasEl.textContent = String(getTotalGastosExtras());
    }
    syncEfectivoSistemaDisplay();
    renderTotalizados();
  };

  enforceNumericInput([
    inputsFinanzas.efectivo.sistema,
    inputsFinanzas.efectivo.real,
    inputsFinanzas.datafono.sistema,
    inputsFinanzas.datafono.real,
    inputsFinanzas.rappi.sistema,
    inputsFinanzas.rappi.real,
    inputsFinanzas.nequi.sistema,
    inputsFinanzas.nequi.real,
    inputsFinanzas.transferencias.sistema,
    inputsFinanzas.transferencias.real,
    inputsFinanzas.bono_regalo.sistema,
    inputsFinanzas.bono_regalo.real,
    efectivoApertura,
    inputsSoloVista.propina,
    inputsSoloVista.domicilios,
    bolsa,
    caja,
  ]);

  const comentarios = document.querySelector("textarea");

  const setStatus = (message) => {
    status.textContent = message;
  };

  const readResponseBody = async (res) => {
    const raw = await res.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return { message: raw };
    }
  };

  const enviarAlertaManipulacion = (motivo) => {
    const payload = {
      modulo: "cierre_turno",
      motivo,
      responsable_id: responsable?.value || "",
      responsable_nombre: responsable?.selectedOptions?.[0]?.textContent || "",
      empresa_nombre: nombreEmpresaActual || "",
      fecha_turno: fecha?.value || "",
      timestamp: getTimestamp()
    };

    try {
      supabase.functions.invoke("alerta-manipulacion", {
        body: payload
      }).catch(err => console.error("Error enviando alerta:", err));
    } catch (_error) {
      // no-op
    }
  };

  const refreshEstadoBotonSubir = () => {
    // Una vez consultados los datos, el usuario puede enviar aunque exista una
    // diferencia. Si omitió el botón Verificar, el clic de envío calcula y
    // registra el cuadre antes de mostrar la confirmación.
    btnEnviar.disabled = !consultaCompletada;
  };

  const aplicarBloqueoConstancia = (activo) => {
    bloqueoConstanciaActivo = activo;

    const controlesBloqueables = [
      btnConsultar,
      btnConsultarGastos,
      btnVerificar,
      btnLimpiar,
      btnToggleEfectivoSistema,
      fecha,
      responsable,
      horaInicio,
      horaFin,
      horaLlegadaHora,
      horaLlegadaMinuto,
      horaLlegadaMomento,
      efectivoApertura,
      bolsa,
      caja,
      comentarios,
      ...Object.values(inputsFinanzas).flatMap((grupo) => [grupo.sistema, grupo.real]),
      ...Object.values(inputsDiferencias).map(({ input }) => input),
      ...Object.values(inputsSoloVista)
    ].filter(Boolean);

    controlesBloqueables.forEach((control) => {
      control.disabled = activo;
    });

    extrasRows.forEach((row) => {
      if (row.input) row.input.disabled = activo;
    });

    correccionWrap?.classList.toggle("is-hidden", !activo);
    if (mainContainer) {
      mainContainer.classList.toggle("snapshot-locked", activo);
    }

    refreshEstadoBotonSubir();
  };

  const aplicarPoliticaSoloLectura = () => {
    const isReadOnly = empresaPolicy?.solo_lectura === true;
    const blockedByBilling = empresaPolicy?.motivo_solo_lectura === "facturacion_suspendida";
    const title = blockedByBilling
      ? "Servicio suspendido por falta de pago: solo consulta y facturación"
      : (isReadOnly ? "Plan FREE: solo visualizacion" : "");
    if (btnEnviar) {
      btnEnviar.disabled = isReadOnly;
      btnEnviar.title = title;
    }
    if (btnConfirmarEnvio) {
      btnConfirmarEnvio.disabled = isReadOnly;
      btnConfirmarEnvio.title = blockedByBilling
        ? "Servicio suspendido por falta de pago"
        : (isReadOnly ? "Plan FREE: envio bloqueado" : "");
    }
    if (isReadOnly) {
      setStatus(blockedByBilling
        ? "Servicio suspendido por falta de pago: puedes consultar la plataforma, pero no subir cierres hasta pagar en facturación."
        : "Plan FREE activo: puedes consultar y visualizar, pero no enviar cierres.");
    }
  };

  const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const firstPresentValue = (source, keys, fallback = 0) => {
    if (!source || typeof source !== "object") return fallback;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
    }
    return fallback;
  };

  const resolveTransferenciasSistema = (data) => firstPresentValue(data, [
    "transferencias_sistema",
    "transferencias_total",
    "transferencia_sistema",
    "transferencia_total",
    "transferencias_bancolombia_total",
    "transferencias_bancolombia_valor",
    "bancolombia_total",
    "bancolombia_valor"
  ], 0);

  const normalizeExtras = (raw) => {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      if (!raw.length) return [];
      const nested = raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        if (Array.isArray(item.Gastos)) return item.Gastos;
        if (Array.isArray(item.gastos)) return item.gastos;
        if (Array.isArray(item.extras)) return item.extras;
        if (Array.isArray(item.items)) return item.items;
        if (Array.isArray(item.data)) return item.data;
        return [item];
      });
      return nested.filter((item) => item && typeof item === "object");
    }

    if (typeof raw !== "object") return [];

    const keys = ["Gastos", "gastos", "extras", "items", "data"];
    for (const key of keys) {
      if (Array.isArray(raw[key])) return raw[key];
    }

    return Object.entries(raw)
      .filter(([key]) => key !== "ok" && key !== "message")
      .map(([id, value]) => ({ id, ...(typeof value === "object" ? value : { value }) }));
  };

  const getExtrasVisibilitySettings = () => {
    const stored = localStorage.getItem(EXTRAS_STORAGE_KEY);
    if (!stored) return {};
    try {
      return JSON.parse(stored);
    } catch (error) {
      return {};
    }
  };

  const buildExtrasRows = (extras) => {
    if (!extrasList) return;
    extrasList.innerHTML = "";
    extrasRows.clear();

    const visibility = getExtrasVisibilitySettings();

    extras.forEach((item) => {
      const id = String(item.id ?? item.Id ?? item.ID ?? item.codigo ?? item.key ?? "");
      if (!id) return;

      const nombre = item.nombre ?? item.name ?? item.descripcion ?? id;
      const visible = visibility[id] !== false;

      let input = null;
      if (visible) {
        const row = document.createElement("div");
        row.className = "extra-row";

        const label = document.createElement("span");
        label.textContent = nombre;

        input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.value = "0";

        row.append(label, input);
        extrasList.appendChild(row);
      }

      extrasRows.set(id, { nombre, input, visible, value: 0 });
    });
  };

  const buildExtrasPayload = () => (
    Array.from(extrasRows.entries()).map(([id, row]) => ({
      Id: id,
      name: row.nombre,
      valor: row.visible ? Number(row.value || 0) : 0,
      visible: row.visible
    }))
  );

  const asNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const actualizarDomiciliosDesdeExtras = () => {
    const totalDomicilios = Array.from(extrasRows.values())
      .filter((row) => /domicilios?/i.test(String(row.nombre || "")))
      .reduce((sum, row) => sum + asNumber(row.value), 0);

    inputsSoloVista.domicilios.value = String(totalDomicilios);
    syncTotalesExtras();
  };

  const limpiarDiferencias = () => {
    Object.values(inputsDiferencias).forEach(({ input, nota }) => {
      input.value = "";
      input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
      nota.textContent = "";
    });
  };

  const getContextPayload = async () => {
    const context = await getUserContext();
    if (!context) {
      setStatus("No se pudo validar la sesión.");
      return null;
    }

    return {
      empresa_id: context.empresa_id,
      tenant_id: context.empresa_id,
      empresa_principal_id: context.empresa_principal_id || context.empresa_id,
      local_context: context.local_context === true,
      usuario_id: context.user?.id || context.user?.user_id,
      rol: context.rol,
      registrado_por: context.user?.id || context.user?.user_id,
      timestamp: getTimestamp()
    };
  };



  const cargarNombreEmpresa = async () => {
    try {
      const context = await getUserContext();
      const empresaId = context?.empresa_id;
      if (!empresaId) return;

      const { data, error } = await supabase
        .from("empresas")
        .select("nombre_comercial")
        .eq("id", empresaId)
        .maybeSingle();

      if (error) return;
      nombreEmpresaActual = String(data?.nombre_comercial || "").trim();
    } catch (_error) {
      nombreEmpresaActual = "";
    }
  };

  const cargarPoliticaEmpresa = async (forceRefresh = false) => {
    const context = await getUserContext();
    if (!context?.empresa_id) return;
    empresaPolicy = await getEmpresaPolicy(context.empresa_id, forceRefresh).catch((error) => { setStatus("Error del sistema validando el plan. Recarga la pagina."); console.error("Error cargando politica de plan:", error); return { ...empresaPolicy, plan: "free", solo_lectura: true }; });
    aplicarPoliticaSoloLectura();
  };

  const cargarResponsables = async () => {
    try {
      const contextPayload = await getContextPayload();
      if (!contextPayload) return;

      const empresaId = contextPayload.empresa_id || contextPayload.tenant_id;
      const responsables = await fetchResponsablesActivos(empresaId);
      responsablesActivos = Array.isArray(responsables) ? responsables : [];




      responsable.innerHTML = "<option value=\"\">Seleccione responsable</option>";
      responsablesActivos.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id ?? "";
        option.textContent = item.nombre_completo ?? item.id ?? option.value;
        responsable.appendChild(option);
      });

      Array.from(apoyoRowsContainer?.querySelectorAll('[data-field="responsable"]') || []).forEach((select) => {
        const selectedValue = select.value;
        select.innerHTML = getResponsableOptionsHtml(selectedValue);
      });
    } catch (error) {
      setStatus("No se pudieron cargar los responsables.");
    }
  };

  const cargarExtrasCatalogo = async () => {
    if (!extrasList) return;

    try {
      const contextPayload = await getContextPayload();
      if (!contextPayload) return;

      const res = await fetchWithTimeout(WEBHOOK_CONSULTAR_GASTOS_CATALOGO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextPayload)
      });

      const data = await readResponseBody(res);
      if (!res.ok) {
        setStatus(data?.message || `Error al consultar gastos (HTTP ${res.status}).`);
        return;
      }
      const extras = normalizeExtras(data);

      if (extras.length) {
        buildExtrasRows(extras);
      }
    } catch (error) {
      // silencioso: los extras se cargan también al consultar gastos
    }
  };

  const formatFechaCompleta = (fechaValue) => {
    if (!fechaValue) return "";
    return `${fechaValue.replace(/-/g, "/")}T00:00:00`;
  };

  const getMomentoDia = (timeValue) => {
    if (!timeValue) return "";
    const [hour] = timeValue.split(":").map(Number);
    if (Number.isNaN(hour)) return "";
    return hour >= 12 ? "PM" : "AM";
  };


  const populateHoraLlegadaOptions = () => {
    if (horaLlegadaHora && !horaLlegadaHora.options.length) {
      horaLlegadaHora.innerHTML = '<option value="">Hora</option>';
      for (let hour = 1; hour <= 12; hour += 1) {
        const option = document.createElement("option");
        option.value = String(hour).padStart(2, "0");
        option.textContent = String(hour).padStart(2, "0");
        horaLlegadaHora.appendChild(option);
      }
    }

    if (horaLlegadaMinuto && !horaLlegadaMinuto.options.length) {
      horaLlegadaMinuto.innerHTML = '<option value="">Min</option>';
      for (let minute = 0; minute <= 59; minute += 1) {
        const option = document.createElement("option");
        option.value = String(minute).padStart(2, "0");
        option.textContent = String(minute).padStart(2, "0");
        horaLlegadaMinuto.appendChild(option);
      }
    }

    if (horaLlegadaMomento && !horaLlegadaMomento.value) {
      horaLlegadaMomento.value = "AM";
    }
  };

  const getHoraLlegadaCompleta = () => {
    const hour = horaLlegadaHora?.value || "";
    const minute = horaLlegadaMinuto?.value || "";
    const momento = horaLlegadaMomento?.value || "";
    if (!hour || !minute || !momento) return "";
    return `${hour}:${minute} ${momento}`;
  };

  const buildHourOptions = () => {
    let html = '<option value="">Hora</option>';
    for (let hour = 1; hour <= 12; hour += 1) {
      const value = String(hour).padStart(2, "0");
      html += `<option value="${value}">${value}</option>`;
    }
    return html;
  };

  const buildMinuteOptions = () => {
    let html = '<option value="">Min</option>';
    for (let minute = 0; minute <= 55; minute += 5) {
      const value = String(minute).padStart(2, "0");
      html += `<option value="${value}">${value}</option>`;
    }
    return html;
  };

  const toMinutesFromRangeParts = (hour12, minute, ampm) => {
    const h = Number(hour12);
    const m = Number(minute);
    if (!h || Number.isNaN(m) || !ampm) return null;
    let hour24 = h % 12;
    if (String(ampm).toUpperCase() === "PM") hour24 += 12;
    return (hour24 * 60) + m;
  };

  const readApoyoRange = (row) => {
    const fechaRango = new Date().toISOString().slice(0, 10);
    const inicioHora = row.querySelector('[data-field="inicio_hora"]')?.value || "";
    const inicioMin = row.querySelector('[data-field="inicio_min"]')?.value || "";
    const inicioMom = row.querySelector('[data-field="inicio_momento"]')?.value || "";
    const finHora = row.querySelector('[data-field="fin_hora"]')?.value || "";
    const finMin = row.querySelector('[data-field="fin_min"]')?.value || "";
    const finMom = row.querySelector('[data-field="fin_momento"]')?.value || "";

    const inicioMinutes = toMinutesFromRangeParts(inicioHora, inicioMin, inicioMom);
    const finMinutes = toMinutesFromRangeParts(finHora, finMin, finMom);
    if (inicioMinutes === null || finMinutes === null) {
      return { complete: false, fechaRango, inicioHora, inicioMin, inicioMom, finHora, finMin, finMom };
    }

    let duration = finMinutes - inicioMinutes;
    if (duration < 0) duration += 24 * 60;
    
    // Función para convertir a 24 horas (formato HH:mm militar) como lo hacía N8N
    const to24h = (h12, ampm) => {
      let h = Number(h12);
      if (String(ampm).toUpperCase() === "PM" && h !== 12) h += 12;
      if (String(ampm).toUpperCase() === "AM" && h === 12) h = 0;
      return String(h).padStart(2, "0");
    };

    const inicioHoraSimple = `${inicioHora}:${inicioMin}`;
    const finHoraSimple = `${finHora}:${finMin}`;
    const inicioTexto = `${inicioHoraSimple} ${inicioMom}`;
    const finTexto = `${finHoraSimple} ${finMom}`;
    const inicioHora24 = `${to24h(inicioHora, inicioMom)}:${inicioMin}`;
    const finHora24 = `${to24h(finHora, finMom)}:${finMin}`;
    
    return {
      complete: true,
      fechaRango,
      inicioHora,
      inicioMin,
      inicioMom,
      finHora,
      finMin,
      finMom,
      inicioHoraSimple,
      finHoraSimple,
      inicioHora24,
      finHora24,
      fechaHoraInicio: `${fechaRango} ${inicioHoraSimple}`,
      inicioTexto,
      finTexto,
      rangoTexto: `${inicioTexto} - ${finTexto}`,
      durationMinutes: duration,
      durationText: formatDurationLabel(duration)
    };
  };

  const getResponsableOptionsHtml = (selectedValue = "") => {
    const base = '<option value="">Selecciona responsable</option>';
    const options = responsablesActivos.map((item) => {
      const id = String(item?.id || "");
      const name = String(item?.nombre_completo || item?.id || id);
      const selected = id && id === String(selectedValue) ? "selected" : "";
      return `<option value="${id}" ${selected}>${name}</option>`;
    });
    return [base, ...options].join("");
  };

  const normalizeApoyoPropinaInput = (input) => {
    if (!input) return;
    input.value = String(input.value || "").replace(/[^\d]/g, "");
  };

  const createApoyoRow = (index) => {
    const row = document.createElement("div");
    row.className = "apoyo-row";
    row.dataset.index = String(index);
    row.innerHTML = `
      <select data-field="responsable">${getResponsableOptionsHtml()}</select>
      <input data-field="propina" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Automático" readonly>
      <div class="apoyo-rango-wrap">
        <div class="apoyo-rango-grid">
          <div class="apoyo-rango-box">
            <small>Inicio</small>
            <div class="apoyo-rango-selects">
              <select data-field="inicio_hora">${buildHourOptions()}</select>
              <select data-field="inicio_min">${buildMinuteOptions()}</select>
              <select data-field="inicio_momento"><option value="AM">AM</option><option value="PM">PM</option></select>
            </div>
          </div>
          <div class="apoyo-rango-box">
            <small>Fin</small>
            <div class="apoyo-rango-selects">
              <select data-field="fin_hora">${buildHourOptions()}</select>
              <select data-field="fin_min">${buildMinuteOptions()}</select>
              <select data-field="fin_momento"><option value="AM">AM</option><option value="PM">PM</option></select>
            </div>
          </div>
        </div>
      </div>
    `;

    row.querySelector('[data-field="responsable"]')?.addEventListener("change", marcarComoNoVerificado);
    row.querySelectorAll('select, input[type="date"]').forEach((el) => {
      el.addEventListener("change", marcarComoNoVerificado);
    });
    return row;
  };

  const renderApoyoRows = (count) => {
    if (!apoyoRowsContainer) return;
    apoyoRowsContainer.innerHTML = "";
    const safeCount = Math.max(0, Math.min(30, Number(count) || 0));
    for (let i = 0; i < safeCount; i += 1) {
      apoyoRowsContainer.appendChild(createApoyoRow(i + 1));
    }
    apoyoTablaWrap?.classList.toggle("is-hidden", safeCount === 0);
  };

  const buildApoyoPayload = (contextPayload) => {
    const huboApoyos = apoyoHubo?.value === "si";
    const cantidad = Number(apoyoCantidad?.value || 0);
    const rows = Array.from(apoyoRowsContainer?.querySelectorAll(".apoyo-row") || []);
    const registros = rows.map((row) => {
      const apoyoResponsableId = row.querySelector('[data-field="responsable"]')?.value || "";
      const propinaValue = row.querySelector('[data-field="propina"]')?.value || "0";
      const range = readApoyoRange(row);
      const tiempoMinutos = range.complete ? Number(range.durationMinutes || 0) : 0;
      return {
        empresa_id: contextPayload?.empresa_id || "",
        fecha: fecha.value || "",
        hora_inicio: horaInicio.value || "",
        hora_fin: horaFin.value || "",
        responsable_turno_id: responsable.value || "",
        apoyo_responsable_id: apoyoResponsableId,
        propina: Number(propinaValue || 0),
        tiempo_minutos: tiempoMinutos,
        tiempo_texto: range.complete ? range.durationText : "0 horas 0 minutos",
        rango_hora_inicio: range.complete ? range.inicioTexto : "",
        rango_hora_fin: range.complete ? range.finTexto : "",
        rango_hora_unificado: range.complete ? range.rangoTexto : "",
        rango_hora_inicio_simple: range.complete ? range.inicioHoraSimple : "",
        rango_hora_fin_simple: range.complete ? range.finHoraSimple : "",
        rango_hora_inicio_24: range.complete ? range.inicioHora24 : "",
        rango_hora_fin_24: range.complete ? range.finHora24 : "",
        rango_fecha_hora_inicio: range.complete ? range.fechaHoraInicio : "",
        fecha_rango: range.fechaRango || ""
      };
    });

    return {
      etiqueta: "apoyo",
      empresa_id: contextPayload?.empresa_id || "",
      fecha: fecha.value || "",
      hora_inicio: horaInicio.value || "",
      hora_fin: horaFin.value || "",
      responsable_turno_id: responsable.value || "",
      hubo_apoyos: huboApoyos,
      cantidad_personas: huboApoyos ? cantidad : 0,
      registros: huboApoyos ? registros : []
    };
  };

  const validateApoyoRows = () => {
    if (apoyoHubo?.value !== "si") return true;
    const cantidad = Number(apoyoCantidad?.value || 0);
    if (!cantidad || cantidad < 1) {
      setStatus("Indica cuántas personas participaron como apoyo.");
      return false;
    }

    const rows = Array.from(apoyoRowsContainer?.querySelectorAll(".apoyo-row") || []);
    if (rows.length !== cantidad) {
      setStatus("La cantidad de filas de apoyos no coincide con el número de personas.");
      return false;
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const responsableApoyo = row.querySelector('[data-field="responsable"]')?.value || "";
      const range = readApoyoRange(row);
      if (!responsableApoyo || !range.complete) {
        setStatus(`Completa todos los campos del apoyo #${i + 1}.`);
        return false;
      }
    }
    return true;
  };



  const apoyosPropinaManager = initApoyosPropinaManager({
    apoyoHubo,
    apoyoCantidad,
    apoyoRowsContainer,
    propinaInput: inputsSoloVista.propina,
    btnConsultarPropina: btnConsultarPropinaApoyos,
    noteEl: apoyosConsultaNota,
    setStatus,
    getContextPayload,
    buildApoyoPayload,
    validateApoyoRows,
    marcarComoNoVerificado: () => marcarComoNoVerificado()
  });
  const apoyoConfirmado = () => Boolean(apoyosPropinaManager?.isConsultaConfirmada?.());
  const syncApoyosConsultaVisibility = () => {
    const enabled = apoyoHubo?.value === "si";
    const cantidad = Number(apoyoCantidad?.value || 0);
    const show = enabled && cantidad > 0;
    const box = document.getElementById("apoyosConsultaBox");
    box?.classList.toggle("is-hidden", !show);
  };


  const exigirConfirmacionApoyo = () => {
    if (apoyoHubo?.value !== "si") return true;
    if (apoyoConfirmado()) return true;
    setStatus("Debes usar el botón Confirmar apoyo antes de subir el cierre cuando hubo apoyos.");
    return false;
  };

  const toggleButtons = ({ consultar, verificar, enviar }) => {
    if (typeof consultar === "boolean") btnConsultar.disabled = !consultar;
    if (typeof verificar === "boolean") btnVerificar.disabled = !verificar;
    if (typeof enviar === "boolean") btnEnviar.disabled = !enviar;
  };

  const buildTurnoPayload = async () => {
    const contextPayload = await getContextPayload();
    if (!contextPayload) return null;

    return {
      fecha: fecha.value,
      numero_turno: numeroTurno,
      responsable: responsable.value,
      turno: {
        hora_llegada: getHoraLlegadaCompleta(),
        inicio: horaInicio.value,
        fin: horaFin.value,
        inicio_momento: getMomentoDia(horaInicio.value),
        fin_momento: getMomentoDia(horaFin.value)
      },
      ...contextPayload
    };
  };

  const getMissingRequiredLabels = () => {
    const requiredFields = [
      { label: "Fecha", value: fecha?.value },
      { label: "Responsable del turno", value: responsable?.value },
      { label: "Hora de llegada", value: getHoraLlegadaCompleta() },
      { label: "Hora inicio", value: horaInicio?.value },
      { label: "Hora fin", value: horaFin?.value },
      { label: "Efectivo apertura", value: efectivoApertura?.value },
      { label: "Bolsa", value: bolsa?.value },
      { label: "Caja", value: caja?.value },
      { label: "¿Hubo apoyos durante el turno?", value: apoyoHubo?.value }
    ];
    return requiredFields
      .filter((item) => String(item.value ?? "").trim() === "")
      .map((item) => item.label);
  };

  const validateCamposObligatoriosCompletos = () => {
    const missing = getMissingRequiredLabels();
    if (missing.length) {
      setStatus(`Completa estos campos obligatorios antes de continuar: ${missing.join(", ")}.`);
      return false;
    }
    return true;
  };

  const confirmarCerosCriticos = () => {
    const bolsaNum = Number(bolsa?.value || 0);
    const cajaNum = Number(caja?.value || 0);
    if (bolsaNum === 0 || cajaNum === 0) {
      return window.confirm("Advertencia: estás dejando Bolsa o Caja en 0. ¿Confirmas que ese valor es correcto?");
    }
    return true;
  };

  const getVisibilitySettings = () => {
    const stored = localStorage.getItem("cierre_turno_visibilidad");
    if (!stored) {
      return {
        efectivo: true,
        datafono: true,
        rappi: true,
        nequi: true,
        transferencias: true,
        bono_regalo: true,
        propina: true,
        domicilios: true,
      };
    }
    try {
      return JSON.parse(stored);
    } catch (error) {
      return {
        efectivo: true,
        datafono: true,
        rappi: true,
        nequi: true,
        transferencias: true,
        bono_regalo: true,
        propina: true,
        domicilios: true,
      };
    }
  };

  function actualizarEstadoDiferencia(field, rawValue) {
    const value = Number(rawValue);
    const { input, nota } = inputsDiferencias[field];
    input.classList.remove("diff-faltante", "diff-sobrante", "diff-ok");
    if (Number.isNaN(value)) {
      nota.textContent = "";
      return;
    }
    if (value < 0) {
      input.classList.add("diff-faltante");
      nota.textContent = "Aquí hay un faltante!";
      return;
    }
    if (value > 0) {
      input.classList.add("diff-sobrante");
      nota.textContent = "Aquí hay un sobrante";
      return;
    }
    input.classList.add("diff-ok");
    nota.textContent = "Muy bien, todo en orden";
  }

  const calcularDiferenciaEfectivoLocal = () => {
    const efectivoSistemaNeto = getEfectivoSistemaNeto();
    const efectivoReal = toNumberValue(inputsFinanzas.efectivo.real.value);
    return efectivoReal - efectivoSistemaNeto;
  };

  const syncDiferenciaEfectivo = () => {
    const diferencia = calcularDiferenciaEfectivoLocal();
    if (!inputsDiferencias.efectivo) return diferencia;
    inputsDiferencias.efectivo.input.value = String(diferencia);
    actualizarEstadoDiferencia("efectivo", diferencia);
    return diferencia;
  };

  const applyVisibilitySettings = () => {
    const settings = getVisibilitySettings();
    filasFinanzas.forEach((row) => {
      const field = row.dataset.field;
      const visible = settings[field] !== false;
      row.classList.toggle("is-hidden", !visible);
      if (!visible) {
        if (inputsFinanzas[field]) {
          inputsFinanzas[field].sistema.value = "0";
          inputsFinanzas[field].real.value = "0";
        }
        if (inputsSoloVista[field]) {
          inputsSoloVista[field].value = "0";
        }
        if (inputsDiferencias[field]) {
          inputsDiferencias[field].input.value = "0";
          actualizarEstadoDiferencia(field, 0);
        }
      }
    });
    renderTotalizados();
    return settings;
  };

  const fechaEsPasada = (fechaValue) => {
    if (!fechaValue) return false;
    const [year, month, day] = fechaValue.split("-").map(Number);
    if (!year || !month || !day) return false;
    const fechaSeleccionada = new Date(year, month - 1, day);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return fechaSeleccionada < hoy;
  };

  const actualizarEstadoHoraFin = () => {
    horaFin.disabled = false;
  };


  const marcarComoNoVerificado = () => {
    limpiarDiferencias();
    resumenDescargado = false;
    if (!verificado) {
      refreshEstadoBotonSubir();
      return;
    }
    verificado = false;
    toggleButtons({ enviar: false });
    confirmacionEnvio.classList.add("is-hidden");
    refreshEstadoBotonSubir();
  };

  const limpiarCamposDatos = () => {
    Object.values(inputsFinanzas).forEach((grupo) => {
      grupo.sistema.value = "";
      grupo.real.value = "";
    });
    inputsSoloVista.propina.value = "";
    inputsSoloVista.domicilios.value = "";
    if (efectivoApertura) {
      efectivoApertura.value = "";
    }
    limpiarEfectivoApertura();
    if (bolsa) {
      bolsa.value = "";
    }
    if (caja) {
      caja.value = "";
    }
    efectivoSistemaLoggro = 0;
    modoEfectivoSistema = "bruto";
    syncEfectivoRealFromCajaBolsa();
    syncEfectivoSistemaDisplay();
    syncDiferenciaEfectivo();
    extrasRows.forEach((row) => {
      row.value = 0;
      if (row.input) {
        row.input.value = "0";
      }
    });
    limpiarDiferencias();
    comentarios.value = "";
    if (horaLlegadaHora) horaLlegadaHora.value = "";
    if (horaLlegadaMinuto) horaLlegadaMinuto.value = "";
    if (horaLlegadaMomento) horaLlegadaMomento.value = "AM";
    if (apoyoHubo) apoyoHubo.value = "";
    if (apoyoCantidad) apoyoCantidad.value = "";
    apoyoCantidadWrap?.classList.add("is-hidden");
    apoyoTablaWrap?.classList.add("is-hidden");
    if (apoyoRowsContainer) apoyoRowsContainer.innerHTML = "";
    apoyosPropinaManager?.reset?.();
    marcarComoNoVerificado();
    applyVisibilitySettings();
  };

  const settingsVisibilidad = applyVisibilitySettings();

  toggleButtons({ consultar: true, verificar: false, enviar: false });
  btnEnviar.disabled = true;

  syncEfectivoRealFromCajaBolsa();
  syncEfectivoSistemaDisplay();
  syncTotalesExtras();
  renderTotalizados();
  actualizarEstadoHoraFin();
  populateHoraLlegadaOptions();
  if (apoyoCantidad && apoyoCantidad.options.length <= 1) {
    apoyoCantidad.innerHTML = '<option value="">Selecciona</option>';
    for (let n = 1; n <= 30; n += 1) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = String(n);
      apoyoCantidad.appendChild(opt);
    }
  }
  apoyoHubo?.addEventListener("change", () => {
    if (apoyoHubo.value === "no") {
      const confirmar = window.confirm("¿Confirmas que NO hubo apoyos durante este turno?");
      if (!confirmar) {
        apoyoHubo.value = "";
      }
    }
    const enabled = apoyoHubo.value === "si";
    apoyoCantidadWrap?.classList.toggle("is-hidden", !enabled);
    if (!enabled) {
      if (apoyoCantidad) apoyoCantidad.value = "";
      if (apoyoRowsContainer) apoyoRowsContainer.innerHTML = "";
      apoyoTablaWrap?.classList.add("is-hidden");
    } else {
      renderApoyoRows(Number(apoyoCantidad?.value || 0));
    }
    syncApoyosConsultaVisibility();
    marcarComoNoVerificado();
  });
  apoyoCantidad?.addEventListener("change", () => {
    renderApoyoRows(Number(apoyoCantidad.value || 0));
    syncApoyosConsultaVisibility();
    marcarComoNoVerificado();
  });

  syncApoyosConsultaVisibility();

  cargarPoliticaEmpresa();
  cargarResponsables();
  cargarExtrasCatalogo();
  cargarNombreEmpresa();

  fecha.addEventListener("change", () => {
    actualizarEstadoHoraFin();
    syncApoyosConsultaVisibility();
    marcarComoNoVerificado();
  });
  responsable.addEventListener("change", marcarComoNoVerificado);
  horaInicio.addEventListener("change", marcarComoNoVerificado);
  horaFin.addEventListener("change", marcarComoNoVerificado);
  horaLlegadaHora?.addEventListener("change", marcarComoNoVerificado);
  horaLlegadaMinuto?.addEventListener("change", marcarComoNoVerificado);
  horaLlegadaMomento?.addEventListener("change", marcarComoNoVerificado);
  comentarios.addEventListener("input", marcarComoNoVerificado);
  bolsa?.addEventListener("input", () => {
    syncEfectivoRealFromCajaBolsa();
    syncDiferenciaEfectivo();
    syncApoyosConsultaVisibility();
    marcarComoNoVerificado();
  });
  caja?.addEventListener("input", () => {
    syncEfectivoRealFromCajaBolsa();
    syncDiferenciaEfectivo();
    syncApoyosConsultaVisibility();
    marcarComoNoVerificado();
  });
  efectivoApertura?.addEventListener("input", actualizarDiferenciaApertura);

  efectivoApertura?.addEventListener("input", () => {
    syncEfectivoSistemaDisplay();
    syncDiferenciaEfectivo();
    syncApoyosConsultaVisibility();
    marcarComoNoVerificado();
  });

  btnToggleEfectivoSistema?.addEventListener("click", () => {
    modoEfectivoSistema = modoEfectivoSistema === "bruto" ? "neto" : "bruto";
    btnToggleEfectivoSistema.classList.add("rotating");
    setTimeout(() => btnToggleEfectivoSistema.classList.remove("rotating"), 360);
    syncEfectivoSistemaDisplay();
    syncDiferenciaEfectivo();
  });
  Object.values(inputsFinanzas).forEach((grupo) => {
    grupo.real.addEventListener("input", () => {
      renderTotalizados();
      marcarComoNoVerificado();
    });
  });
  Object.values(inputsDiferencias).forEach(({ input }) => {
    input.addEventListener("input", marcarComoNoVerificado);
  });


  const descargarResumen = ({ bloquearDespues = false } = {}) => {
    const snapshotContext = {
      inputsFinanzas,
      inputsDiferencias,
      inputsSoloVista,
      bolsa,
      caja,
      extrasRows,
      apoyoRowsContainer,
      responsablesActivos,
      readApoyoRange,
      formatDurationLabel,
      getTotalIngresosSistema,
      getTotalIngresosReales,
      getTotalGastosExtras
    };

    const meta = {
      fecha: fecha?.value || "",
      responsableTexto: responsable?.selectedOptions?.[0]?.textContent || "-",
      horaLlegada: getHoraLlegadaCompleta() || "-",
      horaInicio: horaInicio?.value || "-",
      horaFin: horaFin?.value || "-",
      empresaNombre: nombreEmpresaActual || "Empresa",
      efectivoApertura: efectivoApertura?.value || 0,
      bolsa: bolsa?.value || 0,
      caja: caja?.value || 0,
      comentarioUsuario: comentarios?.value || ""
    };

    const ok = descargarResumenCierreTurno({
      snapshotContext,
      meta,
      formatCOP,
      setStatus
    });

    if (!ok) return false;
    resumenDescargado = true;
    aplicarBloqueoConstancia(Boolean(bloquearDespues));
    return true;
  };
  btnSolicitarCorreccion?.addEventListener("click", () => {
    if (!bloqueoConstanciaActivo) return;
    enviarAlertaManipulacion("solicita_correccion");
    modalCorreccion?.classList.remove("is-hidden");
  });

  btnAceptarCorreccion?.addEventListener("click", () => {
    modalCorreccion?.classList.add("is-hidden");
    resumenDescargado = false;
    verificado = false;
    aplicarBloqueoConstancia(false);
    setStatus("Modo corrección habilitado. Vuelve a verificar antes de subir.");
  });

  document.addEventListener("contextmenu", (event) => {
    if (!bloqueoConstanciaActivo || !resumenDescargado) return;
    event.preventDefault();
    enviarAlertaManipulacion("click_derecho_bloqueado");
  });

  window.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const recarga = key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
    if (!recarga || !bloqueoConstanciaActivo || !resumenDescargado) return;
    event.preventDefault();
    enviarAlertaManipulacion("intento_recarga_teclado");
    setStatus("Recarga bloqueada por seguridad luego de generar constancia visual.");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!bloqueoConstanciaActivo || !resumenDescargado) return;
    enviarAlertaManipulacion("intento_recarga_beforeunload");
    event.preventDefault();
    event.returnValue = "";
  });


  const setConsultarLoading = (isLoading, message = "Consultando...") => {
    if (!btnConsultar) return;
    btnConsultar.disabled = Boolean(isLoading);
    btnConsultar.classList.toggle("is-loading", Boolean(isLoading));
    btnConsultar.setAttribute("aria-busy", isLoading ? "true" : "false");
    btnConsultar.textContent = isLoading ? message : "Consultar Loggro";
  };

  btnConsultar.addEventListener("click", async () => {
    if (btnConsultar.disabled) return;
    consultaCompletada = false;
    verificado = false;
    refreshEstadoBotonSubir();
    setConsultarLoading(true, "Consultando turno...");
    setStatus("Consultando Loggro...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !getHoraLlegadaCompleta() || !horaInicio.value || (requiereHoraFin && !horaFin.value) || !efectivoApertura?.value) {
      setStatus("Atención: Completa fecha, responsable, hora de llegada, hora inicio/fin y efectivo de apertura.");
      setConsultarLoading(false);
      return;
    }

    if (!numeroTurno) {
      setStatus("Atención: Selecciona la jornada del turno (Turno 1, 2 o 3).");
      setConsultarLoading(false);
      return;
    }

    const payload = await buildTurnoPayload();
    if (!payload) {
      setConsultarLoading(false);
      return;
    }

    try {
      const [res] = await Promise.all([
        supabase.functions.invoke("consultar-ventas", { body: payload }),
        cargarEfectivoAperturaEsperado().catch((err) => {
          // No debe tumbar la consulta de ventas, pero tampoco desaparecer:
          // si esto se traga en silencio, la tarjeta se queda con el texto
          // inicial y parece que el boton no hace nada.
          console.error("[cierre_turno] carga de caja anterior interrumpida", err);
          if (efectivoAperturaOrigen) efectivoAperturaOrigen.textContent = "No se pudo cargar la caja anterior";
        })
      ]);

      const { data, error } = res;
      if (error || !data || !data.ok) {
        setStatus(data?.message || error?.message || `Error al consultar datos.`);
        setConsultarLoading(false);
        return;
      }

      const efectivoSistemaDesdeLoggro =
        data.efectivo_sistema
        ?? data.efectivo
        ?? data.ventas_efectivo
        ?? data.total_efectivo
        ?? 0;
      efectivoSistemaLoggro = toNumberValue(efectivoSistemaDesdeLoggro);

      syncEfectivoSistemaDisplay();
      inputsFinanzas.datafono.sistema.value = data.datafono_sistema ?? "";
      inputsFinanzas.rappi.sistema.value = data.rappi_sistema ?? "";
      inputsFinanzas.nequi.sistema.value = data.nequi_sistema ?? "";
      inputsFinanzas.transferencias.sistema.value = resolveTransferenciasSistema(data);
      inputsFinanzas.bono_regalo.sistema.value = data.bono_regalo_sistema ?? "";
      inputsSoloVista.propina.value = data.propina ?? "";
      apoyosPropinaManager?.reset?.();
      actualizarDomiciliosDesdeExtras();
      limpiarDiferencias();

      if (settingsVisibilidad.efectivo === false) {
        inputsFinanzas.efectivo.sistema.value = "0";
      }
      if (settingsVisibilidad.datafono === false) {
        inputsFinanzas.datafono.sistema.value = "0";
      }
      if (settingsVisibilidad.rappi === false) {
        inputsFinanzas.rappi.sistema.value = "0";
      }
      if (settingsVisibilidad.nequi === false) {
        inputsFinanzas.nequi.sistema.value = "0";
      }
      if (settingsVisibilidad.transferencias === false) {
        inputsFinanzas.transferencias.sistema.value = "0";
      }
      if (settingsVisibilidad.bono_regalo === false) {
        inputsFinanzas.bono_regalo.sistema.value = "0";
      }
      if (settingsVisibilidad.propina === false) {
        inputsSoloVista.propina.value = "0";
      }
      if (settingsVisibilidad.domicilios === false) {
        inputsSoloVista.domicilios.value = "0";
      }

      setStatus(data.message || "Datos consultados.");
      consultaCompletada = true;
      toggleButtons({ verificar: true });
      refreshEstadoBotonSubir();
    } catch (err) {
      setStatus(err?.name === "AbortError"
        ? "La consulta tardó más de 8 segundos."
        : "Error de conexión al consultar datos.");
    } finally {
      setConsultarLoading(false);
    }
  });

  btnConsultarGastos?.addEventListener("click", async () => {
    setStatus("Consultando gastos...");

    const requiereHoraFin = !fechaEsPasada(fecha.value);
    if (!fecha.value || !responsable.value || !getHoraLlegadaCompleta() || !horaInicio.value || (requiereHoraFin && !horaFin.value)) {
      setStatus("Atención: Completa todos los datos del turno.");
      return;
    }

    const payload = await buildTurnoPayload();
    if (!payload) return;

    try {
      const res = await supabase.functions.invoke("consultar-gastos", { body: payload });

      const { data, error } = res;
      if (error || !data || data.ok === false) {
        setStatus(data?.message || error?.message || `Error al consultar gastos.`);
        return;
      }
      const extras = normalizeExtras(data);

      if (!extrasRows.size) {
        buildExtrasRows(extras);
      }

      extras.forEach((item) => {
        const id = String(item.id ?? item.Id ?? item.ID ?? item.codigo ?? item.key ?? "");
        if (!id) return;
        const row = extrasRows.get(id);
        if (!row) return;

        const value = item.valor ?? item.value ?? item.monto ?? item.total ?? item.gasto ?? 0;
        row.value = value;

        if (row.input && row.visible) {
          row.input.value = String(value ?? 0);
        }
      });

      actualizarDomiciliosDesdeExtras();
      setStatus("Gastos consultados.");
    } catch (error) {
      setStatus(error?.name === "AbortError"
        ? "La consulta de gastos tardó más de 8 segundos."
        : "Error consultando gastos/No hay gastos de caja  por obtener");
    }
  });

  btnVerificar.addEventListener("click", async () => {
    setStatus("Verificando...");
    btnVerificar.disabled = true;

    try {
      // Siempre limpiar antes de un nuevo ciclo de verificación
      limpiarDiferencias();
      actualizarDomiciliosDesdeExtras();

      if (!validateCamposObligatoriosCompletos()) return;
      if (!validateApoyoRows()) return;
      if (!confirmarCerosCriticos()) {
        setStatus("Verificación cancelada por el usuario para revisar Bolsa/Caja en cero.");
        return;
      }
      if (!exigirConfirmacionApoyo()) return;

      const contextPayload = await getContextPayload();
      if (!contextPayload) return;
      const apoyoPayload = buildApoyoPayload(contextPayload);

      const payload = {
        fecha: fecha.value,
        responsable: responsable.value,
        turno: {
          hora_llegada: getHoraLlegadaCompleta(),
          inicio: horaInicio.value,
          fin: horaFin.value,
          inicio_momento: getMomentoDia(horaInicio.value),
          fin_momento: getMomentoDia(horaFin.value)
        },
        finanzas: {
          efectivo_apertura: efectivoApertura.value || 0,
          efectivo: {
            sistema: String(getEfectivoSistemaNeto()),
            real: inputsFinanzas.efectivo.real.value || 0
          },
          datafono: {
            sistema: inputsFinanzas.datafono.sistema.value || 0,
            real: inputsFinanzas.datafono.real.value || 0
          },
          rappi: {
            sistema: inputsFinanzas.rappi.sistema.value || 0,
            real: inputsFinanzas.rappi.real.value || 0
          },
          nequi: {
            sistema: inputsFinanzas.nequi.sistema.value || 0,
            real: inputsFinanzas.nequi.real.value || 0
          },
          transferencias: {
            sistema: inputsFinanzas.transferencias.sistema.value || 0,
            real: inputsFinanzas.transferencias.real.value || 0
          },
          bono_regalo: {
            sistema: inputsFinanzas.bono_regalo.sistema.value || 0,
            real: inputsFinanzas.bono_regalo.real.value || 0
          },
          propina: inputsSoloVista.propina.value || 0,
          domicilios: inputsSoloVista.domicilios.value || 0,
          bolsa: bolsa?.value || 0,
          caja: caja?.value || 0
        },
        comentarios: comentarios.value || "",
        bolsa: bolsa?.value || 0,
        caja: caja?.value || 0,
        efectivo_apertura: efectivoApertura.value || 0,
        gastos_extras: buildExtrasPayload(),
        apoyo: apoyoPayload,
        ...contextPayload
      };

      // Lógica de verificación trasladada desde n8n al cliente (más eficiente)
      // Simular un pequeño retardo de red para la percepción de guardado/proceso
      await new Promise(resolve => setTimeout(resolve, 500));

      const diferenciaEfectivoCalculada = syncDiferenciaEfectivo();
      const diferenciaLocal = (medio) => (
        toNumberValue(inputsFinanzas[medio]?.real?.value) - toNumberValue(inputsFinanzas[medio]?.sistema?.value)
      );
      const diferencias = {
        efectivo: diferenciaEfectivoCalculada,
        datafono: diferenciaLocal("datafono"),
        rappi: diferenciaLocal("rappi"),
        nequi: diferenciaLocal("nequi"),
        transferencias: diferenciaLocal("transferencias"),
        bono_regalo: diferenciaLocal("bono_regalo")
      };

      Object.entries(diferencias).forEach(([field, value]) => {
        if (!inputsDiferencias[field]) return;
        inputsDiferencias[field].input.value = value ?? "";
        actualizarEstadoDiferencia(field, value);
      });

      await cargarPoliticaEmpresa(true);
      verificado = true;
      const serverMsg = "";
      setStatus(`Cálculos de cuadre verificados correctamente. Ya puedes subir el cierre.`);
      refreshEstadoBotonSubir();
    } catch (err) {
      setStatus("Error de cálculo al verificar el cierre.");
    } finally {
      btnVerificar.disabled = false;
    }
  });

  const obtenerEstadoGlobalDiferencias = () => {
    let tieneFaltante = false;
    let tieneSobrante = false;
    Object.values(inputsDiferencias).forEach(({ input }) => {
      const value = Number(input.value);
      if (Number.isNaN(value)) return;
      if (value < 0) tieneFaltante = true;
      if (value > 0) tieneSobrante = true;
    });
    if (tieneFaltante) return "faltante";
    if (tieneSobrante) return "sobrante";
    return "ok";
  };

  const obtenerMensajeEnvio = (estado) => {
    if (estado === "faltante") {
      return "En estos datos hay un faltante. Quedará registrado para revisión, pero no bloquea el cierre.";
    }
    if (estado === "sobrante") {
      return "En estos datos hay un sobrante. Verifica las cuentas; si son correctas, puedes continuar con el cierre.";
    }
    return "Buen trabajo! todo se ve bien, apreciamos tu esfuerzo.";
  };

  const construirPayloadEnvio = async () => {
    const contextPayload = await getContextPayload();
    if (!contextPayload) return null;

    let esLocalContexto = false;
    try {
      esLocalContexto = await resolverEmpresaEsLocal(contextPayload.empresa_id);
    } catch (error) {
      console.error("[cierre_turno] no se pudo validar el destino del cierre", error);
      setStatus("No se pudo validar la sede del cierre. Recarga e intenta nuevamente.");
      return null;
    }

    if (!numeroTurno) {
      setStatus("Selecciona la jornada del turno (Turno 1, 2 o 3) antes de enviar.");
      return null;
    }

    if (!validateCamposObligatoriosCompletos()) return null;
    if (!validateApoyoRows()) return null;
    if (!confirmarCerosCriticos()) {
      setStatus("Envío cancelado para revisar Bolsa/Caja en cero.");
      return null;
    }

    actualizarDomiciliosDesdeExtras();
    const apoyoPayload = buildApoyoPayload(contextPayload);

    const fechaCompleta = formatFechaCompleta(fecha.value);
    const diferencias = {
      efectivo_diferencia: inputsDiferencias.efectivo.input.value || 0,
      datafono_diferencia: inputsDiferencias.datafono.input.value || 0,
      rappi_diferencia: inputsDiferencias.rappi.input.value || 0,
      nequi_diferencia: inputsDiferencias.nequi.input.value || 0,
      transferencias_diferencia: inputsDiferencias.transferencias.input.value || 0,
      bono_de_regalo_diferencia: inputsDiferencias.bono_regalo.input.value || 0
    };

    const mediosPago = ["efectivo", "datafono", "rappi", "nequi", "transferencias", "bono_regalo"];

    const obtenerCategoriaGasto = (nombre) => {
      const label = String(nombre || "").toLowerCase();
      if (label.includes("domicilios") && label.includes("operativ")) return "domicilios_operativos";
      if (label.includes("domicilios") && label.includes("cliente")) return "domicilios_clientes";
      if (label.includes("insumo")) return "insumos";
      if (label.includes("arriendo")) return "arriendo";
      if (label.includes("aseo") || label.includes("limpieza")) return "aseo";
      if (label.includes("plástico") || label.includes("plastico") || label.includes("desechable")) return "desechables";
      if (label.includes("prote") || label.includes("té") || label.includes("te")) return "insumos_especiales";
      return "general";
    };

    const itemsFinanzas = mediosPago.flatMap((medio) => {
      const valorSistema = medio === "efectivo"
        ? String(getEfectivoSistemaNeto())
        : (inputsFinanzas[medio]?.sistema?.value || 0);
      const valorReal = inputsFinanzas[medio]?.real?.value || 0;
      const diferenciaRaw = diferencias[`${medio}_diferencia`] ?? (Number(valorReal) - Number(valorSistema));
      const diferenciaNum = Number(diferenciaRaw);
      const tieneDiferencia = Number.isFinite(diferenciaNum) ? diferenciaNum !== 0 : false;

      return [
        {
          tipo: medio,
          categoria: "sistema",
          valor: String(valorSistema),
          id_referencia: null,
          tiene_diferencia: false
        },
        {
          tipo: medio,
          categoria: "real",
          valor: String(valorReal),
          id_referencia: null,
          tiene_diferencia: tieneDiferencia,
          ...(tieneDiferencia ? { diferencia: String(diferenciaRaw) } : {})
        }
      ];
    });

    const gastosExtras = buildExtrasPayload();
    const itemsGastos = gastosExtras.map((gasto) => ({
      tipo: "gasto_extra",
      categoria: obtenerCategoriaGasto(gasto.name),
      valor: String(Number(gasto.valor || 0)),
      id_referencia: gasto.Id || null,
      tiene_diferencia: false
    }));

    const totalSistema = mediosPago.reduce((acc, medio) => acc + Number(inputsFinanzas[medio]?.sistema?.value || 0), 0);
    const totalReal = mediosPago.reduce((acc, medio) => acc + Number(inputsFinanzas[medio]?.real?.value || 0), 0);
    const diferenciaTotal = Object.values(diferencias).reduce((acc, value) => acc + Number(value || 0), 0);
    const totalGastosExtras = gastosExtras.reduce((acc, gasto) => acc + Number(gasto.valor || 0), 0);
    const totalDomiciliosOperativos = itemsGastos
      .filter((item) => item.categoria === "domicilios_operativos")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const totalDomiciliosClientes = itemsGastos
      .filter((item) => item.categoria === "domicilios_clientes")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);

    return {
      global: {
        fecha: fecha.value,
        numero_turno: numeroTurno,
        token_envio: tokenEnvio,
        sobrescribir: false,
        empresa_id: contextPayload.empresa_id,
        tenant_id: contextPayload.tenant_id,
        es_local_contexto: esLocalContexto,
        usuario_id: contextPayload.usuario_id,
        responsable_id: responsable.value,
        registrado_por: contextPayload.registrado_por,
        rol: contextPayload.rol,
        timestamp: contextPayload.timestamp,
        comentarios: comentarios.value || "",
        hora_llegada: getHoraLlegadaCompleta(),
        turno: {
          hora_llegada: getHoraLlegadaCompleta(),
          inicio: horaInicio.value,
          fin: horaFin.value,
          inicio_momento: getMomentoDia(horaInicio.value),
          fin_momento: getMomentoDia(horaFin.value),
          fecha_inicio: fechaCompleta,
          fecha_fin: fechaCompleta
        },
        efectivo_apertura: efectivoApertura.value || 0,
        // En BD se conserva solamente la parte del responsable. El total del
        // turno sigue viajando en resumen.total_propinas para auditoría.
        propina_global: inputsSoloVista.propina.dataset.propinaResponsable
          || inputsSoloVista.propina.value
          || 0,
        domicilios_global: inputsSoloVista.domicilios.value || 0,
        bolsa_global: bolsa?.value || 0,
        caja_global: caja?.value || 0
      },
      variables: [...itemsFinanzas, ...itemsGastos],
      resumen: {
        total_sistema: totalSistema,
        total_real: totalReal,
        diferencia_total: diferenciaTotal,
        total_gastos_extras: totalGastosExtras,
        total_domicilios_operativos: totalDomiciliosOperativos,
        total_domicilios_clientes: totalDomiciliosClientes,
        total_propinas: Number(inputsSoloVista.propina.value || 0),
        total_bolsa: Number(bolsa?.value || 0),
        caja_final: Number(caja?.value || 0)
      },
      apoyo: apoyoPayload
    };
  };

  btnEnviar.addEventListener("click", async () => {
    if (!consultaCompletada) {
      setStatus("Consulta primero los datos del turno antes de subir el cierre.");
      return;
    }
    if (!validateCamposObligatoriosCompletos()) return;
    if (!validateApoyoRows()) return;

    // El envío no depende de que el botón Verificar haya quedado habilitado.
    // Siempre recalculamos aquí para guardar las diferencias reales —positivas
    // o negativas— como observación no bloqueante.
    actualizarDomiciliosDesdeExtras();
    const diferenciasActuales = {
      efectivo: syncDiferenciaEfectivo(),
      datafono: toNumberValue(inputsFinanzas.datafono.real.value) - toNumberValue(inputsFinanzas.datafono.sistema.value),
      rappi: toNumberValue(inputsFinanzas.rappi.real.value) - toNumberValue(inputsFinanzas.rappi.sistema.value),
      nequi: toNumberValue(inputsFinanzas.nequi.real.value) - toNumberValue(inputsFinanzas.nequi.sistema.value),
      transferencias: toNumberValue(inputsFinanzas.transferencias.real.value) - toNumberValue(inputsFinanzas.transferencias.sistema.value),
      bono_regalo: toNumberValue(inputsFinanzas.bono_regalo.real.value) - toNumberValue(inputsFinanzas.bono_regalo.sistema.value)
    };
    Object.entries(diferenciasActuales).forEach(([field, value]) => {
      if (!inputsDiferencias[field]) return;
      inputsDiferencias[field].input.value = String(value ?? 0);
      actualizarEstadoDiferencia(field, value);
    });
    verificado = true;

    const estado = obtenerEstadoGlobalDiferencias();
    mensajeEnvio.textContent = obtenerMensajeEnvio(estado);
    confirmacionEnvio.classList.remove("is-hidden");
  });

  btnConfirmarEnvio.addEventListener("click", async () => {
    setStatus("Enviando cierre...");
    const payload = await construirPayloadEnvio();
    if (!payload) return;

    const writeAllowed = await puedeEnviarDatos(payload?.global?.empresa_id, true).catch(() => false);
    if (!writeAllowed) {
      setStatus("Plan FREE o empresa inactiva: envio bloqueado por seguridad.");
      confirmacionEnvio.classList.add("is-hidden");
      return;
    }

    // El RPC es transaccional e idempotente: o entra el cierre entero o no
    // entra nada, y reenviar el mismo token no duplica el turno.
    const enviarCierre = async (cuerpo) => {
      const { data, error } = await supabase.rpc("subir_cierre_turno", { p_datos: cuerpo });
      if (error) throw error;
      return data || {};
    };

    try {
      let data = await enviarCierre(payload);

      // El turno ya existía: el backend no toca nada hasta que se confirme.
      if (data?.requiere_confirmacion) {
        const aceptar = window.confirm(
          `${data.message}

La versión anterior quedará guardada en el histórico, con tu nombre y la fecha del cambio.`
        );

        if (!aceptar) {
          setStatus("Envío cancelado. No se modificó el turno que ya estaba guardado.");
          confirmacionEnvio.classList.add("is-hidden");
          return;
        }

        const motivo = window.prompt("¿Por qué reemplazas este turno? (opcional)", "") || "";
        data = await enviarCierre({
          ...payload,
          global: { ...payload.global, sobrescribir: true, motivo }
        });
      }

      if (data?.ok === false) {
        setStatus(data?.message || "No se pudo subir el cierre.");
        return;
      }

      // El destino ya viene de `app_es_local()`, la misma fuente que usa el
      // servidor, así que esto es una red de seguridad. Ojo con el enunciado:
      // si salta, el cierre YA está escrito — lo que falla es la coherencia
      // entre lo que se creía y lo que resolvió el servidor, y hay que mirarlo.
      // Cuidado: en el reenvío idempotente el RPC corta antes y no incluye
      // `es_local`. Comparar contra un undefined marcaría destino equivocado en
      // una sede local cada vez que se reintenta un envío ya procesado.
      const esperabaLocal = payload?.global?.es_local_contexto === true;
      const esReenvio = data?.reenvio_ignorado === true;
      if (!esReenvio && Boolean(data?.es_local) !== Boolean(esperabaLocal)) {
        throw new Error("El cierre se guardó, pero el servidor lo mandó a una sede distinta de la seleccionada. Revisa el turno antes de darlo por bueno.");
      }
      const esLocalConfirmado = esReenvio ? esperabaLocal : data?.es_local === true;

      console.info("subir_cierre_turno OK", data);

      // Antes de dibujar nada: comprobar que la fila existe de verdad. Si esto
      // lanza, se va al catch y NO se descarga constancia.
      const filaConfirmada = await confirmarCierreGuardado({
        empresaId: data?.empresa_id || payload?.global?.empresa_id,
        fechaTurno: data?.fecha_turno || payload?.global?.fecha,
        numero: data?.numero_turno ?? payload?.global?.numero_turno,
        esLocal: esLocalConfirmado
      });
      console.info("[cierre_turno] cierre confirmado en base", filaConfirmada);

      // Token nuevo: este cierre ya entró y el siguiente envío es otro turno.
      tokenEnvio = (crypto?.randomUUID?.() || `envio-${Date.now()}-${Math.random().toString(16).slice(2)}`);

      const descargaOk = descargarResumen({ bloquearDespues: false });
      const apertura = data?.efectivo_apertura;
      const avisoApertura = apertura && Number(apertura.diferencia) !== 0
        ? ` Atención: el efectivo de apertura difiere en ${apertura.diferencia} respecto a ${apertura.origen || "el cierre anterior"}.`
        : "";
      // Un reenvío del mismo token no escribe nada nuevo. Decirlo, para que la
      // constancia no se lea como prueba de un guardado que no ocurrió ahora.
      const avisoReenvio = data?.reenvio_ignorado === true
        ? " Este turno ya estaba guardado: la constancia corresponde al cierre que ya existía."
        : "";

      setStatus(
        (data?.message || "Cierre enviado correctamente.")
        + (descargaOk ? " Constancia en PDF descargada automáticamente." : " No se pudo descargar la constancia en PDF.")
        + avisoReenvio
        + avisoApertura
      );
      confirmacionEnvio.classList.add("is-hidden");
      aplicarBloqueoConstancia(false);
      revisarTurnoExistente();
    } catch (err) {
      console.error("Error subiendo cierre", err);
      setStatus(err?.message || "Error de conexión al subir cierre.");
    }
  });

  btnCancelarEnvio.addEventListener("click", () => {
    confirmacionEnvio.classList.add("is-hidden");
  });

  btnLimpiar.addEventListener("click", () => {
    limpiarCamposDatos();
    setStatus("Datos limpiados.");
  });
});
