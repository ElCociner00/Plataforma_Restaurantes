/**
 * Utilidades de cifrado para Edge Functions.
 * Usa Web Crypto API nativo de Deno.
 */

// Deriva una llave AES-GCM de 256 bits a partir de cualquier string
async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encripta texto plano y devuelve el formato `enc:base64(iv + ciphertext)`
 */
export async function encryptText(text: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(text)
  );
  
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  
  return "enc:" + bufferToBase64(combined.buffer);
}

/**
 * Desencripta texto si tiene el prefijo `enc:`, de lo contrario asume que es texto plano.
 * Esto asegura retrocompatibilidad con credenciales legacy de la base de datos de producción.
 */
export async function decryptText(encryptedText: string, secret: string): Promise<string> {
  if (!encryptedText || !encryptedText.startsWith("enc:")) {
    // Es una contraseña en texto plano del sistema antiguo
    return encryptedText;
  }
  
  const rawBase64 = encryptedText.substring(4); // Remover "enc:"
  const combined = base64ToBuffer(rawBase64);
  
  const iv = combined.slice(0, 12);
  const cipherBytes = combined.slice(12);
  
  const key = await getKey(secret);
  
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes
    );
    
    const dec = new TextDecoder();
    return dec.decode(plainBuffer);
  } catch (error) {
    console.error("Error al desencriptar. Posible llave incorrecta o data corrupta.");
    throw error;
  }
}
