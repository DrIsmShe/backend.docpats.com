// __tests__/radiology/aiReviewGate.test.js
//
// Гейт публикации по замечаниям ИИ-рецензента.
//
// Раньше рецензия жила только в состоянии формы, и гейт был мягким: F5 —
// и кейс с неразобранными замечаниями публиковался. Теперь рецензия и
// отметки «разобрано» лежат в кейсе, а проверку делает сервер при смене
// статуса, так что перезагрузка страницы ничего не открывает.
//
// Отдельно проверяется, что «разобрано» нельзя проставить чужими номерами:
// иначе гейт обходился бы одним запросом с индексами, которых нет.

import { describe, it, expect, beforeEach, vi } from "vitest";
import LabCase from "../../modules/radiology/labs-station/models/labCase.model.js";

// Публикация кейса запускает перевод на остальные языки — намеренно
// «в фоне», без ожидания (translation/onPublish.js). В тесте этот фон
// оборачивался РЕАЛЬНЫМ вызовом модели: тест ставит статус published, отдаёт
// управление, и уже после него setImmediate уходил в сеть. В полном прогоне
// это давало то падение по таймауту, то шум в логах — перевод не находил кейс,
// потому что коллекции уже вычищены между тестами.
//
// Гейт публикации к переводу отношения не имеет, поэтому переводчик здесь
// замокан: тест не должен ни платить за модель, ни зависеть от сети.
vi.mock("../../modules/radiology/translation/caseTranslator.js", () => ({
  PROMPT_VERSION: "test",
  MODEL: "test-model",
  translateCaseContent: vi.fn(async ({ fields }) => ({
    fields: Object.fromEntries(Object.entries(fields).map(([p, t]) => [p, t])),
    diagnosisKeys: ["test-dx"],
    diagnosisSynonyms: [],
    model: "test-model",
    promptVersion: "test",
  })),
}));
import {
  setLabStatus,
  collectLabBlockers,
} from "../../modules/radiology/labs-station/lab.service.js";
import {
  saveAiReview,
  setAiReviewDismissed,
} from "../../modules/radiology/ai/aiReviewStore.js";
import { unresolvedAiIssues } from "../../modules/radiology/ai/aiReviewFields.js";

const REVIEW = {
  verdict: "issues",
  errorCount: 1,
  summary: "Два замечания",
  issues: [
    {
      target: "Ферритин",
      severity: "error",
      issue: "Значение не согласуется с диагнозом",
      suggestion: "Снизить до 4 мкг/л",
    },
    {
      target: "Заключение",
      severity: "warning",
      issue: "Не упомянута причина дефицита",
      suggestion: "Добавить источник потери железа",
    },
  ],
};

// Кейс, у которого всё остальное к публикации готово: так видно, что
// блокирует именно рецензия.
async function makePublishableCase() {
  return LabCase.create({
    title: "Железодефицитная анемия",
    panel: [
      { key: "hgb", name: "Гемоглобин", value: "88", unit: "г/л" },
      { key: "ferritin", name: "Ферритин", value: "4", unit: "мкг/л" },
    ],
    significantAbnormal: ["hgb", "ferritin"],
    impression: { correctText: "ЖДА", diagnosisKeys: ["железодефицитная анемия"] },
    source: { kind: "original" },
    status: "draft",
  });
}

let labCase;
beforeEach(async () => {
  labCase = await makePublishableCase();
});

describe("сохранение рецензии", () => {
  it("кладётся в кейс и переживает перечитывание из базы", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    const fresh = await LabCase.findById(labCase._id).lean();
    expect(fresh.aiReview.verdict).toBe("issues");
    expect(fresh.aiReview.issues).toHaveLength(2);
    expect(fresh.aiReview.errorCount).toBe(1);
    expect(fresh.aiReview.generatedAt).toBeTruthy();
    expect(fresh.aiReview.dismissed).toEqual([]);
  });

  it("без id кейса ничего не пишет (кейс ещё не сохранён — это нормально)", async () => {
    const res = await saveAiReview({ CaseModel: LabCase, caseId: null, review: REVIEW });
    expect(res).toBeNull();
  });

  it("новая рецензия сбрасывает отметки «разобрано»", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    await setAiReviewDismissed({ CaseModel: LabCase, caseId: labCase._id, dismissed: [0, 1] });
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    const fresh = await LabCase.findById(labCase._id).lean();
    // Иначе «разобрано» перенеслось бы на другое замечание с тем же номером.
    expect(fresh.aiReview.dismissed).toEqual([]);
  });
});

