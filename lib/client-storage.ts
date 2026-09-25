const DB_NAME = "thaiban-ai-v1.2";
const DB_VERSION = 1;
const STORE_NAME = "state";
const HISTORY_KEY = "conversations";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb_unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("indexeddb_open_failed"));
    request.onblocked = () => reject(new Error("indexeddb_blocked"));
  });
}

async function readValue<T>(key: string) {
  const database = await openDatabase();

  try {
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () =>
        resolve((request.result as T | undefined) ?? null);
      request.onerror = () =>
        reject(request.error || new Error("indexeddb_read_failed"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("indexeddb_read_aborted"));
    });
  } finally {
    database.close();
  }
}

async function writeValue<T>(key: string, value: T) {
  const database = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(value, key);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error("indexeddb_write_failed"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("indexeddb_write_aborted"));
    });
  } finally {
    database.close();
  }
}

export function loadChatHistory<T>() {
  return readValue<T>(HISTORY_KEY);
}

export function saveChatHistory<T>(value: T) {
  return writeValue(HISTORY_KEY, value);
}
