// __tests__/education/ingest.test.js
//
// Импорт вопросов из файла. ИИ-экстрактор здесь не вызывается — он ходит
// во внешний API. Проверяем то, что от него не зависит: нормализацию
// распознанного, правку оператором и перенос в банк вопросов.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import ExamImportJob from "../../modules/education/education-ingest/models/examImportJob.model.js";
import {
  createJob,
  runExtraction,
  startExtraction,
  getJob,
  updateDraft,
  importDrafts,
  buildBlueprintFromSuggestion,
} from "../../modules/education/education-ingest/services/ingest.service.js";
import { assertPublishable } from "../../modules/education/education-items/services/item.service.js";
import {
  getExtractor,
  listExtractors,
} from "../../modules/education/education-ingest/extractors/index.js";

const oid = () => new mongoose.Types.ObjectId();

async function makeProgram() {
  return ExamProgram.create({
    code: "az-residency-test",
    title: "Резидентура (тест)",
    country: "AZ",
    region: "cis",
    examType: "residency_entrance",
    blueprint: [{ code: "cardio", title: "Кардиология", weightPercent: 100 }],
    status: "published",
  });
}

async function makeJob(program, defaults = {}) {
  return createJob({
    programId: program._id,
    extractor: "manual",
    file: { mimeType: "application/pdf", originalName: "test.pdf" },
    defaults: {
      lang: "ru",
      source: { kind: "public_government", authority: "Минздрав" },
      ...defaults,
    },
    actorId: oid(),
  });
}

const RAW_ITEMS = [
  {
    stem: "Первая линия при подозрении на ОКС?",
    options: [
      { key: "A", text: "ЭКГ и тропонин" },
      { key: "B", text: "МРТ" },
    ],
    correctKeys: ["A"],
    topicCode: "cardio",
    sourcePage: 3,
  },
  {
    // Ключ ответа в файле не указан — экстрактор не должен его выдумывать.
    stem: "Вопрос без ключа ответа",
    options: [
      { key: "A", text: "вариант 1" },
      { key: "B", text: "вариант 2" },
    ],
    correctKeys: [],
    topicCode: "cardio",
  },
];

describe("реестр экстракторов", () => {
  it("по умолчанию активен manual — файл не уходит наружу без явного включения", () => {
    // Проверяем именно УМОЛЧАНИЕ, поэтому переменную окружения на время
    // убираем: иначе тест падает на машине, где разработчик включил
    // ИИ-экстрактор в своём .env, и проверяет не то, что заявлено.
    const saved = process.env.EDUCATION_EXTRACTOR;
    delete process.env.EDUCATION_EXTRACTOR;
    try {
      const active = listExtractors().find((e) => e.active);
      expect(active.name).toBe("manual");
      expect(getExtractor().name).toBe("manual");
    } finally {
      if (saved === undefined) delete process.env.EDUCATION_EXTRACTOR;
      else process.env.EDUCATION_EXTRACTOR = saved;
    }
  });

  it("claude присутствует в реестре, но не настроен без ключа", () => {
    const claude = listExtractors().find((e) => e.name === "claude");
    expect(claude).toBeTruthy();
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      expect(claude.configured).toBe(false);
    }
  });
});

// Структура теста, построенная ИИ из файла: админ загружает файл, не
// размечая темы заранее.
describe("buildBlueprintFromSuggestion", () => {
  it("нормализует веса к 100", () => {
    const blueprint = buildBlueprintFromSuggestion({
      topics: [
        { code: "cardio", title: "Кардиология", weightPercent: 30 },
        { code: "neuro", title: "Неврология", weightPercent: 20 },
      ],
    });
    const total = blueprint.reduce((s, t) => s + t.weightPercent, 0);
    expect(Math.round(total)).toBe(100);
    expect(blueprint[0].weightPercent).toBe(60);
  });

  it("делит поровну, если модель не проставила веса", () => {
    const blueprint = buildBlueprintFromSuggestion({
      topics: [
        { code: "a", title: "A", weightPercent: 0 },
        { code: "b", title: "B", weightPercent: 0 },
      ],
    });
    expect(blueprint.map((t) => t.weightPercent)).toEqual([50, 50]);
  });

  it("чистит коды и отбрасывает дубликаты", () => {
    const blueprint = buildBlueprintFromSuggestion({
      topics: [
        { code: "Кардио Логия", title: "Кардиология", weightPercent: 50 },
        { code: "dup", title: "Первый", weightPercent: 25 },
        { code: "dup", title: "Дубликат", weightPercent: 25 },
        { code: "", title: "Без кода", weightPercent: 10 },
      ],
    });
    expect(blueprint).toHaveLength(2);
    expect(blueprint[0].code).toMatch(/^[a-z0-9._-]+$/);
    expect(blueprint[1].title).toBe("Первый");
  });

  it("возвращает null, когда делить не на что", () => {
    expect(buildBlueprintFromSuggestion({ topics: [] })).toBeNull();
    expect(buildBlueprintFromSuggestion(null)).toBeNull();
  });
});

