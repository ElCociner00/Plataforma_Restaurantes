import { readFile } from "node:fs/promises";

// Requiere una instancia aislada de Chrome con depuración remota, por ejemplo:
// chrome.exe --headless=new --remote-debugging-port=9444 --user-data-dir=<perfil-temporal>

class Cdp {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
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

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  close() {
    this.socket.close();
  }
}

const debugBase = process.argv[2] || "http://127.0.0.1:9444";
const requestedSection = String(process.argv[3] || "").trim();
const env = parseEnv(
  await readFile(new URL("../.env", import.meta.url), "utf8"),
);
for (
  const key of [
    "RAPPI_INTEGRATIONS_MANAGER_USER",
    "RAPPI_INTEGRATIONS_MANAGER_PASSWORD",
  ]
) {
  if (!env[key]) throw new Error(`Falta ${key} en .env`);
}

const targets = await fetch(`${debugBase}/json/list`).then(checkJson);
const target = targets.find((item) => {
  try {
    return [
      "integrations-manager.rappi.com",
      "login-integrations-manager.rappi.com",
    ]
      .includes(new URL(item.url).hostname);
  } catch {
    return false;
  }
});
if (!target?.webSocketDebuggerUrl) {
  throw new Error("No hay una pestaña abierta del Integrations Manager");
}
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.ready;
await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);

let snapshot = await inspect(cdp);
if (
  snapshot.passwordInputs === 0 &&
  snapshot.links.some((item) => /^enter$/i.test(item))
) {
  await evaluate(
    cdp,
    `(() => {
    const link = [...document.querySelectorAll('a')].find((item) => /^enter$/i.test(item.innerText.trim()));
    if (!link) return false;
    link.click();
    return true;
  })()`,
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(300);
    try {
      snapshot = await inspect(cdp);
    } catch {
      continue;
    }
    if (
      snapshot.passwordInputs > 0 ||
      !snapshot.links.some((item) => /^enter$/i.test(item))
    ) break;
  }
}
if (snapshot.passwordInputs > 0) {
  const credentials = JSON.stringify({
    user: env.RAPPI_INTEGRATIONS_MANAGER_USER,
    password: env.RAPPI_INTEGRATIONS_MANAGER_PASSWORD,
  });
  const login = await evaluate(
    cdp,
    `(() => {
    const credentials = ${credentials};
    const inputs = [...document.querySelectorAll('input')];
    const password = inputs.find((item) => item.type === 'password');
    const user = inputs.find((item) => item.type === 'email')
      || inputs.find((item) => /email|correo|user/i.test([item.name, item.id, item.placeholder].join(' ')))
      || inputs.find((item) => ['text', ''].includes(item.type));
    if (!user || !password) return { submitted: false, reason: 'LOGIN_FIELDS_NOT_FOUND' };
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue(user, credentials.user);
    setValue(password, credentials.password);
    const form = password.closest('form') || user.closest('form');
    const button = form?.querySelector('button[type=submit], input[type=submit]')
      || [...document.querySelectorAll('button')].find((item) => /login|sign in|ingresar|entrar/i.test(item.innerText));
    if (form?.requestSubmit) form.requestSubmit(button || undefined);
    else button?.click();
    return { submitted: Boolean(form || button) };
  })()`,
  );
  if (!login.submitted) {
    throw new Error(
      `No fue posible enviar el login: ${login.reason || "sin formulario"}`,
    );
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(500);
    try {
      snapshot = await inspect(cdp);
    } catch {
      continue;
    }
    if (snapshot.passwordInputs === 0 && snapshot.text.length > 3) break;
  }
}

