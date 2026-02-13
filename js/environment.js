export const ENV_LOGGRO = "loggro";
export const ENV_SIIGO = "siigo";
export const ENV_STORAGE_KEY = "app_entorno_activo";

export const getActiveEnvironment = () => localStorage.getItem(ENV_STORAGE_KEY) || "";

export const setActiveEnvironment = (env) => {
  if (!env) {
    localStorage.removeItem(ENV_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ENV_STORAGE_KEY, env);
};
