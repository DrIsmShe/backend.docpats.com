// common/utils/socketRateLimit.js
//
// Переиспользуемый rate-limiter для Socket.IO событий.
// Хранит состояние в памяти (Map) с автоочисткой каждые 5 минут.
// При превышении лимита эмитит "error:ratelimit" клиенту с реткой "type"
// и временем блокировки.
//
// Использование:
//   const messageLimiter = createSocketRateLimiter("message:send", { max: 30, windowMs: 60_000 });
//   socket.on("message:send", async (payload) => {
//     if (!messageLimiter.check(socket, userId)) return; // лимит исчерпан → emit и выход
//     // ... обработка ...
//   });

const stores = new Map(); // eventType → Map<userId, state>

// Прогрессивные блокировки: первое нарушение 60с, потом 5мин, 15мин, час
const PENALTIES_SEC = [60, 300, 900, 3600];

/**
 * Создаёт лимитер для конкретного типа события.
 * @param {string} eventType — например "message:send"
 * @param {object} opts
 * @param {number} opts.max — максимум вызовов в окне (default: 30)
 * @param {number} opts.windowMs — длина окна в мс (default: 60_000)
 */
export function createSocketRateLimiter(eventType, opts = {}) {
  const max = opts.max ?? 30;
  const windowMs = opts.windowMs ?? 60_000;

  if (!stores.has(eventType)) {
    stores.set(eventType, new Map());
  }
  const store = stores.get(eventType);

  /**
   * Проверяет лимит для данного userId.
   * @returns {boolean} true — можно продолжить, false — лимит превышен (уже эмитнули ошибку)
   */
  function check(socket, userId) {
    const id = String(userId || socket.id);
    const now = Date.now();

    if (!store.has(id)) {
      store.set(id, { timestamps: [], blockedUntil: 0, violations: 0 });
    }
    const state = store.get(id);

    // Уже заблокирован?
    if (now < state.blockedUntil) {
      const secsLeft = Math.ceil((state.blockedUntil - now) / 1000);
      socket.emit("error:ratelimit", {
        type: eventType,
        secsLeft,
        message: `Слишком много действий (${eventType}). Подождите ещё ${secsLeft} сек.`,
      });
      return false;
    }

    // Чистим устаревшие timestamps
    state.timestamps = state.timestamps.filter((t) => now - t < windowMs);

    // Превышение лимита → прогрессивная блокировка
    if (state.timestamps.length >= max) {
      state.violations++;
      const idx = Math.min(state.violations - 1, PENALTIES_SEC.length - 1);
      const penaltySec = PENALTIES_SEC[idx];
      state.blockedUntil = now + penaltySec * 1000;

      const label =
        penaltySec >= 60
          ? `${Math.round(penaltySec / 60)} мин.`
          : `${penaltySec} сек.`;

      console.warn(
        `🚫 Socket RateLimit [${eventType}] userId=${id} violation #${state.violations}, blocked ${label}`,
      );

      socket.emit("error:ratelimit", {
        type: eventType,
        secsLeft: penaltySec,
        violation: state.violations,
        message: `Превышен лимит ${eventType}. Заблокировано на ${label}`,
      });
      return false;
    }

    state.timestamps.push(now);
    return true;
  }

  return { check };
}

// ─── Глобальная очистка неактивных записей ────────────────────────
// Каждые 5 минут проходим по всем store и удаляем записи юзеров,
// которые молчат 30+ минут И не заблокированы.
// Без этого Map растёт бесконечно (memory leak).
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const INACTIVE_THRESHOLD_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let totalCleaned = 0;

  for (const [eventType, store] of stores.entries()) {
    let cleaned = 0;
    for (const [userId, state] of store.entries()) {
      const lastTs = state.timestamps[state.timestamps.length - 1] || 0;
      const isInactive = now - lastTs > INACTIVE_THRESHOLD_MS;
      const notBlocked = now > state.blockedUntil;
      if (isInactive && notBlocked) {
        store.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) totalCleaned += cleaned;
  }

  if (totalCleaned > 0) {
    console.log(
      `🧹 Socket RateLimit cleanup: removed ${totalCleaned} inactive entries`,
    );
  }
}, CLEANUP_INTERVAL_MS);
