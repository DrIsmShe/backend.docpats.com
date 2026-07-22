// __tests__/education/items.test.js
//
// Банк вопросов: структурная целостность, редакторский цикл и — главное —
// гейт публикации машинно-извлечённого контента.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import {
  createItem,
  updateItem,
  submitForReview,
  reviewItem,
  archiveItem,
  reviewAllReady,
  assertItemIntegrity,
  assertPublishable,
  collectQualityWarnings,
} from "../../modules/education/education-items/services/item.service.js";
import {
  isAuthorRole,
  isReviewerRole,
} from "../../modules/education/middlewares/educationAuth.js";

const oid = () => new mongoose.Types.ObjectId();

async function makeProgram() {
  return ExamProgram.create({
    code: "tr-tus-test",
    title: "TUS (тест)",
    country: "TR",
    region: "mena",
    examType: "residency_entrance",
    blueprint: [
      { code: "cardio", title: "Кардиология", weightPercent: 60 },
      { code: "neuro", title: "Неврология", weightPercent: 40 },
    ],
    status: "published",
  });
}

// Полностью готовый к публикации вопрос.
function goodItemPayload(programId, overrides = {}) {
  return {
    programId,
    topicCode: "cardio",
    stem: "Пациент 62 лет с давящей болью за грудиной. Тактика?",
    options: [
      { key: "A", text: "ЭКГ и тропонин", explanation: "Верно: ОКС исключается первым." },
      { key: "B", text: "Отпустить домой", explanation: "Неверно: риск ОКС не оценён." },
      { key: "C", text: "Назначить МРТ", explanation: "Неверно: не первичный метод." },
    ],
    correctKeys: ["A"],
    explanation: "При подозрении на ОКС первыми выполняются ЭКГ и тропонин.",
    source: { kind: "original" },
    ...overrides,
  };
}

// Редакторский контур закрыт админ-панелью — это требование продукта,
// а не деталь реализации, поэтому зафиксировано тестом.
describe("доступ к редакторскому контуру", () => {
  it("создавать и публиковать контент может только admin", () => {
    expect(isAuthorRole("admin")).toBe(true);
    expect(isReviewerRole("admin")).toBe(true);

    for (const role of ["doctor", "patient", "clinic_admin", "clinic_staff"]) {
      expect(isAuthorRole(role)).toBe(false);
      expect(isReviewerRole(role)).toBe(false);
    }
  });
});

describe("assertItemIntegrity", () => {
  it("отвергает вопрос с одним вариантом ответа", () => {
    expect(() =>
      assertItemIntegrity({
        type: "sba",
        options: [{ key: "A", text: "x" }],
        correctKeys: ["A"],
      }),
    ).toThrow(/at least 2 options/i);
  });

  it("отвергает ключ, не соответствующий ни одному варианту", () => {
    expect(() =>
      assertItemIntegrity({
        type: "sba",
        options: [
          { key: "A", text: "x" },
          { key: "B", text: "y" },
        ],
        correctKeys: ["C"],
      }),
    ).toThrow(/unknown options/i);
  });

  it("требует ровно один верный ответ для типа sba", () => {
    expect(() =>
      assertItemIntegrity({
        type: "sba",
        options: [
          { key: "A", text: "x" },
          { key: "B", text: "y" },
        ],
        correctKeys: ["A", "B"],
      }),
    ).toThrow(/exactly one correct answer/i);
  });

  it("не даёт сделать верными все варианты в multi", () => {
    expect(() =>
      assertItemIntegrity({
        type: "multi",
        options: [
          { key: "A", text: "x" },
          { key: "B", text: "y" },
        ],
        correctKeys: ["A", "B"],
      }),
    ).toThrow(/all options cannot be correct/i);
  });
});

describe("assertPublishable", () => {
  it("НЕ требует объяснений — их наличие решает редактор", () => {
    // Государственные сборники идут без разборов; запрет на публикацию
    // из-за отсутствия объяснения запретил бы импорт как класс.
    const item = {
      type: "sba",
      options: [
        { key: "A", text: "x" },
        { key: "B", text: "y" },
      ],
      correctKeys: ["A"],
      explanation: "",
      source: { kind: "original" },
    };
    expect(() => assertPublishable(item)).not.toThrow();
  });

  it("но сообщает о пробелах как о замечаниях", () => {
    const warnings = collectQualityWarnings({
      options: [
        { key: "A", text: "x" },
        { key: "B", text: "y" },
      ],
      correctKeys: ["A"],
      explanation: "",
    });
    expect(warnings.join(" ")).toMatch(/нет общего объяснения/i);
    expect(warnings.join(" ")).toMatch(/нет объяснений к вариантам/i);
  });

  it("замечаний нет у полностью оформленного вопроса", () => {
    const warnings = collectQualityWarnings({
      options: [
        { key: "A", text: "x", explanation: "верно" },
        { key: "B", text: "y", explanation: "неверно" },
      ],
      correctKeys: ["A"],
      explanation: "разбор",
      references: [{ title: "Клинические рекомендации" }],
    });
    expect(warnings).toEqual([]);
  });

  it("требует authority для заимствованного государственного материала", () => {
    const item = {
      type: "sba",
      options: [
        { key: "A", text: "x", explanation: "верно" },
        { key: "B", text: "y", explanation: "неверно" },
      ],
      correctKeys: ["A"],
      explanation: "общее",
      source: { kind: "public_government" },
    };
    expect(() => assertPublishable(item)).toThrow(/source.authority is required/i);
  });
});

