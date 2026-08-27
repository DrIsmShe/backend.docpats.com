// __tests__/education/purgeTranslations.test.js
//
// СНЯТИЕ ПЕРЕВОДОВ С ТЕСТА — он снова становится одноязычным.
//
// Раскладка витрины поменялась: язык курса это рубрика каталога, и в каждую
// кладётся свой тест. Тесты, переведённые до этого решения, остаются
// пятиязычными: вопросы-переводы лежат в банке, значит languages содержит все
// пять, и тест находится фильтром на каждом языке — даже лёжа в рубрике
// одного.
//
// Главное, что здесь проверяется, — что оригиналы не пострадали и что попытки
// не удаляются молча.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import ExamAttempt from "../../modules/education/education-attempts/models/examAttempt.model.js";
import {
  inspectProgramTranslations,
  purgeProgramTranslations,
} from "../../modules/education/education-translation/purgeTranslations.service.js";

const oid = () => new mongoose.Types.ObjectId();

let program;

async function makeItem(lang, translationOf = null) {
  return ExamItem.create({
    programId: program._id,
    topicCode: "bio",
    lang,
    translationOf,
    stem: `[${lang}] вопрос`,
    options: [
      { key: "A", text: "верный" },
      { key: "B", text: "неверный" },
    ],
    correctKeys: ["A"],
    source: { kind: "original" },
    status: "published",
  });
}

beforeEach(async () => {
  program = await ExamProgram.create({
    code: `purge-${Date.now().toString(36)}`,
    title: "Типология личности по Карлу Юнгу",
    country: "INT",
    region: "international",
    examType: "cme",
    blueprint: [{ code: "bio", title: "Психология", weightPercent: 100 }],
    languages: ["ru", "en", "az", "tr", "ar"],
    translations: [
      { lang: "az", title: "Karl Yunqa görə şəxsiyyət tipologiyası" },
    ],
    status: "published",
  });

  // Два оригинала и по переводу каждого на четыре языка.
  for (let i = 0; i < 2; i += 1) {
    const original = await makeItem("ru");
    for (const lang of ["en", "az", "tr", "ar"]) {
      await makeItem(lang, original._id);
    }
  }
});

describe("осмотр перед снятием", () => {
  it("считает переводы по языкам и не трогает оригиналы", async () => {
    const report = await inspectProgramTranslations(program._id);

    expect(report.originalCount).toBe(2);
    expect(report.translationCount).toBe(8);
    expect(report.translationsByLang).toEqual({ en: 2, az: 2, tr: 2, ar: 2 });
    expect(report.affectedAttempts).toBe(0);
  });
});

describe("снятие переводов", () => {
  it("удаляет переводы, оставляет оригиналы и делает тест одноязычным", async () => {
    const result = await purgeProgramTranslations(program._id);

    expect(result.removedItems).toBe(8);
    expect(await ExamItem.countDocuments({ programId: program._id })).toBe(2);
    expect(
      await ExamItem.countDocuments({
        programId: program._id,
        translationOf: { $ne: null },
      }),
    ).toBe(0);

    expect(result.after.languages).toEqual(["ru"]);
    expect(result.after.primaryLang).toBe("ru");
    expect(result.after.publishedItemCount).toBe(2);
    // Переводы названия — часть той же многоязычности.
    expect(result.after.titleTranslations).toBe(0);
  });

  it("повторный прогон ничего не находит и не ломается", async () => {
    await purgeProgramTranslations(program._id);
    const second = await purgeProgramTranslations(program._id);

    expect(second.removedItems).toBe(0);
    expect(await ExamItem.countDocuments({ programId: program._id })).toBe(2);
  });
});

describe("попытки, пройденные на переводах", () => {
  async function makeAttemptOnTranslation() {
    const translated = await ExamItem.findOne({
      programId: program._id,
      lang: "az",
    }).lean();
    return ExamAttempt.create({
      userId: oid(),
      programId: program._id,
      mode: "tutor",
      lang: "az",
      status: "submitted",
      questions: [
        { itemId: translated._id, version: 1, topicCode: "bio", order: 0 },
      ],
    });
  }

  it("без явного решения не удаляем ничего", async () => {
    await makeAttemptOnTranslation();

    await expect(purgeProgramTranslations(program._id)).rejects.toThrow(
      /попыток/i,
    );
    // Отказ должен случиться ДО записи, а не посередине.
    expect(
      await ExamItem.countDocuments({
        programId: program._id,
        translationOf: { $ne: null },
      }),
    ).toBe(8);
  });

  it("attempts=keep — попытка остаётся, переводы сняты", async () => {
    const attempt = await makeAttemptOnTranslation();

    const result = await purgeProgramTranslations(program._id, {
      attempts: "keep",
    });

    expect(result.removedItems).toBe(8);
    expect(result.deletedAttempts).toBe(0);
    expect(await ExamAttempt.findById(attempt._id)).not.toBeNull();
  });

  it("attempts=delete — попытка удаляется вместе с переводами", async () => {
    const attempt = await makeAttemptOnTranslation();

    const result = await purgeProgramTranslations(program._id, {
      attempts: "delete",
    });

    expect(result.deletedAttempts).toBe(1);
    expect(await ExamAttempt.findById(attempt._id)).toBeNull();
  });

  it("попытку по оригиналам не трогаем ни при каком решении", async () => {
    const original = await ExamItem.findOne({
      programId: program._id,
      translationOf: null,
    }).lean();
    const attempt = await ExamAttempt.create({
      userId: oid(),
      programId: program._id,
      mode: "tutor",
      lang: "ru",
      status: "submitted",
      questions: [
        { itemId: original._id, version: 1, topicCode: "bio", order: 0 },
      ],
    });

    await purgeProgramTranslations(program._id, { attempts: "delete" });

    expect(await ExamAttempt.findById(attempt._id)).not.toBeNull();
  });
});
