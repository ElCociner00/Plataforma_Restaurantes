export const NOMINA_DEBUG = true;

export const nominaLog = (step, detail = null) => {
  if (!NOMINA_DEBUG) return;
  const stamp = new Date().toISOString();
  if (detail === null || detail === undefined) {
    console.log(`[NominaDebug][${stamp}] ${step}`);
    return;
  }
  console.log(`[NominaDebug][${stamp}] ${step}:`, detail);
};

export const nominaWarn = (step, detail = null) => {
  if (!NOMINA_DEBUG) return;
  const stamp = new Date().toISOString();
  console.warn(`[NominaDebug][${stamp}] ${step}`, detail ?? "");
};
