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
//   3. замечание, которое агент НЕ разобрал, блокирует публикацию. Разобрать
//      он теперь может — судьёй (ai/issueAdjudicator.js), — но только с
//      письменным обоснованием на каждое закрытое замечание, и замечание,
//      признанное верным, публикацию по-прежнему держит.
//
// Плюс предусловия: пока снимка нет, модель не вызывается вовсе — каждый круг
// цикла стоит двух вызовов Opus с рассуждением.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { verifyMock, reviseMock, adjudicateMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  reviseMock: vi.fn(),
  adjudicateMock: vi.fn(),
}));

// Мок отдаёт ВСЕ экспорты модуля, а не только лучевой: агент импортирует
// рецензентов и редакторов всех трёх станций, а vitest подменяет модуль
// целиком и на недостающий экспорт бросает при первом обращении.
vi.mock("../../modules/radiology/ai/caseVerifier.js", () => ({
  verifyRadiologyCase: verifyMock,
  verifyLabCase: verifyMock,
  verifyVpCase: verifyMock,
}));
vi.mock("../../modules/radiology/ai/caseReviser.js", () => ({
  reviseRadiologyCase: reviseMock,
  reviseLabCase: reviseMock,
  reviseVpCase: reviseMock,
}));
// Судья мокается обязательно: __tests__/setup.js тянет dotenv, и в .env лежит
// НАСТОЯЩИЙ ANTHROPIC_API_KEY. Незамоканный судья ходил бы в платный API на
// каждом прогоне тестов — и уже сходил, пока этого мока не было.
vi.mock("../../modules/radiology/ai/issueAdjudicator.js", () => ({
  adjudicateIssues: adjudicateMock,
}));
// Переводчик — по той же причине: публикация ставит перевод на четыре языка,
// а агент его теперь ДОЖИДАЕТСЯ, то есть без мока это четыре реальных вызова
// модели на каждый тест с публикацией.
vi.mock("../../modules/radiology/translation/caseTranslator.js", () => ({
  PROMPT_VERSION: "test",
  MODEL: "test-model",
  translateCaseContent: vi.fn(async ({ fields }) => ({
    fields: Object.fromEntries(
      Object.entries(fields ?? {}).map(([path, text]) => [path, `[tr] ${text}`]),
    ),
    diagnosisKeys: [],
    diagnosisSynonyms: [],
    model: "test-model",
    promptVersion: "test",
  })),
}));

