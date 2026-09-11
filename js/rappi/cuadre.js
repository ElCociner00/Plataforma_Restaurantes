import {
  bootRappiShell, emptyRow, escapeHtml, formatDate, formatMoney, invokeRappi, isAdminContext,
  setBusy, toast,
} from "./core.js?v=20260911rappi4";
import { paymentMethodLabel } from "./veredictos.js?v=20260911rappi4";
import { APP_URLS } from "../urls.js";

// Diferencias menores a esto se consideran redondeo o descuentos pequeños.
const TOLERANCE = 1000;

let lastResult = null;
const form = document.querySelector("#cuadre-form");

const today = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
document.querySelector("#cuadre-from").value = `${today.slice(0, 8)}01`;
document.querySelector("#cuadre-to").value = today;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  setBusy(button, true, "Calculando…");
  try { await load(); }
  catch (error) { toast(error.message, "error"); }
  finally { setBusy(button, false); }
});
document.querySelector("#cuadre-csv").addEventListener("click", downloadCsv);
document.querySelector("#cuadre-print").addEventListener("click", () => window.print());

try {
  await bootRappiShell();
  if (!isAdminContext()) window.location.replace(APP_URLS.rappiOperacion);
  else await load();
} catch (error) {
  console.error("[rappi-cuadre]", error);
  toast(error.message || "No fue posible calcular el cuadre.", "error");
}

async function load() {
  const values = Object.fromEntries(new FormData(form));
  lastResult = await invokeRappi("rappi-data", { action: "cuadre", from: values.from, to: values.to });
  render(lastResult);
  document.querySelector("#cuadre-csv").disabled = !lastResult.dias?.length;
}

function difference(day) {
  if (day.rappi_sistema === null || day.rappi_sistema === undefined) return null;
  return Number(day.total_entregado || 0) - Number(day.rappi_sistema || 0);
}

/**
 * Qué hay que revisar en un día, en palabras. Solo desde que la integración
 * empezó a recibir pedidos: antes, los pedidos Rappi entraban por la tablet y
 * Enkrato no los veía, así que no hay contra qué comparar.
 */
function dayFlag(day) {
  const since = lastResult?.integracion_desde;
  if (!since || day.dia < since) return null;
  const system = Number(day.rappi_sistema || 0);
  if (system > TOLERANCE && Number(day.entregados) === 0) {
    return { tone: "bad", text: "Los cierres registran Rappi, pero Rappi no confirma ningún pedido entregado ese día." };
  }
  if (Number(day.entregados) > 0 && Number(day.turnos) === 0) {
    return { tone: "warn", text: "Hubo pedidos entregados y no hay cierre de turno ese día." };
  }
  const diff = difference(day);
  if (diff !== null && Math.abs(diff) > TOLERANCE) {
    return { tone: "warn", text: diff > 0 ? "Rappi entregó más de lo registrado en cierres." : "Los cierres registran más Rappi del que Rappi entregó." };
  }
  return null;
}

function render(result) {
  const days = result.dias || [];
  const scope = document.querySelector("#cuadre-scope");
  scope.hidden = false;
  scope.className = `notice${result.integracion_desde ? "" : " warning"}`;
  scope.textContent = !result.conectada
    ? "Esta empresa todavía no tiene una tienda de Rappi conectada a Enkrato. Los cierres se muestran como referencia, pero no hay pedidos contra los cuales cuadrarlos."
    : result.integracion_desde
    ? `Enkrato recibe los pedidos de Rappi desde el ${formatDate(`${result.integracion_desde}T12:00:00-05:00`, false)}. Los días anteriores se muestran sin comparar.`
    : "La tienda está conectada, pero todavía no ha llegado ningún pedido por la integración.";
  const sum = (key) => days.reduce((total, day) => total + Number(day[key] || 0), 0);
  const withClosures = days.filter((day) => day.rappi_sistema !== null && day.rappi_sistema !== undefined &&
    result.integracion_desde && day.dia >= result.integracion_desde);
  const deliveredOnClosureDays = withClosures.reduce((total, day) => total + Number(day.total_entregado || 0), 0);
  const closures = withClosures.reduce((total, day) => total + Number(day.rappi_sistema || 0), 0);
  document.querySelector("#m-pedidos").textContent = sum("pedidos");
  document.querySelector("#m-entregados").textContent = sum("entregados");
  document.querySelector("#m-total").textContent = formatMoney(sum("total_entregado"));
  document.querySelector("#m-cierres").textContent = withClosures.length ? formatMoney(closures) : "Sin cierres";
  document.querySelector("#m-diferencia").textContent = withClosures.length ? formatMoney(deliveredOnClosureDays - closures) : "—";
  document.querySelector("#m-perdido").textContent = formatMoney(sum("total_no_vendido"));

  const flagged = days.filter(dayFlag).length;
  document.querySelector("#cuadre-summary").textContent = days.length
    ? `${days.length} día(s) con movimiento entre ${formatDate(`${result.from}T12:00:00-05:00`, false)} y ${formatDate(`${result.to}T12:00:00-05:00`, false)}. ${flagged ? `${flagged} día(s) para revisar.` : "Ningún día con diferencias para revisar."}`
    : "No hay pedidos Rappi ni cierres con Rappi en ese periodo.";

  document.querySelector("#cuadre-body").innerHTML = days.length ? days.map((day) => {
    const diff = difference(day);
    const flag = dayFlag(day);
    return `<tr class="${flag ? `row-${flag.tone}` : ""}">
      <td><strong>${formatDate(`${day.dia}T12:00:00-05:00`, false)}</strong>${flag ? `<br><span class="helper">${escapeHtml(flag.text)}</span>` : ""}</td>
      <td>${day.pedidos}</td><td>${day.entregados}</td><td>${day.cancelados}</td><td>${day.vencidos}</td>
      <td>${formatMoney(day.total_entregado)}</td><td>${formatMoney(day.cobrado_por_local)}</td>
      <td>${day.rappi_sistema === null ? "Sin cierre" : formatMoney(day.rappi_sistema)}</td>
      <td>${day.rappi_real === null ? "—" : formatMoney(day.rappi_real)}</td>
      <td>${diff === null || !result.integracion_desde || day.dia < result.integracion_desde ? "—" : `<strong>${formatMoney(diff)}</strong>`}</td>
    </tr>`;
  }).join("") : emptyRow(10, "No hay datos en ese periodo.");

  const methods = result.metodos_pago || [];
  document.querySelector("#metodos-body").innerHTML = methods.length
    ? methods.map((row) => `<tr><td>${escapeHtml(paymentMethodLabel(row.metodo))}</td><td>${row.pedidos}</td><td>${formatMoney(row.total)}</td></tr>`).join("")
    : emptyRow(3, "No hubo pedidos entregados en ese periodo.");
}

function downloadCsv() {
  if (!lastResult?.dias?.length) return;
  const header = ["dia", "pedidos", "entregados", "cancelados", "vencidos", "total_entregado", "cobrado_por_local", "cierres_rappi_sistema", "cierres_rappi_contado", "diferencia", "revisar"];
  const rows = lastResult.dias.map((day) => [
    day.dia, day.pedidos, day.entregados, day.cancelados, day.vencidos, day.total_entregado,
    day.cobrado_por_local, day.rappi_sistema ?? "", day.rappi_real ?? "", difference(day) ?? "", dayFlag(day)?.text ?? "",
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
    .join("\r\n");
  // El BOM hace que Excel abra las tildes bien.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `cuadre_rappi_${lastResult.from}_${lastResult.to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
