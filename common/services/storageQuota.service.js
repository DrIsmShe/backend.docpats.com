// server/common/services/storageQuota.service.js
// ─────────────────────────────────────────────────────────────────────
//   Квота архива документов по тарифу.
//
//   ЧТО СЧИТАЕМ. Живые записи реестра загрузок (StoredFile) владельца.
//   Не скользящее окно, в отличие от разборов и минут видео: файл лежит
//   в хранилище постоянно и стоит денег постоянно. Освободить место можно
//   только удалив файл.
//
//   ЧЕЙ ТАРИФ. Того, кто загружает, — врача или клиники. Пациент файлы не
//   загружает вовсе: записи вносит врач, у которого он наблюдается.
//
//   ГДЕ ПРИМЕНЯЕТСЯ. В общем обработчике загрузки (processFiles), до
//   отправки в хранилище. Проверять после — значит платить за файл,
//   который тут же отвергнут.
// ─────────────────────────────────────────────────────────────────────

import StoredFile from "../models/storedFile.js";
import User from "../models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_DISPLAY_NAMES,
} from "../config/aiPlanLimits.js";
import { ValidationError } from "../utils/errors.js";

/** Сколько файлов сейчас занимает владелец. */
export async function storedFilesUsed(ownerId) {
  return StoredFile.countDocuments({ ownerId, releasedAt: null });
}

/** План владельца и его предел. null — предел неприменим. */
async function planQuota(ownerId) {
  const user = await User.findById(ownerId)
    .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
    .lean();
  if (!user) return null;

  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, "storedFiles");

  // 0 — фича у плана не описана (пациенты), -1 — безлимит.
  if (!limit || limit < 0) return null;

  return { plan, limit };
}

/**
 * Проверить, поместятся ли ещё count файлов.
 *
 * Проверяем ПАЧКУ целиком, а не по одному: врач прикладывает к
 * исследованию сразу несколько снимков, и загрузить три из пяти — хуже,
 * чем отказать сразу. Частично загруженное исследование выглядит как
 * потерянные данные.
 */
export async function assertStorageAllowed(ownerId, count = 1) {
  if (!ownerId) return;

  const quota = await planQuota(ownerId);
  if (!quota) return;

  const used = await storedFilesUsed(ownerId);
  if (used + count <= quota.limit) return;

  const planName = PLAN_DISPLAY_NAMES[quota.plan] || quota.plan;
  throw new ValidationError(
    `Архив тарифа ${planName} заполнен: ${used} из ${quota.limit} файлов` +
      (count > 1 ? `, в этой загрузке ещё ${count}` : "") +
      `. Удалите ненужные файлы или перейдите на старший тариф.`,
    {
      limit: "storedFiles",
      plan: quota.plan,
      planLimit: quota.limit,
      used,
      requested: count,
    },
  );
}

/** Записать загруженные файлы в реестр. */
export async function recordStoredFiles(ownerId, files = [], context = "other") {
  if (!ownerId || !files.length) return [];

  return StoredFile.insertMany(
    files.map((f) => ({
      ownerId,
      url: f.fileUrl ?? f.url,
      fileName: f.fileName ?? "",
      mime: f.fileFormat ?? f.mime ?? "",
      size: f.fileSize ?? f.size ?? 0,
      context,
    })),
    { ordered: false },
  );
}

/**
 * Освободить место: файл удалён из хранилища.
 *
 * Помечаем, а не стираем запись: реестр знает, что лежало в R2, и это
 * нужно уборщику сирот. Удалённая запись сделала бы живой файл невидимым
 * для уборки.
 */
export async function releaseStoredFile(url) {
  if (!url) return 0;
  const res = await StoredFile.updateMany(
    { url, releasedAt: null },
    { $set: { releasedAt: new Date() } },
  );
  return res.modifiedCount ?? 0;
}

/** Остаток — чтобы интерфейс показал его до загрузки. */
export async function storageQuotaLeft(ownerId) {
  const quota = await planQuota(ownerId);
  const used = await storedFilesUsed(ownerId);
  if (!quota) return { used, limit: null, plan: null };
  return {
    used,
    limit: quota.limit,
    plan: quota.plan,
    remaining: Math.max(0, quota.limit - used),
  };
}

export default {
  assertStorageAllowed,
  recordStoredFiles,
  releaseStoredFile,
  storageQuotaLeft,
  storedFilesUsed,
};
