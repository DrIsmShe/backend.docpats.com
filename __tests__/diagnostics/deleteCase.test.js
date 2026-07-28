// __tests__/diagnostics/deleteCase.test.js
//
// Удаление дела.
//
// Главное здесь — КАСКАД. Дело хранится в четырёх коллекциях: само дело,
// материалы, задания и выводы. Удалить только дело значит оставить в базе
// материалы и выводы, которые ссылаются на несуществующее дело: их уже никто
// не покажет и не удалит, а внутри — текст пациента. Осиротевшие данные хуже
// неудалённых: неудалённые видно, осиротевшие нет.
//
// Второе — чужое дело не должно удаляться ничем и никогда. Проверка владельца
// здесь не формальность, а единственное, что разделяет врачей.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

await import("../../modules/diagnostics/index.js");

const DiagnosticCase = (
  await import("../../modules/diagnostics/core/models/diagnosticCase.model.js")
).default;
const DiagnosticArtifact = (
  await import("../../modules/diagnostics/core/models/diagnosticArtifact.model.js")
).default;
const DiagnosticJob = (
  await import("../../modules/diagnostics/core/models/diagnosticJob.model.js")
).default;
const DiagnosticFinding = (
  await import("../../modules/diagnostics/core/models/diagnosticFinding.model.js")
).default;

const { createCase, addArtifact, updateCase, closeCase, deleteCase, listCases } =
  await import("../../modules/diagnostics/core/services/case.service.js");
const { queueAnalysis } = await import(
  "../../modules/diagnostics/core/services/analysis.service.js"
);
const { ACTION_ENUM } = await import("../../modules/audit/enums/auditEnums.js");

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();

/** Дело со всем содержимым: материалы, задания, выводы. */
async function fullCase(owner = userId) {
  const c = await createCase(
    { title: "Кашель", clinicalContext: "мужчина 54 лет" },
    { userId: owner },
  );
  await addArtifact(
    c._id,
    { kind: "report", modality: "xray", text: "инфильтрат справа" },
    owner,
  );
  await updateCase(c._id, { deidentified: true, aiConsent: true }, owner);
  await queueAnalysis({ caseId: c._id, userId: owner });

  await DiagnosticFinding.create({
    caseId: c._id,
    jobId: new mongoose.Types.ObjectId(),
    ownerId: owner,
    modality: "xray",
    title: "Вывод",
    detail: "по тексту",
    severity: "note",
    confidence: "moderate",
  });
  return c;
}

describe("удаление уносит всё содержимое дела", () => {
  it("после удаления не остаётся ни материалов, ни заданий, ни выводов", async () => {
    const c = await fullCase();

    // Убеждаемся, что удалять действительно есть что: иначе тест зелёный
    // просто потому, что коллекции и так пустые.
    expect(await DiagnosticArtifact.countDocuments({ caseId: c._id })).toBeGreaterThan(0);
    expect(await DiagnosticJob.countDocuments({ caseId: c._id })).toBeGreaterThan(0);
    expect(await DiagnosticFinding.countDocuments({ caseId: c._id })).toBeGreaterThan(0);

    const out = await deleteCase(c._id, userId);

    expect(out.deleted).toBe(true);
    expect(await DiagnosticCase.countDocuments({ _id: c._id })).toBe(0);
    expect(await DiagnosticArtifact.countDocuments({ caseId: c._id })).toBe(0);
    expect(await DiagnosticJob.countDocuments({ caseId: c._id })).toBe(0);
    expect(await DiagnosticFinding.countDocuments({ caseId: c._id })).toBe(0);
  });

  it("возвращает состав удалённого — по нему видно, что потерялось", async () => {
    const c = await fullCase();
    const out = await deleteCase(c._id, userId);

    expect(out.counts.artifacts).toBeGreaterThan(0);
    expect(out.counts.findings).toBeGreaterThan(0);
    expect(out.counts.jobs).toBeGreaterThan(0);
  });

  it("соседние дела не задеваются", async () => {
    const keep = await fullCase();
    const drop = await fullCase();

    await deleteCase(drop._id, userId);

    expect(await DiagnosticCase.countDocuments({ _id: keep._id })).toBe(1);
    expect(await DiagnosticArtifact.countDocuments({ caseId: keep._id })).toBeGreaterThan(0);
    expect(await DiagnosticFinding.countDocuments({ caseId: keep._id })).toBeGreaterThan(0);
  });

  it("удалённое дело исчезает из списка врача", async () => {
    const c = await fullCase();
    const before = await listCases({ userId });
    await deleteCase(c._id, userId);
    const after = await listCases({ userId });

    expect(after.total).toBe(before.total - 1);
    expect(after.items.some((i) => String(i._id) === String(c._id))).toBe(false);
  });
});

describe("чужое дело не удаляется", () => {
  it("удаление чужого дела — «не найдено», и дело остаётся целым", async () => {
    const c = await fullCase(otherUserId);

    await expect(deleteCase(c._id, userId)).rejects.toThrow(/не найдено/i);

    expect(await DiagnosticCase.countDocuments({ _id: c._id })).toBe(1);
    expect(await DiagnosticArtifact.countDocuments({ caseId: c._id })).toBeGreaterThan(0);
  });

  it("несуществующее дело — тоже «не найдено», а не молчаливый успех", async () => {
    const ghost = new mongoose.Types.ObjectId();
    await expect(deleteCase(ghost, userId)).rejects.toThrow(/не найдено/i);
  });
});

describe("закрытое дело", () => {
  it("удаляется — закрытость не повод копить данные пациента", async () => {
    const c = await fullCase();
    await closeCase(c._id, { summary: "Вывод врача" }, userId);

    await expect(deleteCase(c._id, userId)).resolves.toMatchObject({ deleted: true });
    expect(await DiagnosticCase.countDocuments({ _id: c._id })).toBe(0);
  });
});

describe("след об удалении", () => {
  it("действие объявлено в журнале — иначе запись о нём не пройдёт", () => {
    // Справочник валидирует запись: незнакомое действие роняет её, и удаление
    // осталось бы без следа. Поймать это в проде было бы нечем.
    expect(ACTION_ENUM).toContain("diagnostics.case.delete");
  });
});
