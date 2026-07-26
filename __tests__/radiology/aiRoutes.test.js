// __tests__/radiology/aiRoutes.test.js
//
// Маршруты ИИ-генерации кейсов всех трёх станций арены. Сам генератор
// мокируем — здесь проверяется обвязка, которая и решает, попадёт ли запрос
// до модели: авторизация (роль author = admin) и валидация тела.
//
// Почему это важно проверить отдельно: генерация стоит денег и ходит в
// внешний API, поэтому дырка в роли или отсутствие валидации — это не только
// «мусорный кейс», но и способ жечь бюджет ключа чужими руками.

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";

// Мок генератора — до импорта роутера, чтобы Anthropic SDK и сеть не
// подгружались. Путь резолвится, поэтому мок ловит все три контроллера.
const generateLabCase = vi.fn();
const generateVpCase = vi.fn();
const generateRadiologyCase = vi.fn();
vi.mock("../../modules/radiology/ai/caseGenerator.js", () => ({
  generateLabCase: (...a) => generateLabCase(...a),
  generateVpCase: (...a) => generateVpCase(...a),
  generateRadiologyCase: (...a) => generateRadiologyCase(...a),
  isConfigured: () => true,
}));

const { default: radiologyRoutes } = await import(
  "../../modules/radiology/index.js"
);
const { createTestDoctor } = await import("../helpers/createTestUser.js");

// Минимальное приложение вместо полного index.js: сессию подставляем сами.
function appFor(userId) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    session({
      secret: "test_secret_at_least_16_chars_long",
      resave: false,
      saveUninitialized: false,
    }),
  );
  if (userId) {
    app.use((req, res, next) => {
      req.session.userId = String(userId);
      next();
    });
  }
  app.use("/api/v1/radiology", radiologyRoutes);
  return app;
}

const LAB_DRAFT = {
  title: "Анемия",
  clinicalContext: "Женщина 27 лет.",
  difficulty: "medium",
  panel: [
    { name: "Hb", value: "92", unit: "г/л", refRange: "120–150", significant: true },
    { name: "Ферритин", value: "4", unit: "нг/мл", refRange: "15–150", significant: true },
  ],
  impression: { correctText: "ЖДА", diagnosisKeys: ["жда"], diagnosisSynonyms: [] },
  usage: { inputTokens: 1, outputTokens: 2 },
};

beforeEach(() => {
  generateLabCase.mockReset().mockResolvedValue(LAB_DRAFT);
  generateVpCase.mockReset().mockResolvedValue({ title: "ХОБЛ", investigations: [] });
  generateRadiologyCase.mockReset().mockResolvedValue({ title: "Пневмоторакс", plannedFindings: [] });
});

describe("POST /api/v1/radiology/labs/ai/generate", () => {
  it("без авторизации → 401, модель не вызывается", async () => {
    await request(appFor(null))
      .post("/api/v1/radiology/labs/ai/generate")
      .send({ topic: "жда у молодой женщины" })
      .expect(401);
    expect(generateLabCase).not.toHaveBeenCalled();
  });

  it("учащемуся (не admin) → 403, модель не вызывается", async () => {
    const { userId } = await createTestDoctor({ role: "doctor" });
    await request(appFor(userId))
      .post("/api/v1/radiology/labs/ai/generate")
      .send({ topic: "жда у молодой женщины" })
      .expect(403);
    expect(generateLabCase).not.toHaveBeenCalled();
  });

  it("слишком короткая тема → 400 до обращения к модели", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    await request(appFor(userId))
      .post("/api/v1/radiology/labs/ai/generate")
      .send({ topic: "жд" })
      .expect(400);
    expect(generateLabCase).not.toHaveBeenCalled();
  });

  it("админу отдаёт черновик и передаёт подсказки в генератор", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    const res = await request(appFor(userId))
      .post("/api/v1/radiology/labs/ai/generate")
      .send({ topic: "жда у молодой женщины", difficulty: "hard", hint: "добавь норму" })
      .expect(200);

    expect(res.body.draft.panel).toHaveLength(2);
    expect(generateLabCase).toHaveBeenCalledWith({
      topic: "жда у молодой женщины",
      difficulty: "hard",
      hint: "добавь норму",
    });
  });
});

describe("POST /api/v1/radiology/vp/ai/generate", () => {
  it("учащемуся → 403", async () => {
    const { userId } = await createTestDoctor({ role: "doctor" });
    await request(appFor(userId))
      .post("/api/v1/radiology/vp/ai/generate")
      .send({ topic: "одышка у курильщика" })
      .expect(403);
    expect(generateVpCase).not.toHaveBeenCalled();
  });

  it("админу отдаёт черновик сценария", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    const res = await request(appFor(userId))
      .post("/api/v1/radiology/vp/ai/generate")
      .send({ topic: "одышка у курильщика" })
      .expect(200);

    expect(res.body.draft.title).toBe("ХОБЛ");
    expect(generateVpCase).toHaveBeenCalledWith({ topic: "одышка у курильщика" });
  });
});

describe("POST /api/v1/radiology/ai/generate (лучевой кейс)", () => {
  it("несуществующая модальность → 400", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    await request(appFor(userId))
      .post("/api/v1/radiology/ai/generate")
      .send({ modality: "телепатия", topic: "пневмоторакс справа" })
      .expect(400);
    expect(generateRadiologyCase).not.toHaveBeenCalled();
  });

  it("без темы → 400", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    await request(appFor(userId))
      .post("/api/v1/radiology/ai/generate")
      .send({ modality: "cxr" })
      .expect(400);
    expect(generateRadiologyCase).not.toHaveBeenCalled();
  });

  it("админу отдаёт черновик с планом находок", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    const res = await request(appFor(userId))
      .post("/api/v1/radiology/ai/generate")
      .send({ modality: "cxr", topic: "пневмоторакс справа", difficulty: "easy" })
      .expect(200);

    expect(res.body.draft).toHaveProperty("plannedFindings");
    expect(generateRadiologyCase).toHaveBeenCalledWith({
      modality: "cxr",
      topic: "пневмоторакс справа",
      difficulty: "easy",
    });
  });

  it("учащемуся → 403", async () => {
    const { userId } = await createTestDoctor({ role: "doctor" });
    await request(appFor(userId))
      .post("/api/v1/radiology/ai/generate")
      .send({ modality: "cxr", topic: "пневмоторакс справа" })
      .expect(403);
    expect(generateRadiologyCase).not.toHaveBeenCalled();
  });
});