const { runRadiologyCaseAgent, runLabCaseAgent, runVpCaseAgent } = await import(
  "../../modules/radiology/ai/caseAgent.js"
);
const { default: RadiologyCase } = await import(
  "../../modules/radiology/radiology-cases/models/radiologyCase.model.js"
);
const { default: LabCase } = await import(
  "../../modules/radiology/labs-station/models/labCase.model.js"
);
const { default: VirtualPatientCase } = await import(
  "../../modules/radiology/virtual-patient/models/vpCase.model.js"
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

/** Судья, который признаёт ВСЕ замечания верными: публикация остаётся закрытой. */
const allFounded = ({ issues }) => ({
  verdicts: issues.map((_, index) => ({
    index,
    founded: true,
    why: "Настоящая ошибка",
  })),
  usage: { inputTokens: 5, outputTokens: 5 },
  model: "test",
});

/** Судья, который отвергает ВСЕ замечания: публикация открывается. */
const allUnfounded = ({ issues }) => ({
  verdicts: issues.map((_, index) => ({
    index,
    founded: false,
    why: "Рецензент требует данных, которых учебный кейс не обязан содержать",
  })),
  usage: { inputTokens: 5, outputTokens: 5 },
  model: "test",
});

beforeEach(() => {
  verifyMock.mockReset();
  reviseMock.mockReset();
  adjudicateMock.mockReset();
  reviseMock.mockImplementation(passthroughReviser);
  // По умолчанию — строгий судья. Тест, который проверяет закрытие замечаний,
  // подменяет его явно: так «опубликовалось» не может случиться по недосмотру.
  adjudicateMock.mockImplementation(allFounded);
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

  it("замечание, признанное судьёй ВЕРНЫМ, блокирует публикацию", async () => {
    // Рецензент упирается: замечание остаётся после каждого круга, и судья с
    // ним согласен. Это ровно тот случай, ради которого гейт и стоит.
    verifyMock.mockResolvedValue(dirtyReview());
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(false);
    expect(r.review.issues).toHaveLength(1);
    expect(r.blockers.join(" ")).toMatch(/замечани/i);
    expect(r.unresolvedFounded).toHaveLength(1);
    expect(r.resolvedByAgent).toHaveLength(0);

    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.status).toBe("draft");
    // Верное замечание «разобранным» не становится ни при каких условиях.
    expect(fresh.aiReview?.dismissed ?? []).toHaveLength(0);
  });

  it("замечание, признанное НЕВЕРНЫМ, закрывается с обоснованием и кейс уходит в публикацию", async () => {
    verifyMock.mockResolvedValue(dirtyReview());
    adjudicateMock.mockImplementation(allUnfounded);
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(true);
    expect(r.resolvedByAgent).toHaveLength(1);
    expect(r.resolvedByAgent[0].why).toMatch(/учебный кейс/i);

    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.status).toBe("published");
    // Обоснование обязано остаться в кейсе: по нему человек проверяет машину.
    expect(fresh.aiReview.agentResolved).toHaveLength(1);
    expect(fresh.aiReview.agentResolved[0].why).toBeTruthy();
    expect(fresh.aiReview.dismissed).toEqual([0]);
  });

  it("закрытие без обоснования не принимается — замечание остаётся открытым", async () => {
    verifyMock.mockResolvedValue(dirtyReview());
    // Судья отверг замечание, но обосновать не смог. Молчаливое «пропустить»
    // и есть то, чем закрытие замечаний машиной могло бы выродиться.
    adjudicateMock.mockImplementation(({ issues }) => ({
      verdicts: issues.map((_, index) => ({ index, founded: false, why: "" })),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "test",
    }));
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(false);
    const fresh = await RadiologyCase.findById(doc._id).lean();
    expect(fresh.aiReview?.dismissed ?? []).toHaveLength(0);
    expect(fresh.status).toBe("draft");
  });

  it("resolveIssues=false — судья не зовётся, замечания остаются человеку", async () => {
    verifyMock.mockResolvedValue(dirtyReview());
    adjudicateMock.mockImplementation(allUnfounded);
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({
      caseId: doc._id,
      maxRounds: 2,
      resolveIssues: false,
      ...AS,
    });

    expect(adjudicateMock).not.toHaveBeenCalled();
    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/замечани/i);
  });

  it("сбой судьи не публикует кейс и виден в отчёте", async () => {
    verifyMock.mockResolvedValue(dirtyReview());
    adjudicateMock.mockRejectedValue(new Error("модель недоступна"));
    const doc = await makeCase();

    const r = await runRadiologyCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(false);
    expect(r.stoppedBy).toBe("adjudication_failed");
    expect(r.adjudicationError).toMatch(/недоступна/);
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

/* ══════════════════════════════════════════════════════════════════════════
   АНАЛИЗЫ И ВИРТУАЛЬНЫЙ ПАЦИЕНТ
   ══════════════════════════════════════════════════════════════════════════ */

// У этих станций весь кейс — текст, поэтому агент доводит их до публикации
// целиком. Проверяется то же, что у лучевой: гейт не обходится, а ключи строк
// не сдвигаются. Ключ здесь важнее всего — на него завязаны эталон, числовые
// варианты и разборы уже сданных попыток, и «переименовать» показатель молча
// значит получить кейс, который выглядит целым, но оценивает неверно.

async function makeLabCase(extra = {}) {
  return LabCase.create({
    title: "Железодефицитная анемия",
    clinicalContext: "Женщина 34 лет, слабость",
    panel: [
      { key: "p1", name: "Гемоглобин", value: "92", unit: "г/л", refRange: "120–150" },
      { key: "p2", name: "Ферритин", value: "6", unit: "нг/мл", refRange: "15–150" },
    ],
    significantAbnormal: ["p1", "p2"],
    impression: { correctText: "ЖДА", diagnosisKeys: ["железодефицитная анемия"] },
    source: { kind: "ai_generated" },
    status: "draft",
    ...extra,
  });
}

async function makeVpCase(extra = {}) {
  return VirtualPatientCase.create({
    title: "Острый аппендицит",
    presentation: "Мужчина 22 лет, боль в правой подвздошной области",
    investigations: [
      { key: "i1", name: "Общий анализ крови", category: "Лаборатория", necessary: true },
      { key: "i2", name: "УЗИ брюшной полости", category: "Лучевая", necessary: true },
    ],
    diagnosis: { correctText: "Острый аппендицит", diagnosisKeys: ["аппендицит"] },
    source: { kind: "ai_generated" },
    status: "draft",
    ...extra,
  });
}

describe("Анализы", () => {
  it("чистая рецензия — кейс публикуется", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeLabCase();

    const r = await runLabCaseAgent({ caseId: doc._id, ...AS });

    expect(r.station).toBe("labs");
    expect(r.published).toBe(true);
    const fresh = await LabCase.findById(doc._id).lean();
    expect(fresh.status).toBe("published");
    expect(fresh.publishedAt).toBeTruthy();
  });

  it("ключи показателей переживают правку — на них держится эталон", async () => {
    verifyMock.mockResolvedValueOnce(dirtyReview()).mockResolvedValue(cleanReview());
    // Редактор правит референс, ключей он не видит и не возвращает.
    reviseMock.mockImplementation(({ draft }) => ({
      draft: {
        ...draft,
        panel: draft.panel.map((p) =>
          p.name === "Ферритин" ? { ...p, refRange: "10–120" } : p,
        ),
      },
      changes: [{ target: "Ферритин", change: "15–150 → 10–120", why: "по замечанию" }],
      disputed: [],
      usage: { inputTokens: 5, outputTokens: 5 },
    }));

    const doc = await makeLabCase();
    await runLabCaseAgent({ caseId: doc._id, ...AS });

    const fresh = await LabCase.findById(doc._id).lean();
    expect(fresh.panel.map((p) => p.key)).toEqual(["p1", "p2"]);
    expect(fresh.panel.find((p) => p.name === "Ферритин").refRange).toBe("10–120");
    expect(fresh.significantAbnormal).toEqual(["p1", "p2"]);
  });

  it("гейт не обходится: без принятого диагноза публикации нет", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeLabCase({
      impression: { correctText: "ЖДА", diagnosisKeys: [] },
    });

    const r = await runLabCaseAgent({ caseId: doc._id, ...AS });

    expect(r.fixed).toBe(true);
    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/диагноз/i);
    const fresh = await LabCase.findById(doc._id).lean();
    expect(fresh.status).toBe("draft");
  });

  it("замечание, признанное судьёй верным, блокирует публикацию", async () => {
    verifyMock.mockResolvedValue(dirtyReview());
    const doc = await makeLabCase();

    const r = await runLabCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/замечани/i);
  });

  it("неверное замечание закрывается, кейс публикуется и уходит в перевод", async () => {
    verifyMock.mockResolvedValue(dirtyReview());
    adjudicateMock.mockImplementation(allUnfounded);
    const doc = await makeLabCase();

    const r = await runLabCaseAgent({ caseId: doc._id, maxRounds: 2, ...AS });

    expect(r.published).toBe(true);
    expect(r.resolvedByAgent).toHaveLength(1);
    // Перевод агент ДОЖИДАЕТСЯ и отчитывается о нём: молча провалившийся
    // перевод и оставлял кейсы без языков.
    expect(r.translation).toBeTruthy();

    const fresh = await LabCase.findById(doc._id).lean();
    expect(fresh.status).toBe("published");
    expect(fresh.aiReview.agentResolved[0].why).toBeTruthy();
  });

  it("пустая панель — модель не вызывается", async () => {
    const doc = await makeLabCase({ panel: [], significantAbnormal: [] });

    const r = await runLabCaseAgent({ caseId: doc._id, ...AS });

    expect(verifyMock).not.toHaveBeenCalled();
    expect(r.stoppedBy).toBe("prerequisites");
  });
});

