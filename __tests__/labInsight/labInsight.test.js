// __tests__/labInsight/labInsight.test.js
//
// Связка расшифровки: квота → чтение → арифметика → объяснение → запись.
//
// Модели замоканы: проверяем не качество текста, а порядок шагов и
// границы между ними. Границы здесь и есть суть модуля — судить о том,
// что тревожно, доверено арифметике, а объяснять доверено модели, и
// перепутать их нельзя.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const calls = { read: 0, explain: 0 };
let sheetResponse;
let explainResponse;

vi.mock("../../modules/labInsight/ai/labSheetReader.js", () => ({
  PROMPT_VERSION: "test-reader",
  readLabSheet: vi.fn(async () => {
    calls.read += 1;
    return sheetResponse;
  }),
}));

vi.mock("../../modules/labInsight/ai/labExplainer.js", () => ({
  PROMPT_VERSION: "test-explainer",
  explainLab: vi.fn(async ({ evaluated }) => {
    calls.explain += 1;
    return {
      ...explainResponse,
      items: explainResponse.items ?? evaluated.map((e) => ({
        name: e.name,
        whatItIs: `что такое ${e.name}`,
        whatItMeans: `значение ${e.level}`,
      })),
    };
  }),
}));

const svc = await import(
  "../../modules/labInsight/services/labInsight.service.js"
);
const LabInsight = (
  await import("../../modules/labInsight/models/labInsight.model.js")
).default;
const { createTestDoctor } = await import("../helpers/createTestUser.js");

const oid = () => new mongoose.Types.ObjectId();

function defaultSheet() {
  return {
    isLabSheet: true,
    labName: "Инвитро",
    collectedAt: "2026-08-10",
    parameters: [
      { name: "Гемоглобин", rawValue: "98", unit: "г/л", refText: "120-160" },
      { name: "Лейкоциты", rawValue: "6.1", unit: "10^9/л", refText: "4-9" },
    ],
    unreadable: [],
    model: "test-model",
    promptVersion: "test-reader",
  };
}

describe("расшифровка бланка", () => {
  let userId;

  beforeEach(async () => {
    calls.read = 0;
    calls.explain = 0;
    sheetResponse = defaultSheet();
    explainResponse = {
      overview: "Общий анализ крови с одним отклонением.",
      seeDoctor: "Покажите результат терапевту.",
      items: null,
      model: "test-model",
      promptVersion: "test-explainer",
    };
    const { user } = await createTestDoctor({
      subscriptionPlan: "doctor_pro",
      subscriptionEndsAt: new Date(Date.now() + 30 * 864e5),
    });
    userId = String(user._id);
  });

  it("разбирает бланк и считает отклонения САМ, а не спрашивает модель", async () => {
    const insight = await svc.createLabInsight({
      userId,
      buffer: Buffer.from("фото"),
      mimeType: "image/jpeg",
    });

    const hb = insight.parameters.find((p) => p.name === "Гемоглобин");
    // Модель про уровни ничего не сообщала — их посчитала арифметика.
    expect(["out", "far"]).toContain(hb.level);
    expect(hb.direction).toBe("low");
    expect(insight.summary.outOfRange).toBe(1);
  });

  it("фотография никуда не сохраняется — в базе только показатели", async () => {
    const insight = await svc.createLabInsight({
      userId,
      buffer: Buffer.from("фото"),
      mimeType: "image/jpeg",
    });

    const doc = await LabInsight.findById(insight.id).lean();
    const asText = JSON.stringify(doc);
    // Ни ключа файла, ни ссылки, ни base64 — бланк это ФИО и номер карты.
    expect(asText).not.toMatch(/фото/);
    expect(doc.attachedFile).toBeUndefined();
    expect(doc.fileKey).toBeUndefined();
  });

  it("объяснения сопоставляются по имени, а не по порядку", async () => {
    // Модель вернула пункты в обратном порядке и один лишний.
    explainResponse.items = [
      { name: "Лейкоциты", whatItIs: "белые клетки", whatItMeans: "норма" },
      { name: "Тромбоциты", whatItIs: "лишний", whatItMeans: "лишний" },
      { name: "Гемоглобин", whatItIs: "переносит кислород", whatItMeans: "ниже" },
    ];

    const insight = await svc.createLabInsight({
      userId,
      buffer: Buffer.from("x"),
      mimeType: "image/jpeg",
    });

    const hb = insight.parameters.find((p) => p.name === "Гемоглобин");
    // Сдвиг на один означал бы объяснение ЧУЖОГО показателя.
    expect(hb.whatItIs).toBe("переносит кислород");
    expect(insight.parameters).toHaveLength(2); // лишний не добавился
  });

  it("не бланк — понятный отказ, объяснение не запрашивается", async () => {
    sheetResponse = { ...defaultSheet(), isLabSheet: false, parameters: [] };

    await expect(
      svc.createLabInsight({
        userId,
        buffer: Buffer.from("x"),
        mimeType: "image/jpeg",
      }),
    ).rejects.toThrow(/не удалось распознать бланк/i);

    // Второй вызов модели не делаем: платить за объяснение того, чего
    // не прочитали, незачем.
    expect(calls.explain).toBe(0);
  });

  it("дата из будущего отбрасывается, а не записывается", async () => {
    const future = new Date(Date.now() + 10 * 864e5)
      .toISOString()
      .slice(0, 10);
    sheetResponse.collectedAt = future;

    const insight = await svc.createLabInsight({
      userId,
      buffer: Buffer.from("x"),
      mimeType: "image/jpeg",
    });

    // Почти наверняка ошибка распознавания; выдуманная дата хуже её
    // отсутствия.
    expect(insight.collectedAt).toBeNull();
  });

  it("непрочитанные строки сохраняются и отдаются", async () => {
    sheetResponse.unreadable = ["Третья строка смазана"];

    const insight = await svc.createLabInsight({
      userId,
      buffer: Buffer.from("x"),
      mimeType: "image/jpeg",
    });

    // Молча пропущенная строка опаснее отказа: человек не станет искать
    // то, о чём не знает.
    expect(insight.unreadable).toEqual(["Третья строка смазана"]);
  });

  it("чужой разбор не отдаётся даже по прямой ссылке", async () => {
    const insight = await svc.createLabInsight({
      userId,
      buffer: Buffer.from("x"),
      mimeType: "image/jpeg",
    });

    await expect(
      svc.getLabInsight({ userId: String(oid()), id: insight.id }),
    ).rejects.toThrow(/не найден/i);
  });

  it("исчерпанная квота отказывает ДО обращения к модели", async () => {
    // Бесплатный пациент: одна расшифровка в 30 дней.
    const { user } = await createTestDoctor({ role: "patient" });
    const patientId = String(user._id);

    await svc.createLabInsight({
      userId: patientId,
      buffer: Buffer.from("x"),
      mimeType: "image/jpeg",
    });
    const readsAfterFirst = calls.read;

    await expect(
      svc.createLabInsight({
        userId: patientId,
        buffer: Buffer.from("x"),
        mimeType: "image/jpeg",
      }),
    ).rejects.toThrow(/закончились/i);

    // Отказ, за который мы заплатили два вызова модели, — худший вид
    // отказа, и повторять его можно бесконечно.
    expect(calls.read).toBe(readsAfterFirst);
  });
});
