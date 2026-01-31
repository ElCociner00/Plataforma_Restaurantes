import { supabase } from "./supabase.js";

const { data } = await supabase.auth.getSession();

if (!data.session) {
  window.location.href = "../";
}
