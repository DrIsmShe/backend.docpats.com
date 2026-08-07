// __tests__/radiology/dailyAutogen.test.js
//
// Ночная автогенерация кейсов лучевой станции (jobs/radiologyDailyCases.job.js)
// и удаление кейса насовсем.
//
// Модель здесь замокана целиком: тест проверяет обвязку — по кейсу на
// модальность, неповторяющиеся темы, потолок очереди, живучесть при отказе
// одной модальности, — а не качество медицинского текста. Реальный вызов
// стоил бы денег и зависел бы от сети.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const generateRadiologyCase = vi.fn();
const generateLabCase = vi.fn();
const generateVpCase = vi.fn();
vi.mock("../../modules/radiology/ai/caseGenerator.js", () => ({
  generateRadiologyCase: (...args) => generateRadiologyCase(...args),
  generateLabCase: (...args) => generateLabCase(...args),
  generateVpCase: (...args) => generateVpCase(...args),
  isConfigured: () => true,
}));

// Второй проход (рецензент). По умолчанию — «чисто»: так проверяется, что
// станции без снимков доходят до публикации сами.
const verifyResult = vi.fn(async () => ({
  verdict: "clean",
  issues: [],
  errorCount: 0,
  summary: "Кейс согласован",
}));
vi.mock("../../modules/radiology/ai/caseVerifier.js", () => ({
  verifyRadiologyCase: (...args) => verifyResult(...args),
  verifyLabCase: (...args) => verifyResult(...args),
  verifyVpCase: (...args) => verifyResult(...args),
}));

// Публикация кейса ставит в очередь перевод на остальные языки — в тесте
// это ушло бы РЕАЛЬНЫМ вызовом модели уже после завершения теста.
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

import RadiologyCase from "../../modules/radiology/radiology-cases/models/radiologyCase.model.js";
import RadiologyAttempt from "../../modules/radiology/radiology-attempts/models/radiologyAttempt.model.js";
import LabCase from "../../modules/radiology/labs-station/models/labCase.model.js";
import VirtualPatientCase from "../../modules/radiology/virtual-patient/models/vpCase.model.js";
import {
  runDailyCaseGeneration,
  startDailyCaseGeneration,
  stopDailyCaseGeneration,
  getAutogenState,
} from "../../jobs/radiologyDailyCases.job.js";
import { deleteCasePermanently } from "../../modules/radiology/radiology-cases/services/case.service.js";
import { deleteLabCasePermanently } from "../../modules/radiology/labs-station/lab.service.js";
import { pickTopic, topicsFor } from "../../modules/radiology/ai/dailyTopics.js";

// Пауза между модальностями в тестах не нужна — иначе прогон стоил бы секунд
// ожидания на ровном месте.
process.env.RADIOLOGY_AUTOGEN_GAP_MS = "0";

const DRAFT = (over = {}) => ({
  title: "Учебный кейс",
  clinicalContext: "Мужчина 34 лет, внезапная боль в груди",
  difficulty: "medium",
  plannedFindings: [
    {
      label: "pneumothorax",
      significance: "critical",
      location: "правое лёгочное поле",
      explanation: "Виден край коллабированного лёгкого",
    },
  ],
  impression: {
    correctText: "Правосторонний пневмоторакс",
    diagnosisKeys: ["пневмоторакс"],
    diagnosisSynonyms: ["pneumothorax"],
  },
  model: "claude-test",
  ...over,
});

const LAB_DRAFT = (over = {}) => ({
  title: "Кейс анализов",
  clinicalContext: "Женщина 28 лет, слабость, обильные менструации",
  difficulty: "easy",
  panel: [
    { name: "Гемоглобин", value: "92", unit: "г/л", refRange: "120–150", significant: true },
    { name: "Ферритин", value: "4", unit: "мкг/л", refRange: "15–150", significant: true },
    { name: "Лейкоциты", value: "6.2", unit: "10⁹/л", refRange: "4–9", significant: false },
  ],
  impression: {
    correctText: "Железодефицитная анемия",
    diagnosisKeys: ["жда"],
    diagnosisSynonyms: ["железодефицитная анемия"],
  },
  model: "claude-test",
  ...over,
});

const VP_DRAFT = (over = {}) => ({
  title: "Сценарий",
  presentation: "Мужчина 22 лет, боль в правой подвздошной области",
  difficulty: "easy",
  investigations: [
    { name: "Общий анализ крови", category: "Лаборатория", resultText: "Лейкоцитоз 14", necessary: true },
    { name: "УЗИ брюшной полости", category: "Лучевая", resultText: "Аппендикс 9 мм", necessary: true },
    { name: "МРТ головного мозга", category: "Лучевая", resultText: "Без патологии", necessary: false },
  ],
  diagnosis: {
    correctText: "Острый аппендицит",
    diagnosisKeys: ["аппендицит"],
    diagnosisSynonyms: ["острый аппендицит"],
  },
  model: "claude-test",
  ...over,
});

