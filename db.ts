
import { Session, SessionSummary } from './types';

const DB_NAME = 'RunAlyzerDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

export const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (event: any) => resolve(event.target.result);
        request.onerror = (event: any) => reject(event.target.error);
    });
};

export const saveSessionToDB = async (session: Session) => {
    try {
        const db = await openDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(session);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            request.onerror = () => reject(request.error);
        });
    } catch (e) { console.error("DB Save Error", e); }
};

export const deleteSessionFromDB = async (id: string) => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const clearDB = async () => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// Optimización: Solo devuelve metadatos, excluyendo el array gigante de trackPoints
export const getAllSessionSummaries = async (): Promise<SessionSummary[]> => {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const summaries: SessionSummary[] = [];
            
            // Usamos un cursor para iterar y extraer solo lo necesario
            const request = store.openCursor();
            
            request.onsuccess = (event: any) => {
                const cursor = event.target.result;
                if (cursor) {
                    // Desestructuramos para separar trackPoints del resto
                    const { trackPoints, ...summary } = cursor.value;
                    summaries.push(summary);
                    cursor.continue();
                } else {
                    resolve(summaries);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return [];
    }
};

// Carga completa bajo demanda
export const getFullSessionFromDB = async (id: string): Promise<Session | undefined> => {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return undefined;
    }
};

// Mantenemos compatibilidad por si acaso, pero no se recomienda su uso masivo
export const getAllSessionsFromDB = async (): Promise<Session[]> => {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return [];
    }
};
