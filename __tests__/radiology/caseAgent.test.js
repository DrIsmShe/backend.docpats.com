// __tests__/radiology/caseAgent.test.js
//
// АГЕНТ-ДОВОДЧИК: «снимок загружен — доведи кейс до публикации».
//
// Модель замокана: качество правок проверяется в caseVerifier/caseReviser, а
// здесь важно другое — ГДЕ АГЕНТ ОБЯЗАН ОСТАНОВИТЬСЯ. Он публикует учебный
// контент от имени рецензента, поэтому цена ошибки тут не «плохой текст», а
// снимок пациента, ушедший в открытый доступ без подтверждённой анонимности.
//
// Три правила, которые тесты держат:
//   1. галочку деидентификации агент не ставит и без неё не публикует;
//   2. координаты находок и кадры он не трогает — это эталон, по которому
//      потом оценивают врачей;
//   3. неразобранное замечание рецензента блокирует публикацию, и «разобрано»
//      агент за человека не проставляет.
//
// Плюс предусловия: пока снимка нет, модель не вызывается вовсе — каждый круг
// цикла стоит двух вызовов Opus с рассуждением.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { verifyMock, reviseMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  reviseMock: vi.fn(),
}));

vi.mock("../../modules/radiology/ai/caseVerifier.js", () => ({
  verifyRadiologyCase: verifyMock,
}));
vi.mock("../../modules/radiology/ai/caseReviser.js", () => ({
  reviseRadiologyCase: reviseMock,
}));

const { runRadiologyCaseAgent } = await import(
  "../../modules/radiology/ai/caseAgent.js"
);
const { default: RadiologyCase } = await import(
  "../../modules/radiology/radiology-cases/models/radiologyCase.model.js"
);

const ACTOR = new mongoose.Types.ObjectId();
const AS = { actorId: ACTOR, actorRole: "admin" };

const cleanReview = () => ({
  verdict: "clean",
  issues: [],
  errorCount: 0,
  summary: "Замечаний нет",
  usage: { inputTokens: 10, outputTokens: 5 },
});

const dirtyReview = () => ({
  verdict: "issues",
  issues: [
    {
      target: "Заключение",
      severity: "warning",
      issue: "Заключение не соответствует находке",
      suggestion: "",
    },
  ],
  errorCount: 0,
  summary: "",
  usage: { inputTokens: 10, outputTokens: 5 },
});

/** Редактор, который возвращает черновик как есть — правки тут не предмет. */
const passthroughReviser = ({ draft }) => ({
  draft,
  changes: [],
  disputed: [],
  usage: { inputTokens: 5, outputTokens: 5 },
});

const FINDING = {
  key: "f1",
  imageIndex: 0,
  label: "pneumothorax",
  significance: "major",
  geometry: { shape: "point", coords: { x: 0.31, y: 0.22 } },
  explanation: "Край коллабированного лёгкого",
};

async function makeCase(extra = {}) {
  return RadiologyCase.create({
    modality: "cxr",
    title: "Пневмоторакс справа",
    clinicalContext: "Мужчина 24 лет, внезапная боль в груди",
    images: [{ url: "https://example.test/frame.webp", width: 1024, height: 1024 }],
    findings: [FINDING],
    plannedFindings: [],
    impression: { correctText: "Пневмоторакс", diagnosisKeys: ["пневмоторакс"] },
    source: { kind: "ai_generated" },
    deidentified: true,
    status: "draft",
    ...extra,
  });
}

beforeEach(() => {
  verifyMock.mockReset();
  reviseMock.mockReset();
  reviseMock.mockImplementation(passthroughReviser);
});

