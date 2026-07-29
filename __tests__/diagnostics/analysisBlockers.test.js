// __tests__/diagnostics/analysisBlockers.test.js
//
// Гейты запуска разбора.
//
// Главный здесь — файл, из которого не извлёкся текст. Реальный случай: врач
// приложил КТ околоносовых пазух, текст из снимка не извлёкся, разбор всё
// равно запустился и пришёл про внутричерепное образование — потому что
// разобрался текст, лежавший в деле с прошлого раза. Файл прошёл проверку как
// «материал», хотя в разборе не участвовал ни одним символом.
//
// Это худший вид ошибки в таком продукте: не отказ, который видно, а
// уверенный ответ не на тот вопрос.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DiagnosticFinding from "../../modules/diagnostics/core/models/diagnosticFinding.model.js";
import { collectAnalysisBlockers } from "../../modules/diagnostics/core/services/analysis.service.js";

// Дело, где все прочие гейты уже пройдены: обезличено, согласие есть, открыто.
const ready = {
  deidentified: true,
  aiConsent: { confirmed: true },
  status: "draft",
  clinicalContext: "текст, оставшийся в деле с прошлого раза",
};

describe("файл, из которого не извлёкся текст", () => {
  it("не даёт запустить разбор, когда ни из одного файла текст не извлёкся", () => {
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "image", text: "", structured: null },
    ]);
    expect(blockers.join(" ")).toMatch(/не извлёкся текст/i);
  });

  it("предупреждает, если текст не извлёкся только из части файлов", () => {
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "report", text: "Заключение: без патологии." },
      { kind: "image", text: "", structured: null },
    ]);
    expect(blockers.join(" ")).toMatch(/в разбор они не войдут/i);
  });

  it("структурированную панель показателей считает полноценным материалом", () => {
    // У панели нет text, но она разбирается labsAnalyzer'ом — это материал.
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "labs", text: "", structured: { items: [{ key: "hb", value: "90" }] } },
    ]);
    expect(blockers.join(" ")).not.toMatch(/не извлёкся текст/i);
  });

  it("читаемый документ по-прежнему пропускает разбор", () => {
    const blockers = collectAnalysisBlockers(ready, [
      { kind: "report", text: "КТ околоносовых пазух: пристеночный отёк слизистой." },
    ]);
    expect(blockers).toEqual([]);
  });

  it("пустое дело без файлов ловится прежней проверкой, а не новой", () => {
    const blockers = collectAnalysisBlockers(
      { ...ready, clinicalContext: "" },
      [],
    );
    expect(blockers.join(" ")).toMatch(/добавьте материалы/i);
    expect(blockers.join(" ")).not.toMatch(/не извлёкся текст/i);
  });
});

describe("прежние гейты не сломаны", () => {
  it("требует обезличивания и согласия", () => {
    const blockers = collectAnalysisBlockers(
      { deidentified: false, aiConsent: {}, status: "draft", clinicalContext: "есть" },
      [],
    );
    expect(blockers.join(" ")).toMatch(/обезличен/i);
    expect(blockers.join(" ")).toMatch(/согласие/i);
  });

  it("не даёт разбирать закрытое дело", () => {
    const blockers = collectAnalysisBlockers(
      { ...ready, status: "closed" },
      [{ kind: "report", text: "текст" }],
    );
    expect(blockers.join(" ")).toMatch(/закрыт/i);
  });
});

// ─── Повторный разбор ──────────────────────────────────────────────────
//
// Врач нажал «Разобрать заново», и выводов стало 17 вместо 8: новый набор
// дописался поверх старого. В списке оказались пары почти одинаковых пунктов
// с РАЗНОЙ важностью и уверенностью — «лимфаденопатия, критично, средняя»
// рядом с «лимфаденопатия, важно, низкая». Какой из двух актуален, по экрану
// понять было нельзя.

