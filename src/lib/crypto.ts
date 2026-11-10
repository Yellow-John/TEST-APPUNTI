"use client";
// Note bloccate: il contenuto è cifrato nel browser con AES-GCM e una chiave derivata dal PIN (PBKDF2).
// Il server vede solo testo cifrato; senza PIN il contenuto non è recuperabile.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(pin: string, salt: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(salt), iterations: 310_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptText(key: CryptoKey, payload: string): Promise<string> {
  const [iv, ct] = payload.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return dec.decode(pt);
}

const CHECK = "appunti-pin-ok";
export async function makePinCheck(key: CryptoKey) {
  return encryptText(key, CHECK);
}
export async function verifyPin(key: CryptoKey, check: string) {
  try {
    return (await decryptText(key, check)) === CHECK;
  } catch {
    return false;
  }
}