describe("создание задания", () => {
  let program;
  beforeEach(async () => {
    program = await makeProgram();
  });

  it("ручному экстрактору файл не нужен", async () => {
    const job = await createJob({
      programId: program._id,
      extractor: "manual",
      defaults: { source: { kind: "original" } },
    });
    expect(job.file.mimeType).toBeNull();
  });

  it("экстрактору, читающему файл, mimeType обязателен", async () => {
    await expect(
      createJob({
        programId: program._id,
        extractor: "claude",
        defaults: { source: { kind: "public_government" } },
      }),
    ).rejects.toThrow(/mimeType is required|not configured/i);
  });
});

describe("нормализация распознанного", () => {
  let program;
  beforeEach(async () => {
    program = await makeProgram();
  });

  it("отбрасывает мусор без условия и переиндексует остальное", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, {
      payloadItems: [
        { stem: "   ", options: [{ key: "A", text: "x" }] }, // шапка страницы
        RAW_ITEMS[0],
      ],
    });

    const loaded = await getJob(job._id);
    expect(loaded.draftItems).toHaveLength(1);
    expect(loaded.draftItems[0].index).toBe(0);
    expect(loaded.stats.detected).toBe(1);
  });

  it("отбрасывает ключи, не соответствующие вариантам", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, {
      payloadItems: [
        {
          stem: "Вопрос",
          options: [
            { key: "A", text: "x" },
            { key: "B", text: "y" },
          ],
          correctKeys: ["Z"], // распознанный мусор
        },
      ],
    });

    const loaded = await getJob(job._id);
    expect(loaded.draftItems[0].correctKeys).toEqual([]);
    expect(loaded.draftItems[0].notes).toMatch(/Ключ ответа не определён/);
  });

  it("не трогает уже размеченную программу", async () => {
    // У makeProgram есть blueprint, значит предложение модели должно быть
    // проигнорировано целиком — ручная разметка приоритетнее.
    const before = await ExamProgram.findById(program._id).lean();
    const job = await makeJob(program);
    await runExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] });

    const after = await ExamProgram.findById(program._id).lean();
    expect(after.blueprint.map((b) => b.code)).toEqual(
      before.blueprint.map((b) => b.code),
    );
    expect(after.title).toBe(before.title);
  });

  it("сбрасывает тему, которой нет в blueprint программы", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, {
      payloadItems: [{ ...RAW_ITEMS[0], topicCode: "surgery" }],
    });

    const loaded = await getJob(job._id);
    expect(loaded.draftItems[0].topicCode).toBeNull();
  });

  it("подсвечивает черновики, требующие внимания оператора", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, { payloadItems: RAW_ITEMS });

    const loaded = await getJob(job._id);
    // Второй вопрос без ключа ответа.
    expect(loaded.needsAttention).toBe(1);
  });
});

