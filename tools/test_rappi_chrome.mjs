import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const debugBase = process.argv[2] || "http://127.0.0.1:9333";
const outputDir = path.resolve(process.argv[3] || ".chrome-rappi-visual/screenshots");
const routes = [
  ["hub", "http://127.0.0.1:8765/rappi/", "Enkrato | Rappi"],
  ["operation", "http://127.0.0.1:8765/rappi/operacion.html", "Enkrato | Rappi"],
  ["integration", "http://127.0.0.1:8765/rappi/integracion.html", "Enkrato | Integración Rappi"],
];

async function main() {
await mkdir(outputDir, { recursive: true });
const target = await fetch(`${debugBase}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then(checkJson);
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.ready;
await Promise.all([
  cdp.send("Page.enable"),
  cdp.send("Runtime.enable"),
  cdp.send("Network.enable"),
]);
await cdp.send("Network.setBlockedURLs", { urls: ["*js/router.js*", "*js/rappi/*.js*"] });

const results = [];
for (const [name, url, expectedTitle] of routes) {
  await setViewport(cdp, 1440, 1000);
  await navigate(cdp, url);
  await cdp.send("Runtime.evaluate", { expression: "document.body.style.display = 'block'" });
  const inspection = await evaluate(cdp, `(() => ({
    title: document.title,
    main: Boolean(document.querySelector('.rappi-main')),
    globalHeader: Boolean(document.querySelector('.app-header')),
    alternateHeader: Boolean(document.querySelector('.rappi-topbar')),
    moduleLinks: document.querySelectorAll('.rappi-subnav a').length,
    forbiddenText: /Movimientos Rappi|\\bR[123]\\b|API operacional|Procesar cola|Webhooks Rappi|Financial/i.test(document.body.innerText),
    bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    background: getComputedStyle(document.body).backgroundColor
  }))()`);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(outputDir, `${name}-desktop.png`), Buffer.from(screenshot.data, "base64"));
  results.push({ name, viewport: "desktop", ...inspection });
  assert(inspection.title === expectedTitle, `${name}: título inesperado`);
  assert(inspection.main && inspection.globalHeader, `${name}: falta el shell global de Enkrato`);
  assert(!inspection.alternateHeader, `${name}: conserva un header alternativo`);
  assert(inspection.moduleLinks === 2, `${name}: la navegación debe contener dos secciones`);
  assert(!inspection.forbiddenText, `${name}: expone lenguaje técnico o módulos internos`);
  assert(!inspection.bodyOverflow, `${name}: overflow horizontal en escritorio`);
}

await setViewport(cdp, 390, 844, 3);
await navigate(cdp, routes[2][1]);
await cdp.send("Runtime.evaluate", { expression: "document.body.style.display = 'block'" });
const mobile = await evaluate(cdp, `(() => ({
  title: document.title,
  bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  mainWidth: Math.round(document.querySelector('.rappi-main').getBoundingClientRect().width),
  viewportWidth: window.innerWidth,
  columns: getComputedStyle(document.querySelector('.form-grid')).gridTemplateColumns,
  globalHeader: Boolean(document.querySelector('.app-header')),
  alternateHeader: Boolean(document.querySelector('.rappi-topbar')),
  subnavVisible: getComputedStyle(document.querySelector('.rappi-subnav')).display !== 'none'
}))()`);
const mobileScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile(path.join(outputDir, "integration-mobile.png"), Buffer.from(mobileScreenshot.data, "base64"));
assert(!mobile.bodyOverflow, "integration: overflow horizontal en móvil");
assert(mobile.columns.split(" ").length === 1, "integration: formulario no colapsó a una columna");
assert(mobile.globalHeader && !mobile.alternateHeader && mobile.subnavVisible, "integration: navegación global/móvil incorrecta");
results.push({ name: "integration", viewport: "mobile", ...mobile });

await cdp.send("Page.close");
console.log(JSON.stringify({ ok: true, results, screenshots: outputDir }, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function setViewport(client, width, height, deviceScaleFactor = 1) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: width < 700 });
}

async function navigate(client, url) {
  const loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 8000))]);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Chrome evaluation failed");
  return result.result.value;
}

async function checkJson(response) {
  if (!response.ok) throw new Error(`Chrome endpoint returned ${response.status}`);
  return await response.json();
}

class Cdp {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.onMessage(event));
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const handlers = this.listeners.get(method) || [];
      handlers.push(resolve);
      this.listeners.set(method, handlers);
    });
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    const handlers = this.listeners.get(message.method) || [];
    this.listeners.delete(message.method);
    handlers.forEach((handler) => handler(message.params));
  }
}

await main();