describe("гейт публикации", () => {
  it("до рецензии кейс публикуется — старые кейсы не ломаются", async () => {
    expect(collectLabBlockers(labCase)).toEqual([]);
    const doc = await setLabStatus(labCase._id, "published", null, "admin");
    expect(doc.status).toBe("published");
  });

  it("неразобранные замечания публиковать не дают", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    const withReview = await LabCase.findById(labCase._id);

    expect(unresolvedAiIssues(withReview.aiReview)).toHaveLength(2);
    expect(collectLabBlockers(withReview).join(" ")).toMatch(/замечания ИИ-рецензента \(2\)/);

    await expect(setLabStatus(labCase._id, "published", null, "admin")).rejects.toThrow(
      /замечания ИИ-рецензента/,
    );
    expect((await LabCase.findById(labCase._id).lean()).status).toBe("draft");
  });

  it("частично разобранные — всё ещё не дают, но счётчик уменьшается", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    await setAiReviewDismissed({ CaseModel: LabCase, caseId: labCase._id, dismissed: [0] });
    const doc = await LabCase.findById(labCase._id);
    expect(collectLabBlockers(doc).join(" ")).toMatch(/\(1\)/);
    await expect(setLabStatus(labCase._id, "published", null, "admin")).rejects.toThrow();
  });

  it("разобрал всё — публикация проходит", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    const saved = await setAiReviewDismissed({
      CaseModel: LabCase,
      caseId: labCase._id,
      dismissed: [0, 1],
    });
    expect(saved.unresolved).toBe(0);
    const doc = await setLabStatus(labCase._id, "published", null, "admin");
    expect(doc.status).toBe("published");
  });

  it("чистая рецензия (замечаний нет) публикацию не блокирует", async () => {
    await saveAiReview({
      CaseModel: LabCase,
      caseId: labCase._id,
      review: { verdict: "clean", issues: [], errorCount: 0, summary: "Согласовано" },
    });
    const doc = await setLabStatus(labCase._id, "published", null, "admin");
    expect(doc.status).toBe("published");
  });

  it("блокируют ВСЕ замечания, а не только severity=error", async () => {
    // Калибровка показала: модель систематически занижает серьёзность, и
    // промптом это исправить не удалось. Поэтому severity — только порядок
    // показа, а гейт смотрит на факт неразобранности.
    await saveAiReview({
      CaseModel: LabCase,
      caseId: labCase._id,
      review: {
        verdict: "issues",
        errorCount: 0,
        summary: "",
        issues: [{ target: "Панель", severity: "warning", issue: "Мелкое замечание", suggestion: "" }],
      },
    });
    const doc = await LabCase.findById(labCase._id);
    expect(doc.aiReview.errorCount).toBe(0);
    expect(collectLabBlockers(doc)).toHaveLength(1);
  });
});

describe("отметки «разобрано» нельзя подделать", () => {
  it("номера вне списка замечаний отбрасываются", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    const saved = await setAiReviewDismissed({
      CaseModel: LabCase,
      caseId: labCase._id,
      // 5 и 9 не существуют: замечаний всего два.
      dismissed: [0, 5, 9],
    });
    expect(saved.dismissed).toEqual([0]);
    expect(saved.unresolved).toBe(1);
    await expect(setLabStatus(labCase._id, "published", null, "admin")).rejects.toThrow();
  });

  it("повторы номеров не считаются за разные замечания", async () => {
    await saveAiReview({ CaseModel: LabCase, caseId: labCase._id, review: REVIEW });
    const saved = await setAiReviewDismissed({
      CaseModel: LabCase,
      caseId: labCase._id,
      dismissed: [1, 1, 1],
    });
    expect(saved.dismissed).toEqual([1]);
    expect(saved.unresolved).toBe(1);
  });

  it("несуществующий кейс — null, а не тихий успех", async () => {
    const res = await setAiReviewDismissed({
      CaseModel: LabCase,
      caseId: "6a65df4e2bdccc17b5ed3528",
      dismissed: [0],
    });
    expect(res).toBeNull();
  });
});
