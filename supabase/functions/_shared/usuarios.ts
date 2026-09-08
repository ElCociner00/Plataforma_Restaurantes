/**
 * Alta de cuentas en auth.users.
 *
 * En n8n esto era un nodo HTTP Request contra /auth/v1/admin/users con la
 * service_role key ESCRITA EN CLARO dentro del JSON del flujo, repetida en
 * cuatro flujos distintos. Aquí la clave sale del entorno y nunca se registra.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ErrorFuncion, errores } from "./errores.ts";

export type CuentaNueva = {
  correo: string;
  password: string;
  nombre?: string;
  metadatos?: Record<string, unknown>;
};

/** Crea la cuenta y devuelve su id. Deja el correo ya confirmado, como n8n. */
export async function crearCuentaAuth(
  admin: SupabaseClient,
  cuenta: CuentaNueva,
): Promise<{ id: string; correo: string }> {
  const correo = cuenta.correo.trim().toLowerCase();

  if (!correo || !correo.includes("@")) {
    throw errores.datosIncompletos("correo electrónico válido");
  }
  if (!cuenta.password || cuenta.password.length < 6) {
    throw new ErrorFuncion(
      "PASSWORD_DEBIL",
      "La contraseña debe tener al menos 6 caracteres.",
      400,
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: correo,
    password: cuenta.password,
    email_confirm: true,
    user_metadata: {
      ...(cuenta.nombre ? { nombre_completo: cuenta.nombre } : {}),
      ...(cuenta.metadatos ?? {}),
    },
  });

  if (error || !data?.user) {
    const mensaje = String(error?.message ?? "");
    if (/already|registered|exists/i.test(mensaje)) {
      throw new ErrorFuncion(
        "CORREO_YA_REGISTRADO",
        "Ese correo ya tiene una cuenta en la plataforma.",
        409,
      );
    }
    console.error("[usuarios] No se pudo crear la cuenta:", mensaje);
    throw new ErrorFuncion("ALTA_FALLIDA", "No se pudo crear la cuenta de acceso.", 500);
  }

  return { id: data.user.id, correo };
}

/**
 * Deshace el alta si un paso posterior falla.
 *
 * n8n no tenía esto: si el INSERT en usuarios_sistema fallaba después de crear
 * la cuenta, quedaba un usuario en auth.users sin empresa, capaz de iniciar
 * sesión y quedarse en una pantalla rota. Se borra en silencio porque el error
 * que interesa al usuario es el original, no este.
 */
export async function deshacerCuentaAuth(admin: SupabaseClient, id: string): Promise<void> {
  try {
    await admin.auth.admin.deleteUser(id);
    console.info(`[usuarios] Alta revertida para ${id}`);
  } catch (error) {
    console.error(`[usuarios] No se pudo revertir el alta de ${id}:`, error);
  }
}

/** Comprueba que la empresa existe y está activa antes de colgarle usuarios. */
export async function exigirEmpresaActiva(
  admin: SupabaseClient,
  empresaId: string,
): Promise<{ id: string; nombre_comercial: string; correo_empresa: string }> {
  const { data, error } = await admin
    .from("empresas")
    .select("id, nombre_comercial, correo_empresa, activa, activo")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) throw errores.baseDeDatos(error.message);
  if (!data) throw new ErrorFuncion("EMPRESA_NO_EXISTE", "La empresa indicada no existe.", 404);

  if (data.activa === false || data.activo === false) {
    throw new ErrorFuncion("EMPRESA_INACTIVA", "La empresa está desactivada.", 403);
  }

  return {
    id: String(data.id),
    nombre_comercial: String(data.nombre_comercial ?? ""),
    correo_empresa: String(data.correo_empresa ?? ""),
  };
}

/** Evita dos usuarios con la misma cédula dentro de la misma empresa. */
export async function exigirCedulaLibre(
  admin: SupabaseClient,
  tabla: "empleados" | "otros_usuarios",
  empresaId: string,
  cedula: string,
): Promise<void> {
  if (!cedula) return;

  const { data, error } = await admin
    .from(tabla)
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("cedula", cedula)
    .maybeSingle();

  if (error) throw errores.baseDeDatos(error.message);
  if (data) {
    throw new ErrorFuncion(
      "CEDULA_DUPLICADA",
      "Ya existe una persona registrada con esa cédula en la empresa.",
      409,
    );
  }
}
