import { supabase } from "./supabase.js";

async function loadHeader() {
  const res = await fetch("../header.html");
  const html = await res.text();

  document.body.insertAdjacentHTML("afterbegin", html);

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "../";
  });
}

loadHeader();
