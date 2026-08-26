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

// Поиск снимков-кандидатов идёт в интернет через веб-поиск модели. В тесте
// это не только медленно, но и недетерминированно: выдача меняется день ото
// дня. Мок отдаёт одну заведомую находку — проверяем, что ссылки доходят до
// кейса, а не то, что именно нашлось в сети.
const foundImages = vi.fn(async () => ({
  sources: [
    {
      url: "https://radiopaedia.org/cases/test-1",
      site: "Radiopaedia",
      title: "Тестовый случай",
      whatIsShown: "КТ, коронарная проекция",
      license: "CC BY-NC-SA 3.0",
      commercialUse: "no",
      match: "close",
      matchNote: "",
    },
  ],
  advice: "проверьте лицензию",
  model: "test-model",
}));
vi.mock("../../modules/radiology/ai/imageSourceFinder.js", () => ({
  findCaseImageSources: (...args) => foundImages(...args),
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

// Третий проход (редактор). Замечания рецензента больше не означают «кейс
// ждёт человека»: сначала машина пробует их исправить и перепроверить себя.
// По умолчанию правка тут ничего не меняет — так проверяется, что кейс,
// который не удалось довести, остаётся честным черновиком.
const reviseResult = vi.fn(async ({ draft }) => ({
  draft,
  changes: [{ target: "Ферритин", change: "уточнён референс", why: "по замечанию" }],
  disputed: [],
}));
vi.mock("../../modules/radiology/ai/caseReviser.js", () => ({
  // reviseRadiologyCase обязателен в моке, даже если тест его не дёргает:
  // vitest отдаёт мок через Proxy и на отсутствующий экспорт бросает при
  // ПЕРВОМ обращении. Пропустив его здесь, мы получили бы падение не там, где
  // ошибка, а там, где у лучевого автокейса впервые оказались замечания.
  reviseRadiologyCase: (...args) => reviseResult(...args),
  reviseLabCase: (...args) => reviseResult(...args),
  reviseVpCase: (...args) => reviseResult(...args),
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
  getAutogenFullState,
  setNightlyAutogen,
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
  reviseResult.mockReset();
  reviseResult.mockImplementation(async ({ draft }) => ({
    draft,
    changes: [{ target: "Ферритин", change: "уточнён референс", why: "по замечанию" }],
    disputed: [],
  }));

  delete process.env.RADIOLOGY_AUTOGEN;
  delete process.env.RADIOLOGY_AUTOGEN_PUBLISH;
  delete process.env.RADIOLOGY_AUTOGEN_AUTOFIX;
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

  // Замечание, которое возвращает рецензент во всех проверках ниже.
  const ISSUE_REVIEW = {
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
  };

  it("оставляет черновиком, если замечание пережило автоправку", async () => {
    // Рецензент возражает и после правки: цикл упирается в «нет прогресса»,
    // и кейс честно ждёт человека — ровно как до появления третьего прохода.
    verifyResult.mockImplementation(async () => ISSUE_REVIEW);

    const res = await runDailyCaseGeneration({ modalities: [], stations: ["labs"] });

    expect(res.created[0].published).toBe(false);
    const lab = await LabCase.findOne().lean();
    expect(lab.status).toBe("draft");
    expect(lab.autoGen.autoPublished).toBe(false);
    // Замечание сохранено в кейсе — гейт публикации держит его сам, и человек
    // увидит его, открыв черновик.
    expect(lab.aiReview.issues).toHaveLength(1);
    expect(lab.aiRevision.converged).toBe(false);
    expect(lab.aiRevision.stoppedBy).toBe("no_progress");
  });

  it("исправляет замечание третьим проходом и доводит кейс до публикации", async () => {
    // Первая рецензия — с замечанием, вторая (уже исправленной версии) —
    // чистая. Гейт публикации при этом не обходится: считать нечего.
    let call = 0;
    verifyResult.mockImplementation(async () => {
      call += 1;
      return call === 1
        ? ISSUE_REVIEW
        : { verdict: "clean", issues: [], errorCount: 0, summary: "Согласовано" };
    });
    reviseResult.mockImplementation(async ({ draft }) => ({
      draft: {
        ...draft,
        panel: draft.panel.map((p) =>
          p.name === "Ферритин" ? { ...p, refRange: "10–120" } : p,
        ),
      },
      changes: [{ target: "Ферритин", change: "15–150 → 10–120", why: "по замечанию" }],
      disputed: [],
    }));

    const res = await runDailyCaseGeneration({ modalities: [], stations: ["labs"] });

    expect(res.created[0].published).toBe(true);
    expect(res.created[0].fixRounds).toBe(1);

    const lab = await LabCase.findOne().lean();
    expect(lab.status).toBe("published");
    expect(lab.autoGen.autoPublished).toBe(true);
    // В базе лежит ИСПРАВЛЕННАЯ версия, и рецензия относится к ней же.
    expect(lab.panel.find((p) => p.name === "Ферритин").refRange).toBe("10–120");
    expect(lab.aiReview.issues).toHaveLength(0);
    // Ключи панели правка не сдвинула — на них завязан эталон.
    expect(lab.panel.map((p) => p.key)).toEqual(["p1", "p2", "p3"]);
    expect(lab.significantAbnormal).toEqual(["p1", "p2"]);
    // След правки виден человеку, который откроет кейс.
    expect(lab.aiRevision.converged).toBe(true);
    expect(lab.aiRevision.rounds).toBe(1);
    expect(lab.aiRevision.changes[0].change).toBe("15–150 → 10–120");
  });

  // ЛУЧЕВАЯ СТАНЦИЯ ТОЖЕ ПОЛУЧАЕТ ТРЕТИЙ ПРОХОД.
  //
  // Публиковать её кейсы машина по-прежнему не может — снимка не существует, а
  // гейт требует настоящий кадр. Но это никогда не было причиной оставлять
  // текст неисправленным: автор должен получать черновик с разобранными
  // противоречиями, а не кейс плюс список замечаний к нему.
  //
  // Тест держит обе половины утверждения сразу: правка ПРОШЛА и публикации НЕ
  // случилось. Ослабнуть может любая из них, и вторая опаснее.
  it("лучевой автокейс правится третьим проходом, но публикацию всё равно ждёт от человека", async () => {
    let call = 0;
    verifyResult.mockImplementation(async () => {
      call += 1;
      return call === 1
        ? ISSUE_REVIEW
        : { verdict: "clean", issues: [], errorCount: 0, summary: "Согласовано" };
    });
    reviseResult.mockImplementation(async ({ draft }) => ({
      draft: { ...draft, clinicalContext: "Уточнённый анамнез" },
      changes: [{ target: "Контекст", change: "уточнён", why: "по замечанию" }],
      disputed: [],
    }));

    const res = await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    expect(reviseResult).toHaveBeenCalled();
    expect(res.created[0].published).toBe(false);

    const doc = await RadiologyCase.findOne().lean();
    expect(doc.status).toBe("draft");
    expect(doc.clinicalContext).toBe("Уточнённый анамнез");
    expect(doc.aiReview.issues).toHaveLength(0);
    expect(doc.aiRevision.converged).toBe(true);
    // Галочку деидентификации ночной прогон не ставит и поставить не может.
    expect(doc.deidentified).toBe(false);
  });

  it("при RADIOLOGY_AUTOGEN_AUTOFIX=off правка не запускается", async () => {
    process.env.RADIOLOGY_AUTOGEN_AUTOFIX = "off";
    verifyResult.mockImplementation(async () => ISSUE_REVIEW);

    await runDailyCaseGeneration({ modalities: [], stations: ["labs"] });

    expect(reviseResult).not.toHaveBeenCalled();
    const lab = await LabCase.findOne().lean();
    expect(lab.status).toBe("draft");
    expect(lab.aiRevision.revisedAt).toBeFalsy();
  });

  it("сбой редактора не отменяет кейс — остаётся черновик с исходными замечаниями", async () => {
    verifyResult.mockImplementation(async () => ISSUE_REVIEW);
    reviseResult.mockImplementation(async () => {
      throw new Error("ИИ временно недоступен");
    });

    const res = await runDailyCaseGeneration({ modalities: [], stations: ["labs"] });

    expect(res.failed).toHaveLength(0);
    const lab = await LabCase.findOne().lean();
    expect(lab.status).toBe("draft");
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

// ─── Где взять снимок под сгенерированный кейс ───────────────────────
//
// Кейс придумывается по ТЕМЕ: изображения в момент генерации не существует, и
// ссылки «на снимок, по которому сделан кейс», взяться неоткуда. Именно на
// этом работа и вставала — текст готов, а кадра нет и найти его вручную
// дольше, чем написать кейс заново. Поэтому кандидаты ищутся сразу и ложатся
// в сам черновик.

describe("снимки-кандидаты в автокейсе", () => {
  it("ссылки сохраняются в кейс при генерации", async () => {
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    const doc = await RadiologyCase.findOne({ "autoGen.isAuto": true }).lean();
    expect(doc.imageSources).toHaveLength(1);
    expect(doc.imageSources[0].url).toMatch(/^https:\/\//);
    expect(doc.imageSearchAdvice).toBeTruthy();
    expect(doc.imageSearchAt).toBeTruthy();
  });

  it("пригодность лицензии сохраняется вместе со ссылкой", async () => {
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    const doc = await RadiologyCase.findOne({ "autoGen.isAuto": true }).lean();
    // Продукт коммерческий: CC BY-NC помечается как непригодная, и это
    // должно доехать до автора, а не потеряться по дороге.
    expect(doc.imageSources[0].commercialUse).toBe("no");
    expect(doc.imageSources[0].license).toMatch(/CC BY-NC/);
  });

  it("отказ поиска не отменяет создание кейса", async () => {
    foundImages.mockRejectedValueOnce(new Error("сеть недоступна"));

    const res = await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    // Кейс без ссылок хуже кейса со ссылками, но несравнимо лучше, чем
    // отсутствие кейса из-за сбоя поиска.
    expect(res.created).toHaveLength(1);
    const doc = await RadiologyCase.findOne({ "autoGen.isAuto": true }).lean();
    expect(doc.imageSources).toHaveLength(0);
  });

  it("поиск идёт по теме кейса и его модальности", async () => {
    foundImages.mockClear();
    await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    expect(foundImages).toHaveBeenCalledWith(
      expect.objectContaining({ modality: "cxr", topic: expect.any(String) }),
    );
  });
});

// ─── Выключатель ночной генерации ────────────────────────────────────
//
// Отдельная сущность от остановки прогона: та прерывает то, что идёт сейчас,
// и действует один раз. Этот выключатель решает, будет ли генерация ночью,
// и держится, пока его не отменят.
//
// Хранится в базе намеренно. Флаг в памяти процесса умирает вместе с
// перезапуском, и генерация, выключенная вечером, сама ожила бы ночью после
// любого рестарта — счёт пришёл бы за то, что считалось отключённым.

describe("выключатель ночной генерации", () => {
  it("по умолчанию включена", async () => {
    const state = await getAutogenFullState();
    expect(state.nightlyEnabled).toBe(true);
  });

  it("выключение останавливает прогон целиком", async () => {
    await setNightlyAutogen(false);

    const res = await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    expect(res.disabled).toBe(true);
    expect(res.created).toHaveLength(0);
    expect(await RadiologyCase.countDocuments()).toBe(0);
  });

  it("включение возвращает генерацию", async () => {
    await setNightlyAutogen(false);
    await setNightlyAutogen(true);

    const res = await runDailyCaseGeneration(radiologyOnly(["cxr"]));

    expect(res.created).toHaveLength(1);
  });

  it("состояние переживает перечитывание из базы", async () => {
    await setNightlyAutogen(false);

    // Именно этого не умел флаг в памяти: значение читается заново, как
    // после перезапуска сервера.
    const state = await getAutogenFullState();
    expect(state.nightlyEnabled).toBe(false);
  });

  it("ручной запуск тоже подчиняется выключателю", async () => {
    // Кнопки «сгенерировать» и ночной cron идут через один вход, поэтому
    // выключенная генерация не должна запускаться и руками — иначе
    // «выключено» означало бы разное в разных местах.
    await setNightlyAutogen(false);
    const res = await runDailyCaseGeneration({ stations: ["labs"], modalities: [] });

    expect(res.disabled).toBe(true);
    expect(await LabCase.countDocuments()).toBe(0);
  });
});
