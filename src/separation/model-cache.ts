const DB_NAME = "chord-finder-models";
const STORE_NAME = "weights";
const DB_VERSION = 1;

interface CachedModel {
  key: string;
  bytes: ArrayBuffer;
  byteLength: number;
  sha256: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the model cache."));
  });
}

export async function readCachedModel(key: string): Promise<CachedModel | null> {
  if (!("indexedDB" in window)) return null;
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as CachedModel | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the model cache."));
    });
  } finally {
    database.close();
  }
}

export async function writeCachedModel(model: CachedModel): Promise<void> {
  if (!("indexedDB" in window)) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(model);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not save the model cache."));
    });
  } finally {
    database.close();
  }
}

export async function deleteCachedModel(key: string): Promise<void> {
  if (!("indexedDB" in window)) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not remove the cached model."));
    });
  } finally {
    database.close();
  }
}
