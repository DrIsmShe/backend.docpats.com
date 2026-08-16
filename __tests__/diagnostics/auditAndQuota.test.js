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

/* ─── Месячная квота тарифа ───────────────────────────────────────────── */
//
// Часовой и суточный пределы одинаковы для всех и защищают от петли. Этот —
// про деньги: у Lite за 3 $ и у Pro за 99 $ разная себестоимость обращений,
// и до сих пор кода за этой разницей не стояло. Врач на Lite мог делать 60
// разборов в сутки при обещанных трёх в месяц.

describe("месячная квота разборов по тарифу", () => {
  let User;
  // Числа берём из конфига, а не зашиваем: тариф пересматривается, и тест,
  // повторяющий цифру, ломается при каждой правке прайса, ничего не проверив.
  let LIMIT_LITE;

  beforeEach(async () => {
    User = (await import("../../common/models/Auth/users.js")).default;
    const { PLAN_LIMITS } = await import("../../common/config/aiPlanLimits.js");
    LIMIT_LITE = PLAN_LIMITS.doctor_lite.aiAnalyses;
  });

  /** Врач с заданным тарифом и заведомо истёкшим пробным периодом. */
  async function doctorOn(plan) {
    const suffix = new mongoose.Types.ObjectId().toString();
    return User.create({
      emailEncrypted: `quota-${suffix}@example.com`,
      firstNameEncrypted: "Тест",
      lastNameEncrypted: "Врач",
      emailHash: "placeholder",
      firstNameHash: "placeholder",
      lastNameHash: "placeholder",
      username: `quota-${suffix}`,
      password: "hashed-password-placeholder",
      dateOfBirth: new Date("1990-01-01"),
      bio: "test",
      agreement: true,
      role: "doctor",
      subscriptionPlan: plan,
      // Пробный период выдаёт лимиты Growth и перекрыл бы тариф.
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
  }

  async function fillJobs(ownerId, count, at) {
    if (count <= 0) return;
    await DiagnosticJob.insertMany(
      Array.from({ length: count }, () => ({
        caseId: new mongoose.Types.ObjectId(),
        ownerId,
        modality: "xray",
        analyzer: "report",
        status: "done",
      })),
    );
    if (at) {
      await DiagnosticJob.collection.updateMany(
        { ownerId },
        { $set: { createdAt: at } },
      );
    }
  }

  it("Lite упирается в квоту тарифа, хотя суточный предел ещё далеко", async () => {
    const doc = await doctorOn("doctor_lite");
    const now = Date.now();
    // Сутки назад: часовой и суточный пределы уже не в игре, месячный — да.
    await fillJobs(doc._id, LIMIT_LITE, new Date(now - 25 * 60 * 60 * 1000));
    // Проверка осмысленна, только пока месячная квота строго меньше суточной.
    expect(LIMIT_LITE).toBeLessThan(LIMITS.analyzePerDay);

    await expect(assertAnalyzeAllowed(doc._id, now)).rejects.toThrow(/месячная квота/i);
    // Отказ обязан называть тариф — иначе непонятно, что делать дальше.
    await expect(assertAnalyzeAllowed(doc._id, now)).rejects.toThrow(/Doctor Lite/);
  });

  it("Pro на том же объёме работает: квота больше", async () => {
    const doc = await doctorOn("doctor_pro");
    const now = Date.now();
    await fillJobs(doc._id, LIMIT_LITE, new Date(now - 25 * 60 * 60 * 1000));

    await expect(assertAnalyzeAllowed(doc._id, now)).resolves.toBeUndefined();
  });

  it("разборы старше 30 дней квоту не занимают", async () => {
    const doc = await doctorOn("doctor_lite");
    const now = Date.now();
    await fillJobs(doc._id, 10, new Date(now - 31 * 24 * 60 * 60 * 1000));

    await expect(assertAnalyzeAllowed(doc._id, now)).resolves.toBeUndefined();
  });

  it("остаток показывает месячную квоту и тариф", async () => {
    const doc = await doctorOn("doctor_lite");
    const left = await analyzeQuotaLeft(doc._id);
    expect(left.month).toEqual({ used: 0, limit: LIMIT_LITE, plan: "doctor_lite" });
  });

  it("без пользователя тарифный предел не применяется, но часовой остаётся", async () => {
    // Служебный вызов или удалённый аккаунт не должны падать на отсутствии
    // тарифа — иначе фоновая задача умрёт там, где раньше работала.
    const orphan = new mongoose.Types.ObjectId();
    await expect(assertAnalyzeAllowed(orphan)).resolves.toBeUndefined();
    const left = await analyzeQuotaLeft(orphan);
    expect(left.month).toBeUndefined();
    expect(left.hour.limit).toBe(LIMITS.analyzePerHour);
  });
});
