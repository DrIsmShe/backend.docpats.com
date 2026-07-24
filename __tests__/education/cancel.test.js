// __tests__/education/cancel.test.js
//
// Отмена идущего распознавания. Проверяем, что cancelJob помечает
// задание, отдаёт осмысленную ошибку на неотменяемых статусах, а сам
// прогон, увидев флаг, останавливается между частями и сохраняет
// накопленное.

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

// Экстрактор мокаем: реальный ходит в сеть. Возвращаем по 1 вопросу на
// часть, но перед второй частью извне помечаем задание cancelled.
const extractMock = vi.fn();
vi.mock(
  "../../modules/education/education-ingest/extractors/index.js",
  () => ({
    getExtractor: () => ({ name: "claude", extract: (...a) => extractMock(...a) }),
    getActiveExtractorName: () => "claude",
    listExtractors: () => [{ name: "claude", configured: true }],
  }),
);

const { runExtraction, cancelJob } = await import(
  "../../modules/education/education-ingest/services/ingest.service.js"
);
const { default: ExamProgram } = await import(
  "../../modules/education/education-catalog/models/examProgram.model.js"
);
const { default: ExamImportJob } = await import(
  "../../modules/education/education-ingest/models/examImportJob.model.js"
);

const oid = () => new mongoose.Types.ObjectId();

function question(stem) {
  return {
    stem,
    options: [
      { key: "A", text: "верно", explanation: "да" },
      { key: "B", text: "неверно", explanation: "нет" },
    ],
    correctKeys: ["A"],
    explanation: "разбор",
    topicCode: "",
    difficulty: "medium",
    confidence: 1,
    sourcePage: null,
    notes: "",
  };
}

async function makeProgram() {
  return ExamProgram.create({
    code: `cancel-${Math.random().toString(36).slice(2, 8)}`,
    title: "Черновик импорта",
    country: "INT",
    region: "international",
    examType: "cme",
    status: "draft",
  });
}

async function makeJob(program, text) {
  return ExamImportJob.create({
    programId: program._id,
    extractor: "claude",
    file: {
      originalName: "big.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text, "utf8").toString("base64"),
    },
    defaults: { lang: "ru", source: { kind: "original" } },
    status: "extracting",
    startedAt: new Date(),
  });
}

beforeEach(() => extractMock.mockReset());

describe("cancelJob", () => {
  it("отменяет идущее задание", async () => {
    const program = await makeProgram();
    const job = await makeJob(program, "текст");
    const res = await cancelJob(job._id);
    expect(res.cancelled).toBe(true);
    expect((await ExamImportJob.findById(job._id)).status).toBe("cancelled");
  });

  it("не отменяет уже завершённое", async () => {
    const program = await makeProgram();
    const job = await makeJob(program, "текст");
    await ExamImportJob.updateOne({ _id: job._id }, { $set: { status: "extracted" } });
    await expect(cancelJob(job._id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("runExtraction реагирует на отмену", () => {
  it("останавливается между частями и сохраняет распознанное", async () => {
    // Большой текст → несколько частей. Помечаем задание cancelled после
    // первой обработанной части.
    const para = "Вопрос " + "разбор ".repeat(40);
    const text = Array.from({ length: 300 }, () => para).join("\n\n");
    const program = await makeProgram();
    const job = await makeJob(program, text);
    // runExtraction режет файл из переданного buffer (не из job.file):
    // большой текст → несколько частей, между которыми ловится отмена.
    const buffer = Buffer.from(text, "utf8");

    let calls = 0;
    extractMock.mockImplementation(async () => {
      calls += 1;
      // После первого вызова инициируем отмену «из другой вкладки».
      if (calls === 1) await cancelJob(job._id);
      return { items: [question(`Q${calls}`)], suggestedProgram: null, usage: {} };
    });

    const result = await runExtraction(job._id, {
      buffer,
      alreadyStarted: true,
    });

    expect(result.status).toBe("cancelled");
    // Успело распознаться то, что до отмены (первая часть) — не выброшено.
    expect(result.draftItems.length).toBeGreaterThanOrEqual(1);
    // Прогон остановился рано, а не прошёл все части.
    expect(calls).toBeLessThan(300);
  });
});