beforeEach(() => {
  generateRadiologyCase.mockReset();
  generateLabCase.mockReset();
  generateVpCase.mockReset();
  verifyResult.mockReset();

  generateRadiologyCase.mockImplementation(async ({ topic }) =>
    DRAFT({ title: `Кейс: ${topic}` }),
  );
  generateLabCase.mockImplementation(async ({ topic }) => LAB_DRAFT({ title: `Анализы: ${topic}` }));
  generateVpCase.mockImplementation(async ({ topic }) => VP_DRAFT({ title: `ВП: ${topic}` }));
  verifyResult.mockImplementation(async () => ({
    verdict: "clean",
    issues: [],
    errorCount: 0,
    summary: "Кейс согласован",
  }));

  delete process.env.RADIOLOGY_AUTOGEN;
  delete process.env.RADIOLOGY_AUTOGEN_PUBLISH;
  delete process.env.RADIOLOGY_AUTOGEN_MAX_PENDING;
});

// Прогон только по лучевым модальностям — станции без снимков отключены.
const radiologyOnly = (modalities) => ({ modalities, stations: [] });

describe("ночная автогенерация кейсов", () => {
  it("создаёт по одному черновику на каждую модальность", async () => {
    const res = await runDailyCaseGeneration(radiologyOnly(["cxr", "ecg"]));

    expect(res.created).toHaveLength(2);
    expect(res.failed).toHaveLength(0);

    const docs = await RadiologyCase.find().lean();
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.modality).sort()).toEqual(["cxr", "ecg"]);

    for (const doc of docs) {
      // Черновик — и никак иначе: снимка нет, публиковать нечего.
      expect(doc.status).toBe("draft");
      expect(doc.images).toHaveLength(0);
      // Происхождение помечено честно, деидентификацию машина не подтверждает.
      expect(doc.source.kind).toBe("ai_generated");
      expect(doc.deidentified).toBe(false);
      // План находок доехал до базы — ради него всё и затевалось.
      expect(doc.plannedFindings).toHaveLength(1);
      expect(doc.plannedFindings[0].label).toBe("pneumothorax");
      expect(doc.plannedFindings[0].location).toBe("правое лёгочное поле");
      expect(doc.autoGen.isAuto).toBe(true);
      expect(doc.autoGen.topicKey).toBeTruthy();
      expect(doc.autoGen.model).toBe("claude-test");
    }
  });

  it("не повторяет тему на следующий день", async () => {
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    const keys = (await RadiologyCase.find({ modality: "cxr" }).lean()).map(
      (d) => d.autoGen.topicKey,
    );
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("не создаёт новый кейс, пока очередь неразобранных полна", async () => {
    process.env.RADIOLOGY_AUTOGEN_MAX_PENDING = "2";

    await runDailyCaseGeneration(radiologyOnly(["cxr"]));
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));
    const third = await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    expect(third.created).toHaveLength(0);
    expect(third.skipped[0].modality).toBe("cxr");
    expect(await RadiologyCase.countDocuments()).toBe(2);

    // Разобрали один (опубликовали — значит из очереди он ушёл): место
    // освободилось, генерация возобновляется.
    await RadiologyCase.updateOne({}, { $set: { status: "published" } });
    const fourth = await runDailyCaseGeneration(radiologyOnly(["cxr"]));
    expect(fourth.created).toHaveLength(1);
  });

  it("отказ по одной модальности не отменяет остальные", async () => {
    generateRadiologyCase.mockImplementation(async ({ modality, topic }) => {
      if (modality === "ct") throw new Error("ИИ отказался обрабатывать этот кейс");
      return DRAFT({ title: `Кейс: ${topic}` });
    });

    const res = await runDailyCaseGeneration(radiologyOnly(["cxr", "ct", "ecg"]));

    expect(res.created.map((c) => c.modality)).toEqual(["cxr", "ecg"]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].modality).toBe("ct");
    expect(await RadiologyCase.countDocuments()).toBe(2);
  });

  it("выключается через RADIOLOGY_AUTOGEN=off", async () => {
    process.env.RADIOLOGY_AUTOGEN = "off";
    const res = await runDailyCaseGeneration(radiologyOnly(["cxr"]));
    expect(res.created).toHaveLength(0);
    expect(generateRadiologyCase).not.toHaveBeenCalled();
    expect(await RadiologyCase.countDocuments()).toBe(0);
  });

  it("ручной запуск идёт в фоне и не удваивается по второму клику", async () => {
    const first = startDailyCaseGeneration();
    expect(first.running).toBe(true);
    // Кнопку нажали дважды — прогон должен остаться один и тот же.
    const second = startDailyCaseGeneration();
    expect(second.lastRun.startedAt).toBe(first.lastRun.startedAt);

    // Ждём окончания фоновой работы.
    for (let i = 0; i < 200 && getAutogenState().running; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }

    const state = getAutogenState();
    expect(state.running).toBe(false);
    expect(state.lastRun.finishedAt).toBeTruthy();
    expect(state.lastRun.error).toBeNull();
    // По кейсу на каждую из 5 модальностей + «Анализы» + «Виртуальный пациент».
    expect(state.lastRun.created).toHaveLength(7);
    expect(await RadiologyCase.countDocuments()).toBe(5);
    expect(await LabCase.countDocuments()).toBe(1);
    expect(await VirtualPatientCase.countDocuments()).toBe(1);
  });

  it("после прохождения всей программы идёт на второй круг с оговоркой", () => {
    const pool = topicsFor("cxr");
    const allUsed = pool.map((t) => t.key);

    const first = pickTopic("cxr", [], 0);
    expect(first.repeat).toBe(false);

    const again = pickTopic("cxr", allUsed, 3);
    expect(again.repeat).toBe(true);
    expect(again.key).toBe(pool[3 % pool.length].key);
  });
});