if (requestedSection && snapshot.passwordInputs === 0) {
  const section = JSON.stringify(requestedSection);
  const clicked = await evaluate(
    cdp,
    `(() => {
    const expected = ${section}.toLowerCase();
    const target = [...document.querySelectorAll('a,button,[role=button]')]
      .find((item) => item.innerText.trim().toLowerCase() === expected);
    if (!target) return false;
    target.click();
    return true;
  })()`,
  );
  if (!clicked) {
    throw new Error(`No se encontró la sección ${requestedSection}`);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(300);
    try {
      snapshot = await inspect(cdp);
    } catch {
      continue;
    }
    if (snapshot.url.toLowerCase().includes(requestedSection.toLowerCase())) {
      break;
    }
  }
  await delay(1000);
  snapshot = await inspect(cdp);
}

let integrationSelected = false;
const clientId = JSON.stringify(env.RAPPI_DEV_CLIENT_ID || "");
if (
  env.RAPPI_DEV_CLIENT_ID &&
  snapshot.controls.some((item) =>
    item.role === "combobox" ||
    /integration|integración/i.test(item.placeholder || "")
  )
) {
  await evaluate(
    cdp,
    `(() => {
    const input = document.querySelector('input[role="combobox"]')
      || [...document.querySelectorAll('input')].find((item) => /integration|integración/i.test(item.placeholder || ''));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    input.click();
    setter.call(input, ${clientId});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`,
  );
  await delay(800);
  integrationSelected = await evaluate(
    cdp,
    `(() => {
    const expected = ${clientId};
    const options = [...document.querySelectorAll('[role=option]')];
    const option = options.find((item) => item.innerText.includes(expected));
    if (!option) return false;
    option.click();
    return true;
  })()`,
  );
  if (integrationSelected) {
    await delay(1500);
    snapshot = await inspect(cdp);
  }
}

const authError =
  snapshot.text.find((line) =>
    /invalid|incorrect|error|inválid|credencial/i.test(line)
  ) || null;
console.log(JSON.stringify(
  {
    ok: snapshot.passwordInputs === 0 && !authError,
    authenticated: snapshot.passwordInputs === 0,
    integration_selected: integrationSelected,
    url: snapshot.url,
    title: snapshot.title,
    headings: snapshot.headings,
    buttons: snapshot.buttons,
    links: snapshot.links,
    controls: snapshot.controls,
    resources: snapshot.resources,
    visible_text: snapshot.text,
    auth_error: authError,
  },
  null,
  2,
));
await cdp.send("Runtime.evaluate", { expression: "void 0" });
cdp.close();

async function inspect(client) {
  return await evaluate(
    client,
    `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const unique = (values, limit = 80) => [...new Set(values.map(clean).filter(Boolean))].slice(0, limit);
    return {
      url: location.href,
      title: document.title,
      passwordInputs: document.querySelectorAll('input[type=password]').length,
      headings: unique([...document.querySelectorAll('h1,h2,h3,[role=heading]')].map((item) => item.innerText), 30),
      buttons: unique([...document.querySelectorAll('button,[role=button],input[type=submit]')].map((item) => item.innerText || item.value || item.getAttribute('aria-label')), 50),
      links: unique([...document.querySelectorAll('a')].map((item) => item.innerText || item.getAttribute('aria-label')), 50),
      controls: [...document.querySelectorAll('input:not([type=password]),select,[role=combobox]')].slice(0, 40).map((item) => ({
        tag: item.tagName.toLowerCase(),
        type: item.getAttribute('type') || null,
        name: item.getAttribute('name') || null,
        placeholder: item.getAttribute('placeholder') || null,
        ariaLabel: item.getAttribute('aria-label') || null,
        role: item.getAttribute('role') || null,
        text: item.tagName === 'SELECT' ? clean(item.innerText) : null,
        hasValue: Boolean(item.value),
      })),
      resources: unique(performance.getEntriesByType('resource').map((entry) => {
        try { const url = new URL(entry.name); return url.origin + url.pathname; } catch { return ''; }
      }), 80),
      text: unique(document.body.innerText.split(/\\r?\\n/), 100),
    };
  })()`,
  );
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Chrome evaluation failed");
  }
  return result.result.value;
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

async function checkJson(response) {
  if (!response.ok) {
    throw new Error(`Chrome endpoint returned ${response.status}`);
  }
  return await response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
