/**
 * terminos.js — pinta la versión vigente de los términos desde la base.
 *
 * El texto vive en `terminos_versiones`, no en el HTML, por dos motivos:
 *
 *   1. Es el mismo texto que el cliente acepta al registrarse, y en
 *      `aceptaciones_terminos` queda registrado QUÉ VERSIÓN aceptó. Si el
 *      HTML y la base pudieran divergir, esa constancia no valdría nada.
 *   2. Cambiar los términos deja de ser un despliegue: es una fila nueva.
 *
 * La tabla tiene política de lectura para `anon`, así que esta página funciona
 * sin sesión iniciada.
 */
import { supabase } from "./supabase.js";

const contenedor = document.getElementById("terminosContenido");
const metaEl = document.getElementById("terminosMeta");

const fmtFecha = (v) => {
  if (!v) return "";
  const [a, m, d] = String(v).split("-").map(Number);
  if (!a || !m || !d) return "";
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", {
    day: "2-digit", month: "long", year: "numeric",
  });
};

async function cargar() {
  if (!contenedor) return;

  const { data, error } = await supabase
    .from("terminos_versiones")
    .select("version, titulo, contenido_html, publicado_en")
    .eq("vigente", true)
    .maybeSingle();

  if (error || !data) {
    console.error("[terminos] No se pudo cargar la versión vigente:", error);
    // El texto de respaldo no intenta reproducir los términos: sería peor
    // mostrar una versión distinta de la que el cliente aceptó.
    contenedor.innerHTML = `
      <p>No pudimos cargar los términos en este momento.</p>
      <p>Escríbenos a <a href="mailto:facturacion@enkrato.com">facturacion@enkrato.com</a>
         y te los enviamos.</p>`;
    return;
  }

  const titulo = document.querySelector(".legal h1");
  if (titulo && data.titulo) titulo.textContent = data.titulo;

  if (metaEl) {
    metaEl.textContent =
      `Versión ${data.version} · vigente desde el ${fmtFecha(data.publicado_en)}`;
  }

  // El contenido lo escribimos nosotros en una migración, no un usuario.
  contenedor.innerHTML = data.contenido_html;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", cargar);
} else {
  cargar();
}
