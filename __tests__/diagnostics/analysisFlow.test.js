// __tests__/diagnostics/analysisFlow.test.js
//
// Жизненный цикл разбора: гейты приватности → задания → выводы → вердикт врача.
//
// Самое важное здесь — ГЕЙТЫ. Материалы живого пациента уходят внешней модели,
// и запуск обязан быть невозможен, пока врач не подтвердил обезличивание И
// согласие. Это не формальность: один пропущенный флаг — и ФИО пациента ушло
// наружу без основания.
//
// Анализатор подменяется: проверяется КОНВЕЙЕР (гейты, задания, происхождение,
// шифрование, обратная связь), а не качество ответов модели. Обращаться к
// настоящему API в тестах нельзя — это деньги, сеть и недетерминированность.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Подмена анализаторов ДО импорта сервиса: иначе он захватит настоящие.
vi.mock("../../modules/diagnostics/ai/analyzers.js", () => {
  const fake = {
    key: "fake",
    run: vi.fn(async ({ modality }) => ({
      summary: `разбор ${modality.key}`,
      dataGaps: ["нет предыдущих исследований"],
      findings: [
        {
          title: `Вывод по ${modality.key}`,
          detail: "Основано на приложенном тексте",
          severity: "important",
          confidence: "moderate",
          checklistItem: modality.checklist?.[0] ?? "",
          recommendations: ["Уточнить анамнез"],
          citations: [{ source: "Клинические рекомендации", note: "", verified: false }],
        },
      ],
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "test-model",
      promptVersion: "test-prompt-1",
    })),
  };
  return {
    getAnalyzer: () => fake,
    listAnalyzerKeys: () => ["fake"],
    __fake: fake,
  };
});

const { getAnalyzer } = await import("../../modules/diagnostics/ai/analyzers.js");
await import("../../modules/diagnostics/index.js"); // регистрация модальностей

const DiagnosticCase = (
  await import("../../modules/diagnostics/core/models/diagnosticCase.model.js")
).default;
const DiagnosticJob = (
  await import("../../modules/diagnostics/core/models/diagnosticJob.model.js")
).default;
const DiagnosticFinding = (
  await import("../../modules/diagnostics/core/models/diagnosticFinding.model.js")
).default;

const {
  createCase,
  addArtifact,
  updateCase,
  getCaseFull,
  closeCase,
  setFindingVerdict,
  feedbackStats,
} = await import("../../modules/diagnostics/core/services/case.service.js");

const {
  queueAnalysis,
  runPendingJobs,
  collectAnalysisBlockers,
  planModalities,
  inputHashOf,
} = await import("../../modules/diagnostics/core/services/analysis.service.js");

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();

async function makeReadyCase() {
  const c = await createCase(
    {
      title: "Кашель и лихорадка",
      question: "Исключить пневмонию",
      clinicalContext: "Мужчина 54 лет, кашель 5 дней, температура 38.4",
      patient: { kind: "anonymous", ageYears: 54, sex: "male" },
    },
    { userId },
  );
  await addArtifact(
    c._id,
    {
      kind: "report",
      modality: "xray",
      text: "Рентген ОГК: усиление лёгочного рисунка, инфильтрат нижней доли справа",
    },
    userId,
  );
  // Оба гейта — только после них разбор возможен.
  await updateCase(c._id, { deidentified: true, aiConsent: true }, userId);
  return c;
}

beforeEach(() => {
  getAnalyzer().run.mockClear();
});

describe("гейты приватности", () => {
  it("без подтверждения обезличивания разбор не запускается", async () => {
    const c = await createCase({ question: "вопрос" }, { userId });
    await addArtifact(c._id, { kind: "text", text: "жалобы" }, userId);
    await updateCase(c._id, { aiConsent: true }, userId);

    await expect(queueAnalysis({ caseId: c._id, userId })).rejects.toThrow(/обезличен/i);
    expect(await DiagnosticJob.countDocuments({ caseId: c._id })).toBe(0);
  });

  it("без согласия на обработку внешней моделью разбор не запускается", async () => {
    const c = await createCase({ question: "вопрос" }, { userId });
    await addArtifact(c._id, { kind: "text", text: "жалобы" }, userId);
    await updateCase(c._id, { deidentified: true }, userId);

    await expect(queueAnalysis({ caseId: c._id, userId })).rejects.toThrow(/согласие/i);
  });

  it("пустое дело разбирать нечего", () => {
    const blockers = collectAnalysisBlockers(
      { deidentified: true, aiConsent: { confirmed: true }, status: "draft", clinicalContext: "" },
      [],
    );
    expect(blockers.join(" ")).toMatch(/материалы/i);
  });

  it("согласие фиксируется с меткой времени", async () => {
    const c = await createCase({}, { userId });
    await updateCase(c._id, { aiConsent: true }, userId);
    const doc = await DiagnosticCase.findById(c._id).lean();
    expect(doc.aiConsent.confirmed).toBe(true);
    expect(doc.aiConsent.at).toBeTruthy();
  });

  it("чужое дело недоступно", async () => {
    const c = await makeReadyCase();
    await expect(getCaseFull(c._id, otherUserId)).rejects.toThrow(/чужое/i);
  });
});

