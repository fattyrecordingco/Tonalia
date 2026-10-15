import type { Project } from '../types';
export interface Recovery {
  id?: number;
  time: number;
  project: Project;
}
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tonalia-local-recovery', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function versions(): Promise<Recovery[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('versions').objectStore('versions').getAll();
      request.onsuccess = () => resolve((request.result as Recovery[]).reverse());
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function checkpoint(project: Project): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('versions', 'readwrite');
      const store = transaction.objectStore('versions');
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = request.result as Recovery[];
        const previous = entries[entries.length - 1]?.project;
        if (
          previous?.source.sha256 === project.source.sha256 &&
          JSON.stringify(previous.layers) === JSON.stringify(project.layers)
        )
          return;
        store.add({ time: Date.now(), project });
        for (const entry of entries.slice(0, Math.max(0, entries.length - 19)))
          store.delete(entry.id!);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
