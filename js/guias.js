import { APP_URLS } from "./urls.js";

const TEMAS = [
  { grupo: "Operación", id: "cierre-turno", titulo: "Cierre de turno" },
  { grupo: "Operación", id: "inventarios", titulo: "Inventarios" },
  { grupo: "Operación", id: "compras", titulo: "Compras" },
  { grupo: "Administración", id: "nomina", titulo: "Nómina" },
  { grupo: "Administración", id: "facturacion", titulo: "Facturación" },
  { grupo: "Rappi", id: "rappi-operacion", titulo: "Pedidos de Rappi" },
  { grupo: "Rappi", id: "rappi-menu", titulo: "Menú de Rappi" },
  { grupo: "Rappi", id: "rappi-integracion", titulo: "Integración Rappi" },
  { grupo: "Configuración", id: "configuracion-usuarios", titulo: "Configuración y usuarios" },
];

const nav = document.querySelector("#guias-nav");
const content = document.querySelector("#guias-content");
const wanted = new URLSearchParams(location.search).get("tema");
const current = TEMAS.some((tema) => tema.id === wanted) ? wanted : "cierre-turno";
let group = "";
for (const tema of TEMAS) {
  if (tema.grupo !== group) {
    group = tema.grupo;
    const heading = document.createElement("p");
    heading.className = "guias-nav-group";
    heading.textContent = group;
    nav.append(heading);
  }
  const link = document.createElement("a");
  link.href = `${APP_URLS.guias}?tema=${encodeURIComponent(tema.id)}`;
  link.textContent = tema.titulo;
  if (tema.id === current) link.setAttribute("aria-current", "page");
  nav.append(link);
}

try {
  const response = await fetch(`${APP_URLS.guias}contenido/${current}.txt`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  content.innerHTML = renderMarkdown(await response.text());
  document.title = `${TEMAS.find((tema) => tema.id === current).titulo} | Guías de Enkrato`;
} catch (error) {
  console.error("[guias]", error);
  content.innerHTML = '<p class="guias-error">No pudimos cargar esta guía. Actualiza la página para intentarlo de nuevo.</p>';
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function inline(value) {
  let html = escapeHtml(value);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/!\[([^\]]*)\]\((\.\/imagenes\/[a-zA-Z0-9_.-]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  return html;
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let list = "";
  let paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${inline(paragraph.join(" "))}</p>`); paragraph = []; } };
  const closeList = () => { if (list) { output.push(`</${list}>`); list = ""; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("<!--")) { flushParagraph(); closeList(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); closeList(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    const notice = /^>\s+(.+)$/.exec(line);
    if (notice) { flushParagraph(); closeList(); output.push(`<p class="guias-aviso">${inline(notice[1])}</p>`); continue; }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const target = bullet ? "ul" : "ol";
      if (list !== target) { closeList(); list = target; output.push(`<${list}>`); }
      output.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph(); closeList();
  return output.join("\n");
}
