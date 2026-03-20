const MOBILE_SHELL_STYLE_ID = "mobile-native-shell-css";
const MOBILE_SHELL_CSS_PATH = "/Plataforma_Restaurantes/css/mobile_native.css";
const MOBILE_QUERY = "(max-width: 900px), (pointer: coarse)";

const getViewportMeta = () => document.querySelector('meta[name="viewport"]');

const ensureViewportMeta = () => {
  const desired = "width=device-width, initial-scale=1.0, viewport-fit=cover";
  const existing = getViewportMeta();
  if (!existing) {
    const meta = document.createElement("meta");
    meta.name = "viewport";
    meta.content = desired;
    document.head.appendChild(meta);
    return;
  }

  if (!String(existing.content || "").includes("viewport-fit=cover")) {
    existing.content = desired;
  }
};

const ensureMobileCss = () => {
  if (document.getElementById(MOBILE_SHELL_STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = MOBILE_SHELL_STYLE_ID;
  link.rel = "stylesheet";
  link.href = MOBILE_SHELL_CSS_PATH;
  document.head.appendChild(link);
};

const getHeaderLabels = (table) => {
  const headerCells = Array.from(table.querySelectorAll("thead th"));
  if (headerCells.length) return headerCells.map((cell) => cell.textContent.trim());

  const firstRow = table.querySelector("tr");
  if (!firstRow) return [];
  return Array.from(firstRow.children).map((cell) => cell.textContent.trim());
};

const enhanceTableForMobile = (table) => {
  if (!(table instanceof HTMLTableElement)) return;
  if (table.dataset.mobileEnhanced === "true") return;
  if (table.closest(".impago-modal") || table.closest(".excel-export-block")) return;

  const labels = getHeaderLabels(table).filter(Boolean);
  if (labels.length < 2) return;

  table.dataset.mobileEnhanced = "true";
  table.dataset.mobileStack = "true";

  const rows = Array.from(table.querySelectorAll("tbody tr"));
  rows.forEach((row) => {
    Array.from(row.children).forEach((cell, index) => {
      const label = labels[index] || `Campo ${index + 1}`;
      cell.setAttribute("data-mobile-label", label);
    });
  });
};

const enhanceTables = (root = document) => {
  root.querySelectorAll?.("table").forEach((table) => enhanceTableForMobile(table));
};

const isMobileLikeDevice = () => window.matchMedia(MOBILE_QUERY).matches;

const syncMobileMode = () => {
  ensureViewportMeta();
  if (!isMobileLikeDevice()) {
    document.documentElement.classList.remove("mobile-native");
    document.body?.classList.remove("mobile-native");
    return;
  }

  ensureMobileCss();
  document.documentElement.classList.add("mobile-native");
  document.body?.classList.add("mobile-native");
  enhanceTables(document);
};

let observerStarted = false;

export function initMobileNativeShell() {
  syncMobileMode();

  if (!observerStarted && typeof MutationObserver === "function") {
    observerStarted = true;
    const observer = new MutationObserver((mutations) => {
      if (!document.body?.classList.contains("mobile-native")) return;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.("table")) enhanceTableForMobile(node);
          enhanceTables(node);
        });
      }
    });

    const start = () => {
      if (!document.body) return;
      observer.observe(document.body, { childList: true, subtree: true });
      enhanceTables(document);
    };

    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }

  window.matchMedia(MOBILE_QUERY).addEventListener?.("change", syncMobileMode);
  window.addEventListener("resize", syncMobileMode);

  if (!document.body) {
    document.addEventListener("DOMContentLoaded", syncMobileMode, { once: true });
  }
}

initMobileNativeShell();
