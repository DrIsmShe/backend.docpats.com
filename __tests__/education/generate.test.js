// __tests__/education/generate.test.js
//
// Генерация вопросов моделью. Сам вызов Anthropic мокируем — проверяем не
// качество вопросов, а логику вокруг: разбивку заказа на батчи, накопление
// в один тест, построение blueprint из первого батча, устойчивость к
// сбою одного батча и валидацию заказа.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Мок генератора — до импорта сервиса, чтобы настоящий (с Anthropic SDK и
// сетью) не подгружался.
const generateMock = vi.fn();
vi.mock(
  "../../modules/education/education-ingest/extractors/generate.extractor.js",
  () => ({
    generate: (...args) => generateMock(...args),
    GENERATION_BATCH_SIZE: 20,
  }),
);

const { runGeneration, createGenerationJob } = await import(
  "../../modules/education/education-ingest/services/ingest.service.js"
);
const { default: ExamProgram } = await import(
  "../../modules/education/education-catalog/models/examProgram.model.js"
);
const { default: ExamImportJob } = await import(
  "../../modules/education/education-ingest/models/examImportJob.model.js"
);

const oid = () => new mongoose.Types.ObjectId();

// Батч из n валидных вопросов; suggestedProgram отдаём только на первом.
function batch(n, { withProgram = false, prefix = "Q" } = {}) {
  const items = Array.from({ length: n }, (_, i) => ({
    stem: `${prefix}-${i}: что верно про клетку?`,
    options: [
      { key: "A", text: "верно", explanation: "да" },
      { key: "B", text: "неверно", explanation: "нет" },
      { key: "C", text: "неверно2", explanation: "нет" },
      { key: "D", text: "неверно3", explanation: "нет" },
    ],
    correctKeys: ["A"],
    explanation: "потому что",
    topicCode: "",
    difficulty: "medium",
    confidence: 1,
    sourcePage: null,
    notes: "",
  }));
  return {
    items,
    suggestedProgram: withProgram
      ? {
          title: "Биология клетки: базовый уровень",
          lang: "ru",
          topics: [{ code: "cyto", title: "Цитология", weightPercent: 100 }],
        }
      : null,
    usage: { inputTokens: 10, outputTokens: 100 },
  };
}

async function makeEmptyProgram() {
  return ExamProgram.create({
    code: `gen-${Date.now().toString(36)}`,
    title: "Черновик генерации",
    country: "INT",
    region: "international",
    examType: "cme",
    status: "draft",
  });
}

async function makeGenJob(program, count) {
  return ExamImportJob.create({
    programId: program._id,
    extractor: "generate",
    file: { originalName: "Генерация: биология" },
    generationSpec: { topic: "биология клетки", count, difficulty: "mixed" },
    defaults: { lang: "ru", source: { kind: "ai_generated" } },
    status: "pending",
  });
}

beforeEach(() => {
  generateMock.mockReset();
});

describe("runGeneration", () => {
  it("бьёт заказ на батчи и копит всё в один тест", async () => {
    // 50 при батче 20 → 20 + 20 + 10.
    generateMock
      .mockResolvedValueOnce(batch(20, { withProgram: true, prefix: "A" }))
      .mockResolvedValueOnce(batch(20, { prefix: "B" }))
      .mockResolvedValueOnce(batch(10, { prefix: "C" }));

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 50);

    const result = await runGeneration(job._id);

    expect(generateMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("extracted");
    expect(result.progress.total).toBe(3);
    expect(result.draftItems).toHaveLength(50);
    // Последний батч просит только остаток, а не полный размер.
    expect(generateMock.mock.calls[2][0].count).toBe(10);
  });

  it("строит структуру теста из первого батча", async () => {
    generateMock.mockResolvedValue(batch(20, { withProgram: true }));

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 20);
    await runGeneration(job._id);

    const fresh = await ExamProgram.findById(program._id).lean();
    expect(fresh.title).toBe("Биология клетки: базовый уровень");
    expect(fresh.blueprint.map((b) => b.code)).toContain("cyto");
  });

  it("передаёт язык заказа и уже созданные вопросы в анти-дубли", async () => {
    generateMock
      .mockResolvedValueOnce(batch(20, { withProgram: true, prefix: "A" }))
      .mockResolvedValueOnce(batch(5, { prefix: "B" }));

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 25);
    await runGeneration(job._id);

    const second = generateMock.mock.calls[1][0];
    expect(second.lang).toBe("ru");
    // Второй батч знает стемы первого — иначе повторы неизбежны.
    expect(second.avoidStems.length).toBe(20);
  });

  it("сбой одного батча не роняет генерацию", async () => {
    generateMock
      .mockResolvedValueOnce(batch(20, { withProgram: true }))
      .mockRejectedValueOnce(new Error("временный сбой API"))
      .mockResolvedValueOnce(batch(10, { prefix: "C" }));

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 50);
    const result = await runGeneration(job._id);

    expect(result.status).toBe("extracted");
    expect(result.progress.failedChunks).toBe(1);
    expect(result.draftItems.length).toBe(30); // 20 + 0 + 10
  });

  it("все батчи упали — задание падает, а не «пустой успех»", async () => {
    generateMock.mockRejectedValue(new Error("API лежит"));

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 20);
    const result = await runGeneration(job._id);

    expect(result.status).toBe("failed");
    expect(result.draftItems).toHaveLength(0);
  });

  it("причина сбоя доходит до оператора, а не остаётся в логе", async () => {
    generateMock.mockRejectedValue(
      new Error("Ключ Anthropic API отклонён (401)"),
    );

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 20);
    const result = await runGeneration(job._id);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("401");
  });

  it("переполнение ответа уменьшает батч и повторяет тот же кусок", async () => {
    // Экстрактор помечает stop_reason: max_tokens флагом overflow.
    const overflow = Object.assign(new Error("Батч не поместился в лимит"), {
      details: { overflow: true },
    });
    generateMock
      .mockRejectedValueOnce(overflow) // 20 не влезли
      .mockResolvedValueOnce(batch(10, { withProgram: true })); // 10 — влезли

    const program = await makeEmptyProgram();
    const job = await makeGenJob(program, 20);
    const result = await runGeneration(job._id);

    expect(result.status).toBe("extracted");
    expect(result.progress.failedChunks).toBe(0);
    expect(result.draftItems.length).toBe(10);
    // Второй вызов — тот же батч вдвое меньшим заказом.
    expect(generateMock.mock.calls[0][0].count).toBe(20);
    expect(generateMock.mock.calls[1][0].count).toBe(10);
  });
});

describe("createGenerationJob — валидация", () => {
  it("требует тему", async () => {
    await expect(
      createGenerationJob({ programId: oid(), topic: "  ", count: 10 }),
    ).rejects.toThrow(/тему/i);
  });

  it("требует положительное целое число вопросов", async () => {
    await expect(
      createGenerationJob({ programId: oid(), topic: "генетика", count: 0 }),
    ).rejects.toThrow(/больше нуля/i);
  });

  it("ограничивает заказ сверху", async () => {
    await expect(
      createGenerationJob({ programId: oid(), topic: "генетика", count: 5000 }),
    ).rejects.toThrow(/не больше/i);
  });
});
