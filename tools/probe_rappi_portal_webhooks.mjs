import { readFile } from "node:fs/promises";

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error
        ? pending.reject(new Error(message.error.message))
        : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.socket.close();
  }
}

const debugBase = process.argv[2] || "http://127.0.0.1:9444";
const shouldSendSamples = process.argv.includes("--send-samples");
const portalClientId =
  process.argv.find((value) => value.startsWith("--client-id="))?.slice(12) ||
  "";
const env = parseEnv(
  await readFile(new URL("../.env", import.meta.url), "utf8"),
);
if (!env.RAPPI_DEV_CLIENT_ID) {
  throw new Error("Falta RAPPI_DEV_CLIENT_ID en .env");
}
if (
  shouldSendSamples && portalClientId &&
  portalClientId !== env.RAPPI_DEV_CLIENT_ID
) {
  throw new Error(
    "Por seguridad solo se pueden enviar muestras al clientId DEV de Enkrato.",
  );
}
const targets = await fetch(`${debugBase}/json/list`).then((response) =>
  response.json()
);
const target = targets.find((item) =>
  item.url.startsWith("https://integrations-manager.rappi.com/")
);
if (!target?.webSocketDebuggerUrl) {
  throw new Error("No hay una sesión autenticada del Integration Manager");
}
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send("Runtime.enable");

const expression = `async () => {
  const clientId = ${JSON.stringify(portalClientId || env.RAPPI_DEV_CLIENT_ID)};
  const request = async (url, init) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        country: 'CO',
        env: 'DEV',
        'show-error-notification': 'false',
        ...(init?.headers || {}),
      },
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = { unparsed: true }; }
    return { status: response.status, ok: response.ok, body };
  };
  const integrations = await request('/api/integrations');
  const subscriptions = await request('/api/webhooks/subscriptions?clientId=' + encodeURIComponent(clientId));
  const samples = [];
  if (${shouldSendSamples}) {
    for (const event of ['NEW_ORDER', 'STORE_CONNECTIVITY', 'ORDER_RT_TRACKING']) {
      samples.push({ event, response: await request('/api/webhooks/sample?clientId=' + encodeURIComponent(clientId), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, storeId: ${
  JSON.stringify(env.RAPPI_DEV_STORE_ID || "900170987")
} }),
      }) });
    }
  }
  const integrationInput = document.querySelector('input[role="combobox"]');
  const clearButton = [...document.querySelectorAll('button')]
    .find((item) => /clear-button/i.test(item.innerText || item.getAttribute('aria-label') || ''));
  clearButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  integrationInput?.focus();
  integrationInput?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const integrationOptions = [...document.querySelectorAll('[role="option"]')]
    .map((item) => item.innerText.trim()).filter(Boolean);
  return {
    selectedClientId: integrationInput?.value || null,
    integrationOptions,
    selectedScope: (() => {
      const raw = localStorage.getItem('integrations_manager_scope');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return { present: true, length: raw.length }; }
    })(),
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
    integrations,
    subscriptions,
    samples,
  };
}`;
const evaluated = await cdp.send("Runtime.evaluate", {
  expression: `(${expression})()`,
  awaitPromise: true,
  returnByValue: true,
});
if (evaluated.exceptionDetails) {
  throw new Error(
    evaluated.exceptionDetails.text || "Falló la consulta del portal",
  );
}
console.log(JSON.stringify(redact(evaluated.result.value), null, 2));
cdp.close();

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/secret|password|token|authorization|cookie/i.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redact(child);
    }
  }
  return output;
}

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}
