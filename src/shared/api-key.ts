const DATABASE = 'subline';
const STORE = 'keys';
const DEVICE_KEY = 'api-key';

interface EncryptedApiKey {
  iv: string;
  data: string;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deviceKey(): Promise<CryptoKey> {
  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const open = indexedDB.open(DATABASE, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const database = await settle(open);
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const saved: unknown = await settle(store.get(DEVICE_KEY));
    if (saved instanceof CryptoKey) return saved;
    store.add(created, DEVICE_KEY);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    return created;
  } finally {
    database.close();
  }
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export async function encryptApiKey(apiKey: string): Promise<EncryptedApiKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deviceKey(),
    new TextEncoder().encode(apiKey),
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

export async function decryptApiKey(stored: unknown): Promise<string> {
  const { iv, data } = (stored ?? {}) as Partial<EncryptedApiKey>;
  if (typeof iv !== 'string' || typeof data !== 'string') return '';
  const key = await deviceKey();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) },
      key,
      fromBase64(data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}