describe("станции без снимков: полный цикл до публикации", () => {
  it("публикует «Анализы» и «Виртуального пациента», когда рецензент не нашёл замечаний", async () => {
    const res = await runDailyCaseGeneration({ modalities: [], stations: ["labs", "vp"] });

    expect(res.created).toHaveLength(2);
    expect(res.created.every((c) => c.published)).toBe(true);

    const lab = await LabCase.findOne().lean();
    expect(lab.status).toBe("published");
    expect(lab.publishedAt).toBeTruthy();
    expect(lab.autoGen.isAuto).toBe(true);
    expect(lab.autoGen.autoPublished).toBe(true);
    expect(lab.source.kind).toBe("ai_generated");
    // Ключи панели проставлены, а эталон собран из флага significant.
    expect(lab.panel.map((p) => p.key)).toEqual(["p1", "p2", "p3"]);
    expect(lab.significantAbnormal).toEqual(["p1", "p2"]);

    const vp = await VirtualPatientCase.findOne().lean();
    expect(vp.status).toBe("published");
    expect(vp.investigations.map((i) => i.key)).toEqual(["i1", "i2", "i3"]);
    expect(vp.investigations.filter((i) => i.necessary)).toHaveLength(2);
  });

  it("оставляет черновиком, если рецензент нашёл хоть одно замечание", async () => {
    verifyResult.mockImplementation(async () => ({
      verdict: "issues",
      errorCount: 0,
      summary: "Есть вопрос к референсу",
      issues: [
        {
          target: "Ферритин",
          severity: "warning",
          issue: "Референсный интервал спорный",
          suggestion: "Уточнить по лаборатории",
        },
      ],
    }));

    const res = await runDailyCaseGeneration({ modalities: [], stations: ["labs"] });

    expect(res.created[0].published).toBe(false);
    const lab = await LabCase.findOne().lean();
    expect(lab.status).toBe("draft");
    expect(lab.autoGen.autoPublished).toBe(false);
    // Замечание сохранено в кейсе — гейт публикации держит его сам, и человек
    // увидит его, открыв черновик.
    expect(lab.aiReview.issues).toHaveLength(1);
  });

  it("не публикует ничего при RADIOLOGY_AUTOGEN_PUBLISH=off", async () => {
    process.env.RADIOLOGY_AUTOGEN_PUBLISH = "off";

    await runDailyCaseGeneration({ modalities: [], stations: ["labs", "vp"] });

    expect((await LabCase.findOne().lean()).status).toBe("draft");
    expect((await VirtualPatientCase.findOne().lean()).status).toBe("draft");
  });

  it("лучевой кейс не публикуется автоматически даже при чистой рецензии", async () => {
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    const doc = await RadiologyCase.findOne().lean();
    expect(doc.status).toBe("draft");
    expect(doc.autoGen.autoPublished).toBeFalsy();
    // Галочку деидентификации машина не ставит: снимка ещё нет.
    expect(doc.deidentified).toBe(false);
    expect(doc.images).toHaveLength(0);
  });

  it("отказ рецензента не отменяет кейс — он просто ждёт человека", async () => {
    verifyResult.mockImplementation(async () => {
      throw new Error("ИИ временно недоступен");
    });

    const res = await runDailyCaseGeneration({ modalities: [], stations: ["labs"] });

    expect(res.failed).toHaveLength(0);
    expect(res.created[0].published).toBe(false);
    expect((await LabCase.findOne().lean()).status).toBe("draft");
  });
});

