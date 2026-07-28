// __tests__/diagnostics/auditAndQuota.test.js
//
// Журнал доступа к PHI и пределы обращений к модели.
//
// Про журнал. Модуль читает и расшифровывает данные живых пациентов и, в
// отличие от остальных, ОТПРАВЛЯЕТ их наружу. Значит, однажды придётся
// письменно ответить: что именно ушло за пределы контура, когда и на каком
// основании. Ответ собирается не по логам приложения, а по тому же журналу,
// что и остальной доступ к PHI, — иначе его просто нет.
//
// Ключевое утверждение здесь одно: PHI в журнал НЕ ПОПАДАЕТ. Журнал сам
// становится хранилищем персональных данных ровно в тот момент, когда в
// metadata попадает первая строка текста пациента, — и живёт он семь лет.
//
// Про пределы. Каждый разбор — деньги. Опасность не в злом умысле: врач не
// получил нужного ответа, поменял формулировку, нажал снова, ещё раз, ещё.
// Десять нажатий за минуту — обычная человеческая реакция.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

vi.mock("../../modules/diagnostics/ai/analyzers.js", () => ({
  getAnalyzer: () => ({ key: "fake", run: vi.fn(async () => ({ skipped: true, reason: "тест" })) }),
  listAnalyzerKeys: () => ["fake"],
}));

await import("../../modules/diagnostics/index.js");

const DiagnosticJob = (
  await import("../../modules/diagnostics/core/models/diagnosticJob.model.js")
).default;

const { createCase, addArtifact, updateCase } = await import(
  "../../modules/diagnostics/core/services/case.service.js"
);
const { queueAnalysis } = await import(
  "../../modules/diagnostics/core/services/analysis.service.js"
);
const { assertAnalyzeAllowed, analyzeQuotaLeft, LIMITS } = await import(
  "../../modules/diagnostics/core/services/quota.service.js"
);
const { describeArtifacts } = await import("../../modules/diagnostics/audit.js");
const { ACTION_ENUM, RESOURCE_TYPE_ENUM } = await import(
  "../../modules/audit/enums/auditEnums.js"
);

const userId = new mongoose.Types.ObjectId();

async function readyCase() {
  const c = await createCase({ title: "Дело", clinicalContext: "контекст" }, { userId });
  await addArtifact(c._id, { kind: "report", modality: "xray", text: "текст" }, userId);
  await updateCase(c._id, { deidentified: true, aiConsent: true }, userId);
  return c;
}

/* ─── Журнал ──────────────────────────────────────────────────────────── */

describe("события модуля объявлены в каноническом справочнике", () => {
  // Справочник валидирует запись: незнакомое действие или тип ресурса — это
  // не «запишется как есть», а падение записи в журнал. Проверяем заранее.
  const ACTIONS = [
    "diagnostics.case.create",
    "diagnostics.case.read",
    "diagnostics.case.list",
    "diagnostics.case.update",
    "diagnostics.case.close",
    "diagnostics.case.reopen",
    "diagnostics.artifact.add",
    "diagnostics.artifact.remove",
    "diagnostics.consent",
    "diagnostics.analyze",
    "diagnostics.extract",
    "diagnostics.finding.verdict",
    "diagnostics.export",
  ];

  it.each(ACTIONS)("действие %s известно журналу", (action) => {
    expect(ACTION_ENUM).toContain(action);
  });

  it.each(["diagnostic-case", "diagnostic-artifact", "diagnostic-finding"])(
    "тип ресурса %s известен журналу",
    (type) => {
      expect(RESOURCE_TYPE_ENUM).toContain(type);
    },
  );

  it("выделены отдельные события для выхода данных наружу", () => {
    // Разбор и распознавание нельзя записывать как «обновление дела»: именно
    // по ним отвечают на вопрос, что покинуло контур.
    expect(ACTION_ENUM).toContain("diagnostics.analyze");
    expect(ACTION_ENUM).toContain("diagnostics.extract");
    expect(ACTION_ENUM).toContain("diagnostics.consent");
  });
});

