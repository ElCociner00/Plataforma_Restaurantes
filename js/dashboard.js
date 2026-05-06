import { getUserContext } from "./session.js";
import { WEBHOOK_DASHBOARD_DATOS } from "./webhooks.js";

const DASHBOARD_FETCH_TIMEOUT_MS = 7000;

const fetchDashboardSignal = async () => {
  const context = await getUserContext();
  if (!context) return;
  if (String(context.rol || "").toLowerCase() !== "admin") return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DASHBOARD_FETCH_TIMEOUT_MS);

  try {
    await fetch(WEBHOOK_DASHBOARD_DATOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa_id: context.empresa_id || "" }),
      signal: controller.signal
    });
  } catch (_error) {
    // Falla silenciosa: dashboard debe seguir funcional aunque no lleguen métricas.
  } finally {
    clearTimeout(timeout);
  }
};

fetchDashboardSignal();
