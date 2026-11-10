import { demoOf, loadDemo } from './demoStorage.js';

let database;
let writes = Promise.resolve();

function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('food-mes', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('demos');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Закройте другие вкладки MES для обновления хранилища'));
    });
  return database;
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('demos', mode);
    const request = operation(transaction.objectStore('demos'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Сохранение прервано'));
  });
}

export async function readDemo(id) {
  await writes;
  const demo = demoOf(id);
  const saved = await transact('readonly', (table) => table.get(demo.id));
  if (!saved) {
    const imported = loadDemo(localStorage, demo.id);
    await writeDemo(imported);
    return imported;
  }
  // Reuse the complete legacy validation before loading either storage format.
  const restored = loadDemo({ getItem: () => JSON.stringify(saved) }, demo.id);
  if (JSON.stringify(restored) !== JSON.stringify(saved)) await writeDemo(restored);
  return restored;
}

export function writeDemo(state) {
  const snapshot = structuredClone(state);
  const operation = writes.then(() =>
    transact('readwrite', (table) => table.put(snapshot, demoOf(snapshot.scenarioId).id)),
  );
  writes = operation.catch(() => {});
  return operation;
}