describe("удаление кейса насовсем", () => {
  async function makeAutoCase(over = {}) {
    const [doc] = await RadiologyCase.create([
      {
        modality: "cxr",
        title: "Автокейс",
        source: { kind: "ai_generated" },
        status: "draft",
        autoGen: { isAuto: true, topicKey: "cxr_pneumothorax" },
        ...over,
      },
    ]);
    return doc;
  }

  it("стирает черновик без следа", async () => {
    const doc = await makeAutoCase();
    const out = await deleteCasePermanently(doc._id, null, "admin");

    expect(out.deleted).toBe(true);
    expect(await RadiologyCase.findById(doc._id)).toBeNull();
  });

  it("не трогает опубликованный кейс", async () => {
    const doc = await makeAutoCase({ status: "published" });
    await expect(deleteCasePermanently(doc._id, null, "admin")).rejects.toThrow(
      /архив/i,
    );
    expect(await RadiologyCase.findById(doc._id)).not.toBeNull();
  });

  it("работает и для станции «Анализы»", async () => {
    const doc = await LabCase.create({
      title: "Автокейс анализов",
      source: { kind: "ai_generated" },
      status: "draft",
      panel: [{ key: "p1", name: "Гемоглобин", value: "92" }],
      autoGen: { isAuto: true, topicKey: "lab_ida" },
    });

    const out = await deleteLabCasePermanently(doc._id, null, "admin");
    expect(out.deleted).toBe(true);
    expect(await LabCase.findById(doc._id)).toBeNull();
  });

  it("не трогает кейс, по которому есть попытки врачей", async () => {
    const doc = await makeAutoCase({ status: "archived" });
    await RadiologyAttempt.create({
      caseId: doc._id,
      userId: new mongoose.Types.ObjectId(),
      mode: "exam",
      status: "submitted",
    });

    await expect(deleteCasePermanently(doc._id, null, "admin")).rejects.toThrow(
      /попытки/i,
    );
    expect(await RadiologyCase.findById(doc._id)).not.toBeNull();
  });
});

// ─── Управление прогоном из админки ──────────────────────────────────
//
// Владелец должен уметь запустить генерацию по одному разделу и остановить
// её, не дожидаясь конца. Раньше кнопка была одна и на всё сразу: чтобы
// получить два лабораторных кейса, приходилось заводить и пять лучевых
// черновиков, каждый из которых потом ждёт человека с холстом.

describe("управление автогенерацией", () => {
  it("раздел «анализы» не создаёт лучевых черновиков", async () => {
    const res = await runDailyCaseGeneration({ stations: ["labs"], modalities: [] });

    expect(res.created.every((c) => c.station !== "radiology")).toBe(true);
    expect(await RadiologyCase.countDocuments()).toBe(0);
    expect(await LabCase.countDocuments()).toBeGreaterThan(0);
  });

  it("раздел «снимки» не трогает станции без изображений", async () => {
    const res = await runDailyCaseGeneration({
      modalities: ["cxr"],
      stations: [],
    });

    expect(res.created).toHaveLength(1);
    expect(await LabCase.countDocuments()).toBe(0);
    expect(await VirtualPatientCase.countDocuments()).toBe(0);
  });

  it("состояние прогона называет запущенный раздел", async () => {
    const state = startDailyCaseGeneration({ scope: "labs" });

    // Прогон уходит в фон — здесь важно лишь то, что раздел зафиксирован и
    // виден админке, которая по нему подсвечивает свою кнопку.
    expect(state.running).toBe(true);
    expect(state.scope).toBe("labs");
    expect(state.stopping).toBe(false);
  });

  it("повторный запуск во время работы не начинает второй прогон", async () => {
    const first = startDailyCaseGeneration({ scope: "labs" });
    const second = startDailyCaseGeneration({ scope: "vp" });

    // Второй запрос обязан вернуть состояние ПЕРВОГО прогона: иначе двойной
    // клик удвоил бы и счёт за токены, и число черновиков.
    expect(first.running).toBe(true);
    expect(second.scope).toBe("labs");
  });

  it("остановка помечается сразу, до фактического обрыва", async () => {
    startDailyCaseGeneration({ scope: "all" });
    const state = stopDailyCaseGeneration();

    // Признак нужен именно немедленный: начатый кейс ещё доделывается, и без
    // отметки кнопка выглядела бы нажатой впустую.
    expect(state.stopping).toBe(true);
  });

  it("остановка без работающего прогона ничего не ломает", async () => {
    // Ждём, пока фоновые прогоны предыдущих проверок завершатся.
    await new Promise((r) => setTimeout(r, 50));
    const state = stopDailyCaseGeneration();
    expect(state.stopping).toBe(false);
  });
});
