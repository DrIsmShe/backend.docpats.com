// server/modules/anthropometry/utils/storage/index.js

import s3Storage from "./s3Storage.js";
import localStorage from "./localStorage.js";

export * as keys from "./storageKeys.js";

/* ============================================================
   STORAGE FACTORY
   ============================================================
   Выбор реализации через STORAGE_DRIVER env:
     STORAGE_DRIVER=s3    → s3Storage (R2/AWS S3)
     STORAGE_DRIVER=local → localStorage (диск)

   Default: 's3' для безопасности.
   В случае опечатки в env лучше упасть на старте,
   чем молча сохранить PHI на локальный диск VPS. */

const DRIVER = process.env.STORAGE_DRIVER || "s3";

const driverMap = {
  s3: s3Storage,
  local: localStorage,
};

const storage = driverMap[DRIVER];

if (!storage) {
  throw new Error(
    `Unknown STORAGE_DRIVER: "${DRIVER}". ` +
      `Allowed: ${Object.keys(driverMap).join(", ")}`,
  );
}

console.log(`[storage] Using driver: ${DRIVER}`);

/* ============================================================
   PUBLIC API
   ============================================================ */

export default storage;

// Именованный экспорт для тестов и мониторинга
export const { driver, healthCheck } = storage;
