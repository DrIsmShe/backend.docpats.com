// server/modules/labInsight/services/labInsight.service.js
//
// Расшифровка бланка: фотография → показатели → объяснение.
//
// Порядок шагов здесь не произвольный:
//
//   1. квота        — до модели, иначе отказ стоит нам двух вызовов;
//   2. чтение бланка — модель переписывает напечатанное;
//   3. арифметика   — программа считает отклонения (без модели);
//   4. объяснение   — модель объясняет уже посчитанное;
//   5. сохранение   — только показатели, фотография не хранится.
//
// Шаг 3 стоит между двумя обращениями к модели намеренно: объясняющая
// модель получает готовые пометки и не имеет права их пересматривать.
// Если бы она считала сама, экран показывал бы её текст рядом с её же
// пометками — и ошибку было бы нечем поймать.

import LabInsight from "../models/labInsight.model.js";
import { readLabSheet } from "../ai/labSheetReader.js";
import { explainLab } from "../ai/labExplainer.js";
import { evaluateAll, summarize } from "./labFlags.service.js";
import { assertLabInsightAllowed } from "./labInsightQuota.service.js";
import { ValidationError, NotFoundError } from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "labInsight" });

/** Дата с бланка. Мусор игнорируем: лучше без даты, чем с выдуманной. */
function parseCollectedAt(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Дата из будущего — почти наверняка ошибка распознавания.
  if (d.getTime() > Date.now() + 86400000) return null;
  return d;
}

/**
 * Разобрать бланк.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {Buffer} args.buffer
 * @param {string} args.mimeType
 * @param {string} [args.language]
 */
export async function createLabInsight({
  userId,
  buffer,
  mimeType,
  language = "ru",
}) {
  // 1. Квота — до модели.
  await assertLabInsightAllowed(userId);

  // 2. Чтение бланка.
  const sheet = await readLabSheet({ buffer, mimeType });

  if (!sheet.isLabSheet) {
    // Отказ понятный: человек чаще всего просто сфотографировал не то.
    throw new ValidationError(
      "На фотографии не удалось распознать бланк анализов. " +
        "Сфотографируйте таблицу с показателями целиком, при хорошем свете.",
    );
  }
  if (!sheet.parameters.length) {
    throw new ValidationError(
      "Показатели на бланке не прочитались. Попробуйте снять ближе " +
        "и без бликов — или пришлите PDF из лаборатории.",
    );
  }

  // 3. Арифметика — без модели.
  const evaluated = evaluateAll(sheet.parameters);

  // 4. Объяснение уже посчитанного.
  const explained = await explainLab({ evaluated, language });

  // Сопоставляем объяснения с показателями ПО ИМЕНИ, а не по порядку:
  // модель может вернуть меньше пунктов или переставить их, и сдвиг на
  // один означал бы объяснение чужого показателя.
  const byName = new Map(
    (explained.items || []).map((i) => [
      String(i.name || "").trim().toLowerCase(),
      i,
    ]),
  );

  const parameters = evaluated.map((e) => {
    const found = byName.get(e.name.toLowerCase()) || null;
    return {
      name: e.name,
      rawValue: e.rawValue,
      value: e.value,
      unit: e.unit,
      refText: e.refText,
      refMin: e.range?.min ?? null,
      refMax: e.range?.max ?? null,
      level: e.level,
      direction: e.direction,
      ratio: e.ratio,
      whatItIs: found?.whatItIs || "",
      whatItMeans: found?.whatItMeans || "",
    };
  });

  // 5. Сохраняем ТОЛЬКО показатели. Фотография не пишется никуда.
  const doc = await LabInsight.create({
    userId,
    labName: sheet.labName,
    collectedAt: parseCollectedAt(sheet.collectedAt),
    parameters,
    unreadable: sheet.unreadable,
    overview: explained.overview,
    seeDoctor: explained.seeDoctor,
    provenance: {
      readerModel: sheet.model || null,
      readerPrompt: sheet.promptVersion,
      explainerModel: explained.model || null,
      explainerPrompt: explained.promptVersion,
    },
  });

  log.info(
    {
      insightId: String(doc._id),
      params: parameters.length,
      unreadable: sheet.unreadable.length,
    },
    "Бланк разобран",
  );

  return toShape(doc);
}

/** Форма для интерфейса. Сводка считается на лету, а не хранится. */
export function toShape(doc) {
  const parameters = (doc.parameters || []).map((p) => ({
    name: p.name,
    rawValue: p.rawValue,
    unit: p.unit,
    refText: p.refText,
    level: p.level,
    direction: p.direction,
    whatItIs: p.whatItIs,
    whatItMeans: p.whatItMeans,
  }));

  return {
    id: String(doc._id),
    labName: doc.labName || null,
    collectedAt: doc.collectedAt || null,
    createdAt: doc.createdAt,
    overview: doc.overview,
    seeDoctor: doc.seeDoctor,
    unreadable: doc.unreadable || [],
    parameters,
    summary: summarize(doc.parameters || []),
  };
}

/** Список разборов пациента. Только свои — чужих здесь быть не может. */
export async function listLabInsights({ userId, limit = 20 }) {
  const docs = await LabInsight.find({ userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 50))
    .lean();
  return docs.map(toShape);
}

/** Один разбор. Чужой не отдаём даже по прямой ссылке. */
export async function getLabInsight({ userId, id }) {
  const doc = await LabInsight.findOne({ _id: id, userId }).lean();
  if (!doc) throw new NotFoundError("Разбор не найден");
  return toShape(doc);
}

/** Удалить свой разбор. */
export async function deleteLabInsight({ userId, id }) {
  const res = await LabInsight.deleteOne({ _id: id, userId });
  if (!res.deletedCount) throw new NotFoundError("Разбор не найден");
  return { id: String(id), deleted: true };
}

export default {
  createLabInsight,
  listLabInsights,
  getLabInsight,
  deleteLabInsight,
};
