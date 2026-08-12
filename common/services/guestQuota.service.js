// common/services/guestQuota.service.js
//
// Бесплатные попытки для невошедших посетителей — с настоящим подсчётом.
//
// Два потолка, и оба нужны:
//
//   ЛИЧНЫЙ  — сколько раз может один посетитель (по отпечатку адреса). Держит
//             честность обещания «одна статья бесплатно».
//   ОБЩИЙ   — сколько раз в сутки могут ВСЕ гости вместе. Личный потолок не
//             защищает от десятка адресов, а расход идёт с того же баланса,
//             которым живут надиктовка у врача и ночная генерация кейсов.
//
// Списание АТОМАРНОЕ и до вызова модели: сначала $inc, потом сравнение с
// потолком. Иначе два одновременных запроса оба увидят «использовано 0» и оба
// уйдут в модель — на бесплатном лимите в одну штуку это не мелочь.
//
// Неудачная генерация попытку НЕ возвращает. Это осознанно: иначе повтор
// ошибки становится способом обойти лимит.

import crypto from "node:crypto";

import GuestUsage from "../models/system/GuestUsage.js";

const GLOBAL_KEY = "__all_guests__";

/** Отпечаток адреса: сравнивать хватает, восстановить адрес нельзя. */
function fingerprint(req) {
  // Express с trust proxy уже разбирает X-Forwarded-For; req.ip — результат.
  const ip = req?.ip || req?.socket?.remoteAddress || "unknown";
  const secret =
    process.env.HASH_SECRET || process.env.ENCRYPTION_KEY || "guest-quota";
  return crypto.createHmac("sha256", secret).update(String(ip)).digest("hex");
}

const monthWindow = (now) => now.toISOString().slice(0, 7); // 2026-08
const dayWindow = (now) => now.toISOString().slice(0, 10); // 2026-08-12

/**
 * Списывает одну попытку и говорит, разрешена ли она.
 *
 * @param {object} args
 * @param {object} args.req
 * @param {string} args.feature      имя из aiPlanLimits (aiArticles и т.п.)
 * @param {number} args.limit        личный потолок за месяц
 * @param {number} [args.globalDaily] общий потолок в сутки на всех гостей
 * @returns {Promise<{allowed: boolean, used: number, limit: number, remaining: number, reason?: string}>}
 */
export async function consumeGuestQuota({ req, feature, limit, globalDaily }) {
  const now = new Date();

  // Ноль означает «гостям нельзя» — спрашивать базу незачем.
  if (!limit || limit <= 0) {
    return { allowed: false, used: 0, limit: limit || 0, remaining: 0, reason: "closed" };
  }

  const personal = await bump({
    keyHash: fingerprint(req),
    feature,
    window: monthWindow(now),
    ttlDays: 40,
  });

  if (personal > limit) {
    return {
      allowed: false,
      used: limit,
      limit,
      remaining: 0,
      reason: "personal",
    };
  }

  if (globalDaily && globalDaily > 0) {
    const global = await bump({
      keyHash: GLOBAL_KEY,
      feature,
      window: dayWindow(now),
      ttlDays: 3,
    });

    if (global > globalDaily) {
      return {
        allowed: false,
        used: personal,
        limit,
        remaining: Math.max(0, limit - personal),
        reason: "global",
      };
    }
  }

  return {
    allowed: true,
    used: personal,
    limit,
    remaining: Math.max(0, limit - personal),
  };
}

/** Сколько уже израсходовано — БЕЗ списания. Для показа счётчика на странице. */
export async function peekGuestQuota({ req, feature, limit }) {
  const now = new Date();
  const doc = await GuestUsage.findOne({
    keyHash: fingerprint(req),
    feature,
    window: monthWindow(now),
  }).lean();

  const used = doc?.count ?? 0;
  return {
    allowed: used < limit,
    used: Math.min(used, limit),
    limit,
    remaining: Math.max(0, limit - used),
  };
}

// На проде mongoose поднимается с autoIndex: false, поэтому индексы новой
// коллекции сами не появятся. Здесь это не косметика: без уникального индекса
// по (keyHash, feature, window) два одновременных upsert создадут ДВЕ записи,
// каждая со счётчиком 1, и лимит перестанет работать ровно в том случае, ради
// которого он и заводился — при одновременных запросах.
//
// Создаём один раз за жизнь процесса и не ждём готовности при каждом вызове.
let indexesReady = null;

function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = GuestUsage.createIndexes().catch((err) => {
      // Не роняем запрос: без индекса счётчик всё равно считает, просто хуже
      // держит одновременность. Но знать об этом надо.
      console.warn("[guestQuota] не удалось создать индексы:", err.message);
      indexesReady = null;
    });
  }
  return indexesReady;
}

async function bump({ keyHash, feature, window, ttlDays }) {
  await ensureIndexes();

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  const doc = await GuestUsage.findOneAndUpdate(
    { keyHash, feature, window },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return doc.count;
}

export default { consumeGuestQuota, peekGuestQuota };