describe("описание материалов для журнала не содержит PHI", () => {
  const artifacts = [
    { kind: "report", text: "Пациент Иванов, гемоглобин 88" },
    { kind: "report", text: "Второе заключение" },
    { kind: "lab_panel", text: "" },
  ];

  it("считает состав, а не хранит содержимое", () => {
    const d = describeArtifacts(artifacts);
    expect(d.artifactCount).toBe(3);
    expect(d.byKind).toEqual({ report: 2, lab_panel: 1 });
    expect(d.textLength).toBe(artifacts[0].text.length + artifacts[1].text.length);
  });

  it("ни одно значение не содержит текста пациента", () => {
    const serialized = JSON.stringify(describeArtifacts(artifacts));
    expect(serialized).not.toContain("Иванов");
    expect(serialized).not.toContain("гемоглобин");
  });

  it("пустой список не ломает описание", () => {
    expect(describeArtifacts()).toEqual({ artifactCount: 0, byKind: {}, textLength: 0 });
  });
});

/* ─── Пределы ─────────────────────────────────────────────────────────── */

describe("пределы обращений к модели", () => {
  beforeEach(async () => {
    await DiagnosticJob.deleteMany({});
  });

  it("в пределах лимита разбор разрешён", async () => {
    await expect(assertAnalyzeAllowed(userId)).resolves.toBeUndefined();
  });

  it("считаются ЗАДАНИЯ, а не запуски — дело с восемью направлениями дороже", async () => {
    const c = await readyCase();
    await queueAnalysis({ caseId: c._id, userId });
    const left = await analyzeQuotaLeft(userId);
    const jobs = await DiagnosticJob.countDocuments({ ownerId: userId });
    expect(left.hour.used).toBe(jobs);
    expect(jobs).toBeGreaterThan(0);
  });

  it("часовой предел останавливает и говорит, когда повторить", async () => {
    const now = Date.now();
    await DiagnosticJob.insertMany(
      Array.from({ length: LIMITS.analyzePerHour }, () => ({
        caseId: new mongoose.Types.ObjectId(),
        ownerId: userId,
        modality: "xray",
        analyzer: "report",
        status: "done",
      })),
    );

    await expect(assertAnalyzeAllowed(userId, now)).rejects.toThrow(/за час/i);
    // Отказ без «когда можно» — тупик: врач не понимает, что делать.
    await expect(assertAnalyzeAllowed(userId, now)).rejects.toThrow(/через/i);
  });

  it("предел чужого врача не задевает", async () => {
    await DiagnosticJob.insertMany(
      Array.from({ length: LIMITS.analyzePerHour }, () => ({
        caseId: new mongoose.Types.ObjectId(),
        ownerId: userId,
        modality: "xray",
        analyzer: "report",
        status: "done",
      })),
    );
    const other = new mongoose.Types.ObjectId();
    await expect(assertAnalyzeAllowed(other)).resolves.toBeUndefined();
  });

  it("старые задания предел не занимают — окно скользящее", async () => {
    const now = Date.now();
    const old = new Date(now - 2 * 60 * 60 * 1000);
    await DiagnosticJob.insertMany(
      Array.from({ length: LIMITS.analyzePerHour }, () => ({
        caseId: new mongoose.Types.ObjectId(),
        ownerId: userId,
        modality: "xray",
        analyzer: "report",
        status: "done",
      })),
    );
    await DiagnosticJob.collection.updateMany({}, { $set: { createdAt: old } });

    await expect(assertAnalyzeAllowed(userId, now)).resolves.toBeUndefined();
  });

  it("остаток лимита можно показать до нажатия", async () => {
    const left = await analyzeQuotaLeft(userId);
    expect(left.hour.limit).toBe(LIMITS.analyzePerHour);
    expect(left.day.limit).toBe(LIMITS.analyzePerDay);
    expect(left.hour.used).toBe(0);
  });
});
