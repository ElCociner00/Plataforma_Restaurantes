import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fija el bloqueo que dejo sin poder cerrar turno a toda empresa con locales.
//
// Las tablas `_locales` tenian el SELECT con app_puede_ver_empresa() y el
// INSERT/UPDATE con la expresion vieja basada en get_empresas_del_grupo(), que
// solo resuelve la rama "soy un local": para un usuario de la empresa MADRE
// devuelve unicamente la madre, nunca sus locales. Resultado: se podia leer la
// sede local pero no escribir en ella, y cerrar turno reventaba con
// 42501 new row violates row-level security policy.
//
// Esto comprueba que la ULTIMA definicion de cada politica de escritura sobre
// esas tablas siga usando la misma regla que la de lectura. Si alguien vuelve a
// introducir get_empresas_del_grupo() ahi, falla aqui y no en produccion.

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirMigraciones = path.join(raiz, "supabase/migrations");

const TABLAS = ["cierres_turno_final_locales", "apoyos_turno_locales"];
const ESCRITURA = ["insert", "update"];

const fallos = [];
const assert = (cond, msg) => { if (!cond) fallos.push(msg); };

const archivos = (await readdir(dirMigraciones))
  .filter((f) => f.endsWith(".sql"))
  .sort(); // el nombre empieza por la marca de tiempo: orden cronologico

// La ultima definicion gana, igual que al aplicarlas en orden sobre la base.
const ultimaDefinicion = new Map();

for (const archivo of archivos) {
  const sql = await readFile(path.join(dirMigraciones, archivo), "utf8");
  // Se ignoran las lineas comentadas: el propio arreglo cita la expresion vieja
  // dentro de su explicacion, y eso no es una politica.
  const sinComentarios = sql
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("--"))
    .join("\n");

  const bloques = sinComentarios.split(/create\s+policy/i).slice(1);
  for (const bloque of bloques) {
    const cuerpo = bloque.split(/;/)[0] ?? "";
    const tabla = TABLAS.find((t) => new RegExp(`\\bon\\s+(public\\.)?${t}\\b`, "i").test(cuerpo));
    if (!tabla) continue;
    const comando = ESCRITURA.find((c) => new RegExp(`\\bfor\\s+${c}\\b`, "i").test(cuerpo));
    if (!comando) continue;
    ultimaDefinicion.set(`${tabla}:${comando}`, { archivo, cuerpo });
  }
}

for (const tabla of TABLAS) {
  for (const comando of ESCRITURA) {
    const clave = `${tabla}:${comando}`;
    const definicion = ultimaDefinicion.get(clave);

    assert(
      definicion,
      `No hay ninguna migracion que defina la politica de ${comando.toUpperCase()} de ${tabla}: `
      + "sin ella la base queda con la que traiga el dump, que es justo la rota.",
    );
    if (!definicion) continue;

    assert(
      /app_puede_ver_empresa\s*\(\s*empresa_id\s*\)/i.test(definicion.cuerpo),
      `La politica de ${comando.toUpperCase()} de ${tabla} (${definicion.archivo}) ya no usa `
      + "app_puede_ver_empresa(empresa_id): debe ser la MISMA regla que la de lectura, "
      + "o se vuelve a poder leer la sede local sin poder cerrar turno en ella.",
    );

    assert(
      !/get_empresas_del_grupo|get_my_empresa_id/i.test(definicion.cuerpo),
      `La politica de ${comando.toUpperCase()} de ${tabla} (${definicion.archivo}) volvio a la `
      + "expresion vieja (get_empresas_del_grupo / get_my_empresa_id). Esa rama no resuelve el "
      + "caso 'soy la empresa madre': deja a los locales sin poder guardar el cierre.",
    );
  }
}

if (fallos.length) {
  console.error(fallos.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

console.log(
  `RLS de locales OK: ${TABLAS.length * ESCRITURA.length} politicas de escritura usan la misma regla que la lectura.`,
);
