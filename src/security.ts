const enc = new TextEncoder();
const dec = new TextDecoder();

// TypeScript 5.9+ models Uint8Array buffers as ArrayBufferLike. Web Crypto's
// BufferSource definitions require an ArrayBuffer-backed view, so copy bytes
// into a fresh ArrayBuffer before passing them to subtle crypto APIs.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid encoded value");
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i++) output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return output;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomHex(size = 16): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function randomToken(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: toArrayBuffer(fromHex(saltHex)), iterations: 100_000, hash: "SHA-256" },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) {
    throw new Error("KEY_ENCRYPTION_SECRET must be at least 32 characters. Set it as a Worker secret before saving API keys.");
  }
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("the-app-sucks:key-v1"),
      info: enc.encode("user-provider-api-key-encryption")
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(secret: string, value: string): Promise<{ cipher: string; iv: string }> {
  const key = await encryptionKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value));
  return { cipher: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptText(secret: string, cipher: string, iv: string): Promise<string> {
  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64(iv)) },
    key,
    toArrayBuffer(fromBase64(cipher))
  );
  return dec.decode(plaintext);
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string, maxAge: number): string {
  return `tas_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export const clearSessionCookie = "tas_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