describe("выбор модальностей", () => {
  it("по составу материалов, плюс клинический разбор всегда", () => {
    const keys = planModalities({
      artifacts: [{ modality: "xray", kind: "report" }, { modality: "labs", kind: "lab_panel" }],
      requested: [],
    });
    expect(keys).toContain("xray");
    expect(keys).toContain("labs");
    expect(keys).toContain("clinical");
  });

  it("явный выбор врача важнее автоматики", () => {
    const keys = planModalities({
      artifacts: [{ modality: "xray", kind: "report" }],
      requested: ["ct", "mri"],
    });
    expect(keys).toEqual(["ct", "mri"]);
  });

  it("несуществующая модальность отбрасывается", () => {
    expect(planModalities({ artifacts: [], requested: ["выдумка"] })).toEqual([]);
  });
});

describe("прогон разбора", () => {
  it("создаёт задания, выводы и записывает происхождение", async () => {
    const c = await makeReadyCase();
    const jobs = await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");

    await runPendingJobs(c._id);

    const job = await DiagnosticJob.findOne({ caseId: c._id }).lean();
    expect(job.status).toBe("done");
    expect(job.findingsCount).toBe(1);
    // Происхождение: без него вывод нельзя ни воспроизвести, ни защитить.
    expect(job.provenance.model).toBe("test-model");
    expect(job.provenance.promptVersion).toBe("test-prompt-1");
    expect(job.provenance.inputHash).toHaveLength(32);
    expect(job.provenance.durationMs).toBeGreaterThanOrEqual(0);
    expect(job.provenance.inputTokens).toBe(100);
    // «Чего не хватает» доезжает до врача, а не теряется. Теперь отдельным
    // списком, а не строкой внутри message: на экране это свой блок, и
    // склеивать пробелы в текст, чтобы потом разбирать обратно, незачем.
    expect(job.dataGaps).toEqual(
      expect.arrayContaining([expect.stringMatching(/предыдущих исследований/)]),
    );
    // message остаётся кратким итогом разбора, а не свалкой.
    expect(job.message).not.toMatch(/Не хватает данных:/);
  });

  it("вывод всегда рекомендательный и с оговоркой", async () => {
    const c = await makeReadyCase();
    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    await runPendingJobs(c._id);

    const { findings, advisoryNotice } = await getCaseFull(c._id, userId);
    expect(findings[0].advisory).toBe(true);
    expect(findings[0].advisoryNotice).toMatch(/не диагноз/i);
    expect(advisoryNotice).toMatch(/врач/i);
    // Ссылка модели помечена как непроверенная.
    expect(findings[0].citations[0].verified).toBe(false);
  });

  it("несколько модальностей разбираются отдельными заданиями", async () => {
    const c = await makeReadyCase();
    await addArtifact(
      c._id,
      { kind: "lab_panel", modality: "labs", structured: { items: [{ key: "hgb", name: "Гемоглобин", value: "88", refText: "120-150" }] } },
      userId,
    );
    await queueAnalysis({ caseId: c._id, userId });
    await runPendingJobs(c._id);

    const jobs = await DiagnosticJob.find({ caseId: c._id }).lean();
    expect(jobs.map((j) => j.modality).sort()).toEqual(["clinical", "labs", "xray"]);
    expect(jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("сбой одного задания не роняет остальные", async () => {
    const c = await makeReadyCase();
    getAnalyzer().run.mockRejectedValueOnce(new Error("внешний сервис недоступен"));

    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray", "clinical"] });
    await runPendingJobs(c._id);

    const jobs = await DiagnosticJob.find({ caseId: c._id }).sort({ createdAt: 1 }).lean();
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].message).toMatch(/недоступен/);
    expect(jobs[1].status).toBe("done");
  });

  it("если разбирать нечего — задание помечается пропущенным, а не упавшим", async () => {
    const c = await makeReadyCase();
    getAnalyzer().run.mockResolvedValueOnce({ skipped: true, reason: "нет текста" });

    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    await runPendingJobs(c._id);

    const job = await DiagnosticJob.findOne({ caseId: c._id }).lean();
    expect(job.status).toBe("skipped");
    expect(job.message).toBe("нет текста");
  });

  it("счётчики дела обновляются после разбора", async () => {
    const c = await makeReadyCase();
    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    await runPendingJobs(c._id);

    const doc = await DiagnosticCase.findById(c._id).lean();
    expect(doc.counts.artifacts).toBe(1);
    expect(doc.counts.findings).toBe(1);
    expect(doc.status).toBe("ready");
  });

  it("одинаковый вход даёт одинаковый отпечаток, разный — разный", async () => {
    const base = { question: "q", clinicalContext: "ctx" };
    const a = inputHashOf({ caseDoc: base, artifacts: [{ kind: "text", text: "one" }] });
    const b = inputHashOf({ caseDoc: base, artifacts: [{ kind: "text", text: "one" }] });
    const c = inputHashOf({ caseDoc: base, artifacts: [{ kind: "text", text: "two" }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("шифрование данных пациента", () => {
  it("в базе тексты лежат зашифрованными, наружу отдаются расшифрованными", async () => {
    const c = await makeReadyCase();

    // Читаем СЫРОЙ документ мимо mongoose-геттеров.
    const raw = await mongoose.connection
      .collection("diagnostic_cases")
      .findOne({ _id: new mongoose.Types.ObjectId(c._id) });

    expect(raw.clinicalContext).not.toContain("кашель");
    expect(raw.clinicalContext).toMatch(/^[0-9a-f]{32}:/);

    const { case: presented } = await getCaseFull(c._id, userId);
    expect(presented.clinicalContext).toContain("кашель");
  });

  it("тексты выводов тоже шифруются", async () => {
    const c = await makeReadyCase();
    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    await runPendingJobs(c._id);

    const raw = await mongoose.connection
      .collection("diagnostic_findings")
      .findOne({ caseId: new mongoose.Types.ObjectId(c._id) });
    expect(raw.title).toMatch(/^[0-9a-f]{32}:/);

    const { findings } = await getCaseFull(c._id, userId);
    expect(findings[0].title).toContain("Вывод по xray");
  });
});

describe("вердикт врача — разметка будущего датасета", () => {
  it("сохраняется вместе с поправкой и временем", async () => {
    const c = await makeReadyCase();
    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    await runPendingJobs(c._id);
    const finding = await DiagnosticFinding.findOne({ caseId: c._id }).lean();

    const updated = await setFindingVerdict(
      finding._id,
      { verdict: "partly", correction: "Инфильтрат слева, а не справа" },
      userId,
    );
    expect(updated.verdict).toBe("partly");
    expect(updated.correction).toBe("Инфильтрат слева, а не справа");
    expect(updated.verdictAt).toBeTruthy();

    const stats = await feedbackStats(userId);
    expect(stats.xray.partly).toBe(1);
  });

  it("чужой вывод оценить нельзя", async () => {
    const c = await makeReadyCase();
    await queueAnalysis({ caseId: c._id, userId, modalities: ["xray"] });
    await runPendingJobs(c._id);
    const finding = await DiagnosticFinding.findOne({ caseId: c._id }).lean();

    await expect(
      setFindingVerdict(finding._id, { verdict: "agree" }, otherUserId),
    ).rejects.toThrow(/не найден/i);
  });
});

describe("закрытие дела", () => {
  it("требует вывода врача — итог пишет человек, а не модель", async () => {
    const c = await makeReadyCase();
    await expect(closeCase(c._id, { summary: "  " }, userId)).rejects.toThrow(/вывод врача/i);

    const closed = await closeCase(c._id, { summary: "Внебольничная пневмония, лечение начато" }, userId);
    expect(closed.status).toBe("closed");
    expect(closed.doctorSummary).toMatch(/пневмония/);
  });

  it("в закрытом деле разбор не запускается", async () => {
    const c = await makeReadyCase();
    await closeCase(c._id, { summary: "итог" }, userId);
    await expect(queueAnalysis({ caseId: c._id, userId })).rejects.toThrow(/закрыт/i);
  });
});
