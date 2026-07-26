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

const verifyLabCase = vi.fn();
const verifyVpCase = vi.fn();
const verifyRadiologyCase = vi.fn();
vi.mock("../../modules/radiology/ai/caseVerifier.js", () => ({
  verifyLabCase: (...a) => verifyLabCase(...a),
  verifyVpCase: (...a) => verifyVpCase(...a),
  verifyRadiologyCase: (...a) => verifyRadiologyCase(...a),
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

const REVIEW = { verdict: "issues", issues: [{ target: "Hb", severity: "error", issue: "спорно", suggestion: "поправить" }], errorCount: 1, summary: "" };

beforeEach(() => {
  verifyLabCase.mockReset().mockResolvedValue(REVIEW);
  verifyVpCase.mockReset().mockResolvedValue(REVIEW);
  verifyRadiologyCase.mockReset().mockResolvedValue(REVIEW);
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

describe("POST .../ai/verify — второй проход", () => {
  const LAB_BODY = {
    draft: {
      title: "Анемия",
      panel: [
        { name: "Hb", value: "92", unit: "г/л", refRange: "120–150", significant: true },
        { name: "Ферритин", value: "4", unit: "нг/мл", refRange: "15–150", significant: true },
      ],
      impression: { correctText: "ЖДА", diagnosisKeys: ["жда"] },
    },
  };

  it("учащемуся → 403, проверка не запускается", async () => {
    const { userId } = await createTestDoctor({ role: "doctor" });
    await request(appFor(userId))
      .post("/api/v1/radiology/labs/ai/verify")
      .send(LAB_BODY)
      .expect(403);
    expect(verifyLabCase).not.toHaveBeenCalled();
  });

  it("пустой draft → 400 до обращения к модели", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    await request(appFor(userId))
      .post("/api/v1/radiology/labs/ai/verify")
      .send({ draft: { panel: [] } })
      .expect(400);
    expect(verifyLabCase).not.toHaveBeenCalled();
  });

  it("админу отдаёт замечания и передаёт кейс из формы", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    const res = await request(appFor(userId))
      .post("/api/v1/radiology/labs/ai/verify")
      .send(LAB_BODY)
      .expect(200);

    expect(res.body.review.errorCount).toBe(1);
    expect(verifyLabCase).toHaveBeenCalledTimes(1);
    // Рецензируется именно содержимое формы, а не id сохранённого кейса.
    expect(verifyLabCase.mock.calls[0][0].draft.panel).toHaveLength(2);
  });

  it("сценарий VP: админу 200, учащемуся 403", async () => {
    const vpBody = {
      draft: {
        title: "ХОБЛ",
        investigations: [
          { name: "Спирометрия", category: "Функциональная", resultText: "ОФВ1/ФЖЕЛ 0,49", necessary: true },
          { name: "D-димер", category: "Лаборатория", resultText: "норма", necessary: false },
        ],
        diagnosis: { diagnosisKeys: ["хобл"] },
      },
    };
    const admin = await createTestDoctor({ role: "admin" });
    await request(appFor(admin.userId))
      .post("/api/v1/radiology/vp/ai/verify")
      .send(vpBody)
      .expect(200);

    const learner = await createTestDoctor({ role: "doctor" });
    await request(appFor(learner.userId))
      .post("/api/v1/radiology/vp/ai/verify")
      .send(vpBody)
      .expect(403);
    expect(verifyVpCase).toHaveBeenCalledTimes(1);
  });

  it("лучевой кейс: плохая модальность → 400, валидный → 200", async () => {
    const { userId } = await createTestDoctor({ role: "admin" });
    const draft = {
      draft: {
        title: "Пневмоторакс",
        plannedFindings: [{ label: "pneumothorax", significance: "critical" }],
        impression: { diagnosisKeys: ["пневмоторакс"] },
      },
    };
    await request(appFor(userId))
      .post("/api/v1/radiology/ai/verify")
      .send({ modality: "телепатия", ...draft })
      .expect(400);
    expect(verifyRadiologyCase).not.toHaveBeenCalled();

    await request(appFor(userId))
      .post("/api/v1/radiology/ai/verify")
      .send({ modality: "cxr", ...draft })
      .expect(200);
    expect(verifyRadiologyCase).toHaveBeenCalledTimes(1);
  });
});