describe("перенос в банк вопросов", () => {
  let program;
  beforeEach(async () => {
    program = await makeProgram();
  });

  it("создаёт вопросы и сразу ставит их в очередь ревью", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] });

    const result = await importDrafts(job._id, { actorId: oid() });
    expect(result.createdCount).toBe(1);

    const item = await ExamItem.findById(result.createdItemIds[0]).lean();
    // Не "draft": вопрос, оставшийся черновиком, не виден ни в очереди
    // ревью, ни учащимся — то есть нигде.
    expect(item.status).toBe("in_review");
    expect(String(item.importJobId)).toBe(String(job._id));
    // Происхождение содержания сохраняется как заявлено в задании.
    expect(item.source.kind).toBe("public_government");
  });

  it("не роняет весь импорт из-за одного негодного черновика", async () => {
    const job = await makeJob(program);
    // Второй черновик без ключа ответа — createItem его отвергнет.
    await runExtraction(job._id, { payloadItems: RAW_ITEMS });

    const result = await importDrafts(job._id, { actorId: oid() });
    expect(result.createdCount).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/correct answer/i);
  });

  it("оператор может дописать ключ ответа и доимпортировать остаток", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, { payloadItems: RAW_ITEMS });
    await importDrafts(job._id, { actorId: oid() });

    // Оператор сверился с оригиналом и проставил ответ.
    await updateDraft(job._id, 1, { correctKeys: ["B"] });
    const second = await importDrafts(job._id, { actorId: oid() });

    expect(second.createdCount).toBe(1);
    const loaded = await getJob(job._id);
    expect(loaded.stats.imported).toBe(2);
  });

  it("отбракованные оператором черновики не импортируются", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] });
    await updateDraft(job._id, 0, { discarded: true });

    await expect(importDrafts(job._id, { actorId: oid() })).rejects.toThrow(
      /no draft items available/i,
    );
  });

  it("импортированный вопрос нельзя опубликовать без ревью человеком", async () => {
    const job = await makeJob(program);
    await runExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] });
    const result = await importDrafts(job._id, { actorId: oid() });

    const item = await ExamItem.findById(result.createdItemIds[0]).lean();
    // Сам по себе, без рецензента, машинно-извлечённый вопрос
    // опубликовать нельзя — даже при безупречном оформлении.
    expect(() => assertPublishable(item)).toThrow(/requires human review/i);
    // А с рецензентом — можно, объяснения для этого не нужны.
    expect(() => assertPublishable(item, { reviewerId: oid() })).not.toThrow();
  });
});

// Регресс с прода: распознавание идёт 3–4 минуты, nginx рвёт соединение
// раньше, и браузер получает «Network Error» без статуса. Сервер при этом
// доводит работу до конца, но форма считает загрузку сорванной и
// архивирует программу — результат теряется. Лечится тем, что запуск
// возвращает управление сразу, а прогресс забирают опросом задания.
describe("асинхронный запуск распознавания", () => {
  let program;
  beforeEach(async () => {
    program = await makeProgram();
  });

  // Ждём фонового завершения, не завязываясь на конкретную задержку.
  async function waitForStatus(jobId, statuses, limitMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < limitMs) {
      const current = await getJob(jobId);
      if (statuses.includes(current.status)) return current;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Задание не дошло до ${statuses.join("/")} за ${limitMs} мс`);
  }

  it("возвращает задание сразу, а распознаёт в фоне", async () => {
    const job = await makeJob(program);

    const started = await startExtraction(job._id, {
      payloadItems: [RAW_ITEMS[0]],
    });
    // Ответ отдан до того, как экстрактор закончил.
    expect(started.status).toBe("extracting");

    const finished = await waitForStatus(job._id, ["extracted", "failed"]);
    expect(finished.status).toBe("extracted");
    expect(finished.stats.detected).toBe(1);
  });

  it("не даёт перезапустить уже распознанное задание", async () => {
    const job = await makeJob(program);
    await startExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] });
    await waitForStatus(job._id, ["extracted"]);

    await expect(
      startExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] }),
    ).rejects.toThrow(/cannot be re-extracted/i);
  });

  it("перезапускает задание, брошенное на середине", async () => {
    // Процесс перезапустили посреди распознавания: задание навсегда
    // осталось в extracting. Без послабления оператор не смог бы его
    // повторить — только завести новое.
    const job = await makeJob(program);
    await ExamImportJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "extracting",
          startedAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      },
    );

    await startExtraction(job._id, { payloadItems: [RAW_ITEMS[0]] });
    const finished = await waitForStatus(job._id, ["extracted", "failed"]);
    expect(finished.status).toBe("extracted");
  });
});