describe("Виртуальный пациент", () => {
  it("чистая рецензия — сценарий публикуется", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeVpCase();

    const r = await runVpCaseAgent({ caseId: doc._id, ...AS });

    expect(r.station).toBe("vp");
    expect(r.published).toBe(true);
    const fresh = await VirtualPatientCase.findById(doc._id).lean();
    expect(fresh.status).toBe("published");
  });

  it("ключи обследований переживают правку", async () => {
    verifyMock.mockResolvedValueOnce(dirtyReview()).mockResolvedValue(cleanReview());
    reviseMock.mockImplementation(({ draft }) => ({
      draft: {
        ...draft,
        investigations: draft.investigations.map((i) =>
          i.name === "УЗИ брюшной полости"
            ? { ...i, resultText: "Аппендикс 9 мм, несжимаемый" }
            : i,
        ),
      },
      changes: [{ target: "УЗИ", change: "добавлен результат", why: "по замечанию" }],
      disputed: [],
      usage: { inputTokens: 5, outputTokens: 5 },
    }));

    const doc = await makeVpCase();
    await runVpCaseAgent({ caseId: doc._id, ...AS });

    const fresh = await VirtualPatientCase.findById(doc._id).lean();
    expect(fresh.investigations.map((i) => i.key)).toEqual(["i1", "i2"]);
    expect(fresh.investigations.find((i) => i.name === "УЗИ брюшной полости").resultText)
      .toBe("Аппендикс 9 мм, несжимаемый");
    // Эталон «нужное обследование» не должен потеряться при правке.
    expect(fresh.investigations.filter((i) => i.necessary)).toHaveLength(2);
  });

  it("гейт не обходится: без отмеченного нужного обследования публикации нет", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeVpCase({
      investigations: [
        { key: "i1", name: "Общий анализ крови", category: "Лаборатория", necessary: false },
        { key: "i2", name: "УЗИ брюшной полости", category: "Лучевая", necessary: false },
      ],
    });

    const r = await runVpCaseAgent({ caseId: doc._id, ...AS });

    expect(r.published).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/нужное обследование/i);
  });

  it("publish=false правит, но публикацию оставляет человеку", async () => {
    verifyMock.mockResolvedValue(cleanReview());
    const doc = await makeVpCase();

    const r = await runVpCaseAgent({ caseId: doc._id, publish: false, ...AS });

    expect(r.fixed).toBe(true);
    expect(r.published).toBe(false);
    const fresh = await VirtualPatientCase.findById(doc._id).lean();
    expect(fresh.status).toBe("draft");
  });
});