describe("повторный разбор не накапливает выводы", () => {
  it("выводы прежнего задания той же модальности удаляются", async () => {
    const caseId = new mongoose.Types.ObjectId();
    const ownerId = new mongoose.Types.ObjectId();
    const oldJob = new mongoose.Types.ObjectId();
    const newJob = new mongoose.Types.ObjectId();

    const base = { caseId, ownerId, modality: "clinical", severity: "important", confidence: "moderate" };
    await DiagnosticFinding.insertMany([
      { ...base, jobId: oldJob, title: "старый вывод", detail: "из прошлого разбора" },
      { ...base, jobId: oldJob, title: "второй старый", detail: "тоже прошлый" },
    ]);

    // Ровно та операция, которую делает runJob перед вставкой новых.
    await DiagnosticFinding.deleteMany({ caseId, modality: "clinical", jobId: { $ne: newJob } });
    await DiagnosticFinding.create({ ...base, jobId: newJob, title: "новый вывод", detail: "свежий" });

    // Сверяем по jobId, а не по title: заголовок шифруется как PHI, и .lean()
    // отдаёт его в виде iv:ciphertext, минуя расшифровку.
    const left = await DiagnosticFinding.find({ caseId }).lean();
    expect(left).toHaveLength(1);
    expect(String(left[0].jobId)).toBe(String(newJob));
  });

  it("выводы ДРУГОЙ модальности не трогаются", async () => {
    const caseId = new mongoose.Types.ObjectId();
    const ownerId = new mongoose.Types.ObjectId();
    const newJob = new mongoose.Types.ObjectId();
    const base = { caseId, ownerId, severity: "note", confidence: "low" };

    await DiagnosticFinding.insertMany([
      { ...base, modality: "labs", jobId: new mongoose.Types.ObjectId(), title: "по анализам", detail: "d" },
      { ...base, modality: "clinical", jobId: new mongoose.Types.ObjectId(), title: "старый клинический", detail: "d" },
    ]);

    await DiagnosticFinding.deleteMany({ caseId, modality: "clinical", jobId: { $ne: newJob } });

    const left = await DiagnosticFinding.find({ caseId }).lean();
    expect(left).toHaveLength(1);
    expect(left[0].modality).toBe("labs");
  });
});

// ─── Ответ и пробелы берутся с АКТУАЛЬНЫХ заданий ─────────────────────
//
// Задания копятся: каждое «Разобрать заново» добавляет новое, прежние остаются
// в истории ради происхождения. Их выводы удаляются, а summary и dataGaps —
// нет. Без отбора врач увидел бы четыре ответа подряд, три из них от разборов,
// которых на экране уже нет. Та же ошибка, что была с выводами, но в другом
// месте.

describe("ответ и пробелы — только последнего задания модальности", () => {
  it("из четырёх заданий одной модальности берётся последнее", async () => {
    const { getCaseFull } = await import(
      "../../modules/diagnostics/core/services/case.service.js"
    );
    const DiagnosticCase = (
      await import("../../modules/diagnostics/core/models/diagnosticCase.model.js")
    ).default;
    const DiagnosticJob = (
      await import("../../modules/diagnostics/core/models/diagnosticJob.model.js")
    ).default;

    const ownerId = new mongoose.Types.ObjectId();
    const c = await DiagnosticCase.create({
      ownerId,
      clinicalContext: "случай",
      deidentified: true,
      aiConsent: { confirmed: true },
    });

    for (const [i, text] of ["первый", "второй", "третий"].entries()) {
      await DiagnosticJob.create({
        caseId: c._id,
        ownerId,
        modality: "clinical",
        analyzer: "clinical",
        status: "done",
        message: `ответ ${text}`,
        dataGaps: [`пробел ${text}`],
        createdAt: new Date(2026, 0, 1, 10, i),
      });
    }
    // Другая модальность — её актуальное задание должно остаться.
    await DiagnosticJob.create({
      caseId: c._id,
      ownerId,
      modality: "labs",
      analyzer: "labs",
      status: "done",
      message: "ответ по анализам",
      dataGaps: ["пробел по анализам"],
    });

    const full = await getCaseFull(c._id, ownerId);

    expect(full.summaries).toHaveLength(2);
    expect(full.summaries.map((s) => s.text).sort()).toEqual(
      ["ответ по анализам", "ответ третий"].sort(),
    );
    expect(full.dataGaps.sort()).toEqual(["пробел по анализам", "пробел третий"].sort());
  });
});
