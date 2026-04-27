// server/common/utils/db.js

import mongoose from "mongoose";

/* ============================================================
   TRANSACTION HELPER
   ============================================================
   Обёртка над mongoose session.withTransaction() с
   автоматическими ретраями при transient errors
   (write conflicts, network glitches).

   Использование:

   const result = await withTransaction(async (session) => {
     await Annotation.findByIdAndUpdate(id, { isCurrent: false }, { session });
     const v2 = await Annotation.create([data], { session });
     return v2[0]; // create() с массивом возвращает массив
   });

   ВАЖНО: каждая mongoose-операция внутри callback ДОЛЖНА
   принимать { session } в опциях. Иначе она выполнится
   ВНЕ транзакции — это самый частый баг при работе с
   транзакциями.

   Внешние вызовы (S3, email, AI) НЕ должны быть внутри
   транзакции — они блокируют её до 60 секунд.
   ============================================================ */

const DEFAULT_TRANSACTION_OPTIONS = {
  // Read concern — что считать "прочитанным"
  // 'snapshot' даёт согласованное чтение всех документов на момент старта
  readConcern: { level: "snapshot" },

  // Write concern — когда считать запись успешной
  // 'majority' — когда большинство нод replica set подтвердили
  writeConcern: { w: "majority" },

  // Read preference — с какой ноды читать
  readPreference: "primary",
};

/**
 * Выполняет callback внутри транзакции с автоматическими ретраями.
 *
 * @param {Function} callback — async (session) => result
 * @param {Object}   options  — опциональные настройки транзакции
 * @returns значение, которое вернул callback
 */
export const withTransaction = async (callback, options = {}) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(
      async () => {
        result = await callback(session);
      },
      { ...DEFAULT_TRANSACTION_OPTIONS, ...options },
    );
  } finally {
    await session.endSession();
  }

  return result;
};

/* ============================================================
   SESSION CHECK
   ============================================================
   Проверка: операция выполняется внутри активной транзакции?
   Используется в сервисах для assert "требуется транзакция". */

export const isInTransaction = (session) => {
  return session != null && session.inTransaction();
};

/* ============================================================
   CONNECTION READINESS
   ============================================================
   Mongoose readyState:
   0 = disconnected
   1 = connected
   2 = connecting
   3 = disconnecting */

export const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

/**
 * Ожидает готовности подключения. Используется при старте
 * сервера, когда хотим убедиться что Mongo доступна перед
 * стартом cron/scheduler.
 */
export const waitForMongoReady = (timeoutMs = 30000) => {
  if (isMongoConnected()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mongoose.connection.off("connected", onConnected);
      reject(new Error(`MongoDB connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onConnected = () => {
      clearTimeout(timer);
      resolve();
    };

    mongoose.connection.once("connected", onConnected);
  });
};