describe("Предусловия — до обращения к модели", () => {
  it("без снимка агент не тратит ни одного вызова модели", async () => {
    const doc = await makeCase({ images: [] });

    const r = await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(verifyMock).not.toHaveBeenCalled();
    expect(reviseMock).not.toHaveBeenCalled();
    expect(r.stoppedBy).toBe("prerequisites");
    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/загрузите снимок/i);
  });

  // Неразмеченный план мешает ПУБЛИКАЦИИ, но не правке — и это разделение
  // стоило отдельного разбора на проде. Первая версия считала его предусловием
  // и выходила, не вызвав модель: кейс с четырьмя находками в плане, нулём
  // точек и шестью замечаниями рецензента не получал ничего, а человек видел
  // «изменений нет». Между тем половина замечаний там звучит как «этой находки
  // на срезе не видно, уберите её из плана и заключения» — ровно та текстовая
  // работа, которую машине делать можно и нужно.
  it("неразмеченный план не мешает правке, но не пускает в публикацию", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase({
      findings: [],
      plannedFindings: [
        { label: "consolidation", significance: "major", location: "базально слева" },
      ],
    });

    const r = await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(verifyMock).toHaveBeenCalled();
    expect(r.fixed).toBe(true);
    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/перенесите находки из плана/i);

    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.status).toBe("draft");
  });

  it("кейс «норма» — ни плана, ни разметки — предусловиям не противоречит", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase({ findings: [], plannedFindings: [] });

    const r = await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(verifyMock).toHaveBeenCalled();
    expect(r.published).toBe(true);
  });

  it("опубликованный кейс агент молча не переписывает", async () => {
    const doc = await makeCase({ status: "published" });

    const r = await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(r.stoppedBy).toBe("already_published");
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

describe("Публикация", () => {
  it("чистая рецензия при полном гейте — кейс публикуется", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(r.published).toBe(true);
    expect(r.status).toBe("published");
    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.status).toBe("published");
    expect(fresh.publishedAt).toBeTruthy();
  });

  it("перепроверка идёт СО СНИМКОМ — иначе кадр проверять некому", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase();

    await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://example.test/frame.webp" }),
    );
  });

  it("без галочки деидентификации не публикует и сам её не ставит", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase({ deidentified: false });

    const r = await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/деидентифицированн/i);
    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.deidentified).toBe(false);
    expect(fresh.status).toBe("draft");
  });

  it("оставшееся замечание блокирует публикацию и «разобранным» не становится", async () => {
    // Рецензент упирается: замечание остаётся после каждого круга.
    verifyMock.mockResolvedValue(dirtyReview());
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(false);
    expect(r.review.issues).toHaveLength(1);
    expect(r.blockers.join(" ")).toMatch(/замечани/i);

    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.status).toBe("draft");
    // Отметок «разобрано» машина не проставляет — их ставит человек.
    expect(fresh.aiReview?.dismissed ?? []).toHaveLength(0);
  });

  it("publish=false чинит текст, но публикацию оставляет человеку", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({
      caseId: doc._id,
      publish: false,
      ...AS,
    });

    expect(r.fixed).toBe(true);
    expect(r.published).toBe(false);
    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.status).toBe("draft");
  });
});

describe("Неприкосновенное", () => {
  it("координаты и кадр находки остаются такими, какими их поставил человек", async () => {
    // Редактор «правит» значимость и пояснение — текстовую часть, на которую
    // он имеет право, — и заодно пытается вернуть находку в план.
    verifyMock.mockResolvedValueOnce(dirtyReview()).mockResolvedValue(cleanReview());
    reviseMock.mockImplementation(({ draft }) => ({
      draft: {
        ...draft,
        plannedFindings: [
          {
            label: "pneumothorax",
            significance: "critical",
            location: "правое лёгочное поле",
            explanation: "Пропуск напряжённого пневмоторакса смертелен",
          },
        ],
      },
      changes: [{ field: "plannedFindings", what: "значимость" }],
      disputed: [],
      usage: { inputTokens: 5, outputTokens: 5 },
    }));

    const doc = await makeCase();
    await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.findings).toHaveLength(1);
    expect(fresh.findings[0].geometry.coords).toEqual({ x: 0.31, y: 0.22 });
    expect(fresh.findings[0].imageIndex).toBe(0);
    // Текстовая часть той же находки — обновлена.
    expect(fresh.findings[0].significance).toBe("critical");
    // Уже размеченная находка не должна продублироваться в плане «что разметить».
    expect(fresh.plannedFindings).toHaveLength(0);
    expect(fresh.images).toHaveLength(1);
  });

  it("прогон записывается в кейс: видно, кто и сколько кругов правил", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeCase();

    await runRadiologyCaseAgent({ caseId: doc._id, ...AS });

    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.aiRevision?.revisedAt).toBeTruthy();
    expect(String(fresh.aiRevision?.actorId)).toBe(String(ACTOR));
  });
});
