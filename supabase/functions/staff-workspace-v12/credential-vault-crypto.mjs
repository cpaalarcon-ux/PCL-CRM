const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const base64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = encoded => Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
const purpose = (client, type, version) => encoder.encode(JSON.stringify(['pcl-client-vault', client, type, version]));
export const validVaultKeyVersion = version => typeof version === 'string' && /^[A-Z0-9_]{1,20}$/.test(version);

async function vaultKey(secret) {
 if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/i.test(secret)) throw Error('Vault key unavailable');
 const material = Uint8Array.from(secret.match(/../g), pair => parseInt(pair, 16));
 try {
  return await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
 } finally {
  material.fill(0);
 }
}

export async function sealClientPassword(secret, client, type, version, password) {
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const encoded = encoder.encode(password);
 try {
  const result = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: purpose(client, type, version)}, await vaultKey(secret), encoded);
  return {nonce: base64(iv), ciphertext: base64(new Uint8Array(result))};
 } finally {
  encoded.fill(0);
 }
}

export async function openClientPassword(secret, client, type, version, entry) {
 const result = new Uint8Array(await crypto.subtle.decrypt({
  name: 'AES-GCM', iv: bytes(entry.nonce), additionalData: purpose(client, type, version),
 }, await vaultKey(secret), bytes(entry.ciphertext)));
 try {
  return decoder.decode(result);
 } finally {
  result.fill(0);
 }
}
