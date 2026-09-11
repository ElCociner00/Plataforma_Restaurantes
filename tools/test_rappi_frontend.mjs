import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["rappi/index.html", "rappi/operacion.html", "rappi/cuadre.html", "rappi/integracion.html"];
const expectedEvents = [
  "NEW_ORDER", "ORDER_EVENT_CANCEL", "ORDER_OTHER_EVENT", "MENU_APPROVED",
  "MENU_REJECTED", "PING", "STORE_CONNECTIVITY", "ORDER_RT_TRACKING",
];
const prohibitedUi = [
  /Movimientos Rappi/i, /\bR1\b/, /\bR2\b/, /\bR3\b/, /Client ID operacional/i,
  /Client secret operacional/i, /API operacional/i, /API de órdenes/i,
  /Procesar cola/i, /Confirmo reemplazo/i, /edición remota/i, /Webhooks Rappi/i,
  /Sincronizaciones recientes/i, /Errores abiertos/i,
];
const failures = [];

for (const relativePage of pages) {
  const absolutePage = path.join(root, relativePage);
  const html = await readFile(absolutePage, "utf8");
  assert(html.includes("../js/router.js"), `${relativePage}: falta protección de sesión`);
  assert(html.includes("../js/header.js"), `${relativePage}: no reutiliza el header global`);
  assert(html.includes("../css/main.css"), `${relativePage}: no reutiliza los estilos globales`);
  assert(!html.includes("rappi-topbar"), `${relativePage}: conserva un header alternativo`);
  for (const pattern of prohibitedUi) assert(!pattern.test(html), `${relativePage}: expone texto prohibido ${pattern}`);

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const reference = match[1].split("?")[0];
    if (!reference || /^(?:https?:|#|data:)/.test(reference)) continue;
    const target = path.resolve(path.dirname(absolutePage), reference);
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      failures.push(`${relativePage}: referencia fuera del sitio ${reference}`);
      continue;
    }
    try { await access(path.extname(target) ? target : path.join(target, "index.html")); }
    catch { failures.push(`${relativePage}: asset/ruta inexistente ${reference}`); }
  }
}

const integrationHtml = await readFile(path.join(root, "rappi/integracion.html"), "utf8");
assert(integrationHtml.includes("Client ID de pruebas"), "Onboarding no solicita Client ID de pruebas");
assert(integrationHtml.includes("Client Secret de pruebas"), "Onboarding no solicita Client Secret de pruebas");
assert(integrationHtml.includes("Conectar y configurar"), "Onboarding no ofrece una acción única de conexión");
assert(integrationHtml.includes("Validar y enviar menú"), "Onboarding no permite cargar un menú DEV por tienda");
assert(!integrationHtml.includes('value="PROD"'), "La UI permite seleccionar producción");
assert(!integrationHtml.includes('name="operational_base_url"'), "La UI pide endpoints internos");

const backendTypes = await readFile(path.join(root, "supabase/functions/_shared/rappi/types.ts"), "utf8");
for (const event of expectedEvents) assert(backendTypes.includes(`"${event}"`), `Backend sin evento ${event}`);
const backendCount = [...backendTypes.matchAll(/^\s+"[A-Z_]+",?$/gm)].length;
assert(backendCount === expectedEvents.length, `Backend tiene ${backendCount} eventos; se esperaban ${expectedEvents.length}`);

const backendAdmin = await readFile(path.join(root, "supabase/functions/rappi-admin/index.ts"), "utf8");
assert(backendAdmin.includes('case "onboard"'), "Backend sin onboarding automático");
assert(backendAdmin.includes('case "upload_menu"'), "Backend sin carga de menú DEV");
assert(backendAdmin.includes("remoteWebhookMatches"), "Backend no verifica la configuración remota");
assert(backendAdmin.includes("RAPPI_PROD_BLOCKED"), "Backend no bloquea producción");
assert(backendAdmin.includes("cleanupControlledTestOrder"), "Las pruebas internas no autolimpian pedidos");
assert(backendAdmin.includes('case "cleanup_dev_test_data"'), "Backend sin limpieza administrativa DEV");
assert(backendAdmin.includes("RAPPI_CLEANUP_DEV_ONLY"), "Limpieza de muestras no está limitada a DEV");

const backendWorker = await readFile(path.join(root, "supabase/functions/rappi-worker/index.ts"), "utf8");
assert(backendWorker.includes("isRappiTesterSample"), "Worker no separa muestras del simulador");

const header = await readFile(path.join(root, "js/header.js"), "utf8");
assert(!header.includes("Movimientos Rappi"), "Header conserva el nombre anterior");
assert(header.includes("Integración Rappi"), "Header no enlaza la integración Rappi");
assert((header.match(/Integración Loggro/g) || []).length === 2, "Faltan accesos Loggro en ambos acordeones");

const rappiCore = await readFile(path.join(root, "js/rappi/core.js"), "utf8");
assert(!/administrador|master|superadmin/.test(rappiCore), "Integración Rappi admite roles distintos de admin/admin_root");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Rappi V4 frontend OK: header global, onboarding simple y ${expectedEvents.length} eventos administrados por backend.`);

function assert(condition, message) { if (!condition) failures.push(message); }
