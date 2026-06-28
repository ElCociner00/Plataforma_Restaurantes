const MONEY_INPUT_IDS = [
  "efectivo_sistema",
  "efectivo_real",
  "efectivo_diferencia",
  "datafono_sistema",
  "datafono_real",
  "datafono_diferencia",
  "rappi_sistema",
  "rappi_real",
  "rappi_diferencia",
  "nequi_sistema",
  "nequi_real",
  "nequi_diferencia",
  "transferencias_sistema",
  "transferencias_real",
  "transferencias_diferencia",
  "bono_regalo_sistema",
  "bono_regalo_real",
  "bono_regalo_diferencia",
  "propina",
  "domicilios"
];

const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function parseMoneyValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") return null;

  const sign = cleaned.trim().startsWith("-") ? "-" : "";
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
  } else {
    normalized = unsigned;
  }

  const amount = Number(`${sign}${normalized}`);
  return Number.isFinite(amount) ? amount : null;
}

function formatMoneyValue(value) {
  const amount = parseMoneyValue(value);
  return amount === null ? "" : currencyFormatter.format(amount).replace(/\s+/g, " ");
}

function ensureVisualWrapper(input) {
  if (!input || input.dataset.cierreMoneyVisual === "1") return null;

  const wrapper = document.createElement("span");
  wrapper.className = "cierre-money-visual-wrap";
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const visual = document.createElement("span");
  visual.className = "cierre-money-visual-value";
  visual.setAttribute("aria-hidden", "true");
  wrapper.appendChild(visual);

  input.dataset.cierreMoneyVisual = "1";
  return visual;
}

function initMoneyVisuals() {
  const pairs = MONEY_INPUT_IDS
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((input) => ({ input, visual: ensureVisualWrapper(input) || input.nextElementSibling }))
    .filter(({ visual }) => visual?.classList?.contains("cierre-money-visual-value"));

  const sync = () => {
    pairs.forEach(({ input, visual }) => {
      visual.textContent = formatMoneyValue(input.value);
    });
  };

  pairs.forEach(({ input }) => {
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    input.addEventListener("blur", sync);
  });

  sync();
  window.setInterval(sync, 300);
}

document.addEventListener("DOMContentLoaded", initMoneyVisuals);