describe("редакторский цикл", () => {
  let program;
  beforeEach(async () => {
    program = await makeProgram();
  });

  it("создаёт вопрос только как черновик, даже если попросили опубликовать", async () => {
    const item = await createItem({
      ...goodItemPayload(program._id),
      status: "published", // попытка обойти ревью
    });
    expect(item.status).toBe("draft");
  });

  it("не принимает topicCode вне blueprint программы", async () => {
    await expect(
      createItem(goodItemPayload(program._id, { topicCode: "surgery" })),
    ).rejects.toThrow(/not in the program blueprint/i);
  });

  it("проводит вопрос draft → in_review → published и считает счётчик программы", async () => {
    const reviewerId = oid();
    const draft = await createItem(goodItemPayload(program._id));

    const submitted = await submitForReview(draft._id);
    expect(submitted.status).toBe("in_review");

    const published = await reviewItem(draft._id, {
      decision: "approve",
      reviewerId,
    });
    expect(published.status).toBe("published");
    expect(String(published.reviewedBy)).toBe(String(reviewerId));

    const refreshed = await ExamProgram.findById(program._id).lean();
    expect(refreshed.publishedItemCount).toBe(1);
  });

  it("отклонение требует причины и возвращает вопрос автору", async () => {
    const draft = await createItem(goodItemPayload(program._id));
    await submitForReview(draft._id);

    await expect(
      reviewItem(draft._id, { decision: "reject", reviewerId: oid() }),
    ).rejects.toThrow(/rejection reason is required/i);

    const rejected = await reviewItem(draft._id, {
      decision: "reject",
      reason: "Ключ ответа неверен",
      reviewerId: oid(),
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toMatch(/Ключ ответа/);
  });

  it("правка содержания опубликованного вопроса создаёт новую версию, старую архивирует", async () => {
    const draft = await createItem(goodItemPayload(program._id));
    await submitForReview(draft._id);
    await reviewItem(draft._id, { decision: "approve", reviewerId: oid() });

    const next = await updateItem(draft._id, {
      stem: "Переформулированное условие вопроса",
    });

    expect(next.version).toBe(2);
    expect(String(next.previousVersionId)).toBe(String(draft._id));
    // Новая версия обязана пройти ревью заново.
    expect(next.status).toBe("in_review");

    const old = await ExamItem.findById(draft._id).lean();
    expect(old.status).toBe("archived");
  });
});

// ─── Главный инвариант модуля ─────────────────────────────────────────
describe("гейт публикации машинно-извлечённого контента", () => {
  let program;
  beforeEach(async () => {
    program = await makeProgram();
  });

  it("вопрос, сгенерированный ИИ, не публикуется без рецензента", () => {
    const item = {
      type: "sba",
      options: [
        { key: "A", text: "x", explanation: "верно" },
        { key: "B", text: "y", explanation: "неверно" },
      ],
      correctKeys: ["A"],
      explanation: "общее",
      source: { kind: "ai_generated" },
      reviewedBy: null,
    };
    expect(() => assertPublishable(item)).toThrow(/requires human review/i);
    // ...и публикуется, как только рецензент назван.
    expect(() => assertPublishable(item, { reviewerId: oid() })).not.toThrow();
  });

  it("официальный тест, РАСПОЗНАННЫЙ из файла, тоже требует ревью", () => {
    // source.kind здесь безупречный — риск не в происхождении содержания,
    // а в том, что распознавание могло исказить вопрос.
    const item = {
      type: "sba",
      options: [
        { key: "A", text: "x", explanation: "верно" },
        { key: "B", text: "y", explanation: "неверно" },
      ],
      correctKeys: ["A"],
      explanation: "общее",
      source: { kind: "public_government", authority: "Минздрав" },
      importJobId: oid(),
      reviewedBy: null,
    };
    expect(() => assertPublishable(item)).toThrow(/requires human review/i);
  });

  it("сквозная проверка: ИИ-вопрос без объяснений публикуется рецензентом", async () => {
    // Именно этот случай пришёл из реального импорта: в исходном файле
    // разборов не было. Рецензент проверил ответ — этого достаточно.
    const item = await createItem({
      ...goodItemPayload(program._id, {
        source: { kind: "ai_generated" },
        options: [
          { key: "A", text: "x" }, // объяснений нет — типичный вывод экстрактора
          { key: "B", text: "y" },
        ],
        correctKeys: ["A"],
        explanation: "",
      }),
    });
    await submitForReview(item._id);

    const published = await reviewItem(item._id, {
      decision: "approve",
      reviewerId: oid(),
    });
    expect(published.status).toBe("published");
  });
});

// Регресс из продакшена: азербайджанский тест лежал в каталоге как русский,
// потому что languages брались из формы импорта (там жёстко "ru"), а не из
// самих вопросов. Фильтр по языку на витрине такой тест не находил.
describe("languages программы следуют за банком вопросов", () => {
  let program;

  beforeEach(async () => {
    program = await makeProgram();
    // Исходное состояние — то, что подставляет форма импорта.
    expect(program.languages).toEqual(["ru"]);
  });

  it("публикация вопроса на другом языке переписывает languages теста", async () => {
    const item = await createItem(
      goodItemPayload(program._id, { lang: "az" }),
    );
    await submitForReview(item._id);
    await reviewItem(item._id, { decision: "approve", reviewerId: oid() });

    const fresh = await ExamProgram.findById(program._id).lean();
    expect(fresh.languages).toEqual(["az"]);
    expect(fresh.publishedItemCount).toBe(1);
  });

  it("двуязычный банк даёт оба языка в порядке EXAM_LANGUAGES", async () => {
    for (const lang of ["az", "ru"]) {
      const item = await createItem(goodItemPayload(program._id, { lang }));
      await submitForReview(item._id);
      await reviewItem(item._id, { decision: "approve", reviewerId: oid() });
    }

    const fresh = await ExamProgram.findById(program._id).lean();
    // Порядок важен: languages[0] — язык попытки по умолчанию.
    expect(fresh.languages).toEqual(["ru", "az"]);
  });

  it("архивация последнего вопроса не обнуляет languages", async () => {
    // Пустой массив языков сделал бы тест невидимым для любого фильтра,
    // поэтому при пустом банке оставляем то, что было.
    const item = await createItem(
      goodItemPayload(program._id, { lang: "az" }),
    );
    await submitForReview(item._id);
    await reviewItem(item._id, { decision: "approve", reviewerId: oid() });
    await archiveItem(item._id);

    const fresh = await ExamProgram.findById(program._id).lean();
    expect(fresh.publishedItemCount).toBe(0);
    expect(fresh.languages).toEqual(["az"]);
  });
});

// Импорт сборника даёт сотню вопросов разом, и ревью по одному — работа
// на вечер. Пакет одобряет всё готовое, но гейт не отменяет: решение
// принимает человек и оно пишется на каждый вопрос.
describe("пакетное одобрение очереди", () => {
  let program;

  beforeEach(async () => {
    program = await makeProgram();
  });

  it("одобряет все готовые вопросы теста и проставляет рецензента", async () => {
    const reviewerId = oid();
    for (let i = 0; i < 3; i += 1) {
      const item = await createItem(
        goodItemPayload(program._id, { stem: `Вопрос ${i} про тактику?` }),
      );
      await submitForReview(item._id);
    }

    const result = await reviewAllReady({ programId: program._id, reviewerId });
    expect(result.approvedCount).toBe(3);
    expect(result.skippedCount).toBe(0);

    const published = await ExamItem.find({
      programId: program._id,
      status: "published",
    }).lean();
    expect(published).toHaveLength(3);
    for (const item of published) {
      expect(String(item.reviewedBy)).toBe(String(reviewerId));
    }
  });

  it("пропускает вопрос без правильного ответа и возвращает причину", async () => {
    // Именно ради таких пакет и не делает bulk-update: вопрос без ключа
    // ответа опубликовать нельзя, и оператор должен узнать, какой именно
    // остался.
    const good = await createItem(goodItemPayload(program._id));
    await submitForReview(good._id);

    const broken = await createItem(
      goodItemPayload(program._id, { stem: "Вопрос без ключа ответа?" }),
    );
    await submitForReview(broken._id);
    await ExamItem.updateOne({ _id: broken._id }, { $set: { correctKeys: [] } });

    const result = await reviewAllReady({
      programId: program._id,
      reviewerId: oid(),
    });

    expect(result.approvedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0].itemId).toBe(String(broken._id));

    const stillPending = await ExamItem.findById(broken._id).lean();
    expect(stillPending.status).toBe("in_review");
  });

  it("пересчитывает счётчик опубликованных вопросов теста", async () => {
    // Пакет идёт через reviewItem именно поэтому: bulk-обновление
    // разъехалось бы с денормализованными полями программы.
    const item = await createItem(goodItemPayload(program._id));
    await submitForReview(item._id);

    await reviewAllReady({ programId: program._id, reviewerId: oid() });

    const fresh = await ExamProgram.findById(program._id).lean();
    expect(fresh.publishedItemCount).toBe(1);
  });
});
