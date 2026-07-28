// __tests__/diagnostics/staleJobs.test.js
//
// Брошенные задания разбора.
//
// Найдено в работе: дело сутки показывало «Идёт разбор», хотя выводы были
// получены. Причина — разбор выполняется В ТОМ ЖЕ ПРОЦЕССЕ, что и API
// (runPendingJobs вызывается из контроллера без await). Перезапуск процесса —
// деплой, падение, pm2 restart — обрывает выполнение, и задание навсегда
// остаётся в статусе «running». Дело при этом навсегда «analyzing», а runJob
// отказывался перезапускать такое задание («уже выполняется»), то есть
// расклинить дело было нельзя вообще ничем.
//
// Хуже всего здесь не сам сбой, а его вид: врач видит вечный индикатор
// загрузки и не понимает, ждать ему или разбор не идёт. Система, которая
// «думает» сутки, выглядит сломанной — и по сути ею и является.

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

vi.mock("../../modules/diagnostics/ai/analyzers.js", () => {
  const fake = {
    key: "fake",
    run: vi.fn(async () => ({
      summary: "разбор",
      dataGaps: [],
      findings: [{ title: "Вывод", detail: "по тексту", severity: "note", confidence: "moderate" }],
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "test-model",
      promptVersion: "v1",
    })),
  };
  return { getAnalyzer: () => fake, listAnalyzerKeys: () => ["fake"] };
});

await import("../../modules/diagnostics/index.js");

const DiagnosticJob = (
  await import("../../modules/diagnostics/core/models/diagnosticJob.model.js")
).default;
const DiagnosticCase = (
  await import("../../modules/diagnostics/core/models/diagnosticCase.model.js")
).default;

const { createCase, addArtifact, updateCase, getCaseFull, listCases } = await import(
  "../../modules/diagnostics/core/services/case.service.js"
);
const { queueAnalysis, reapStaleJobs, runJob, STALE_JOB_MS } = await import(
  "../../modules/diagnostics/core/services/analysis.service.js"
);

const userId = new mongoose.Types.ObjectId();

/** Дело с поставленными заданиями, но НЕ выполненными. */
async function caseWithQueuedJobs() {
  const c = await createCase({ title: "Кашель", clinicalContext: "мужчина 54 лет" }, { userId });
  await addArtifact(c._id, { kind: "report", modality: "xray", text: "инфильтрат" }, userId);
  await updateCase(c._id, { deidentified: true, aiConsent: true }, userId);
  await queueAnalysis({ caseId: c._id, userId });
  return c;
}

/**
 * Состарить задания дела, как будто процесс перезапустили давно.
 *
 * Через драйвер напрямую, а не через модель: mongoose помечает createdAt
 * неизменяемым (timestamps), и обычный update молча его игнорирует — тест
 * проходил бы, ничего не проверяя.
 */
async function ageJobs(caseId, ms, { asRunning = false } = {}) {
  const old = new Date(Date.now() - ms);
  const patch = { createdAt: old };
  if (asRunning) {
    patch.status = "running";
    patch["provenance.startedAt"] = old;
  }
  await DiagnosticJob.collection.updateMany(
    { caseId: new mongoose.Types.ObjectId(String(caseId)) },
    { $set: patch },
  );
}

beforeEach(() => {});

describe("дело не зависает в «идёт разбор» навсегда", () => {
  it("свежие задания не трогаются — разбор действительно идёт", async () => {
    const c = await caseWithQueuedJobs();
    expect(await reapStaleJobs({ caseId: c._id })).toBe(0);

    const view = await getCaseFull(c._id, userId);
    expect(view.case.status).toBe("analyzing");
  });

  it("задание, брошенное перезапуском, помечается сбойным при открытии дела", async () => {
    const c = await caseWithQueuedJobs();
    await ageJobs(c._id, STALE_JOB_MS + 60_000, { asRunning: true });

    const view = await getCaseFull(c._id, userId);

    expect(view.jobs.every((j) => j.status === "failed")).toBe(true);
    expect(view.jobs[0].message).toMatch(/прерв/i);
    // Главное: дело больше не «analyzing» — вечный индикатор исчез.
    expect(view.case.status).not.toBe("analyzing");
  });

  it("то же самое чинится и при открытии списка дел", async () => {
    const c = await caseWithQueuedJobs();
    await ageJobs(c._id, STALE_JOB_MS + 60_000, { asRunning: true });

    const items = await listCases({ userId });
    const mine = items.find((i) => String(i._id) === String(c._id));
    expect(mine.status).not.toBe("analyzing");
  });

  it("если выводы уже получены, дело переходит в «разбор готов», а не в черновик", async () => {
    const c = await caseWithQueuedJobs();
    // Одно задание успело отработать, второе оборвалось.
    const [first] = await DiagnosticJob.find({ caseId: c._id }).select("_id").lean();
    await runJob(first._id);
    const old = new Date(Date.now() - STALE_JOB_MS - 60_000);
    await DiagnosticJob.collection.updateMany(
      {
        caseId: new mongoose.Types.ObjectId(String(c._id)),
        status: { $in: ["queued", "running"] },
      },
      { $set: { status: "running", createdAt: old, "provenance.startedAt": old } },
    );

    const view = await getCaseFull(c._id, userId);
    expect(view.findings.length).toBeGreaterThan(0);
    expect(view.case.status).toBe("ready");
  });

  it("закрытое дело не переоткрывается уборкой", async () => {
    const c = await caseWithQueuedJobs();
    await DiagnosticCase.findByIdAndUpdate(c._id, { status: "closed" });
    await ageJobs(c._id, STALE_JOB_MS + 60_000, { asRunning: true });

    await reapStaleJobs({ caseId: c._id });
    const doc = await DiagnosticCase.findById(c._id).lean();
    expect(doc.status).toBe("closed");
  });

  it("уборка по владельцу не трогает чужие дела", async () => {
    const c = await caseWithQueuedJobs();
    await ageJobs(c._id, STALE_JOB_MS + 60_000, { asRunning: true });

    const stranger = new mongoose.Types.ObjectId();
    expect(await reapStaleJobs({ ownerId: stranger })).toBe(0);

    const still = await DiagnosticJob.find({ caseId: c._id }).lean();
    expect(still.every((j) => j.status === "running")).toBe(true);
  });
});

describe("перезапуск брошенного задания", () => {
  it("свежее выполняющееся задание перезапустить нельзя", async () => {
    const c = await caseWithQueuedJobs();
    const [job] = await DiagnosticJob.find({ caseId: c._id }).select("_id").lean();
    await DiagnosticJob.findByIdAndUpdate(job._id, {
      status: "running",
      "provenance.startedAt": new Date(),
    });

    await expect(runJob(job._id)).rejects.toThrow(/уже выполняется/i);
  });

  it("брошенное — можно, иначе «Попробовать ещё раз» бессильно", async () => {
    const c = await caseWithQueuedJobs();
    const [job] = await DiagnosticJob.find({ caseId: c._id }).select("_id").lean();
    const old = new Date(Date.now() - STALE_JOB_MS - 60_000);
    await DiagnosticJob.findByIdAndUpdate(job._id, {
      status: "running",
      "provenance.startedAt": old,
    });

    const result = await runJob(job._id);
    expect(result.status).toBe("done");
  });
});
