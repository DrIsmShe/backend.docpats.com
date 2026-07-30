// __tests__/radiology/caseTranslationRoutes.test.js
//
// Редакторские роуты переводов кейса.
//
// До них сервис перевода существовал, был покрыт тестами и вызывался при
// публикации — но наружу не выходил ни одним роутом. Практическое следствие
// было такое: если модель отказывала на одном языке, об этом знал только лог.
// В админке кейс выглядел нормально, а врач на этом языке читал русский текст.
// Поэтому тесты здесь проверяют не столько формат ответа, сколько что редактор
// действительно может увидеть состояние и вмешаться — и что вмешаться может
// только он.

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";

import User from "../../common/models/Auth/users.js";
import RadiologyCase from "../../modules/radiology/radiology-cases/models/radiologyCase.model.js";

vi.mock("../../modules/radiology/translation/caseTranslator.js", () => ({
  PROMPT_VERSION: "test",
  MODEL: "test-model",
  translateCaseContent: vi.fn(),
}));

const { translateCaseContent } = await import(
  "../../modules/radiology/translation/caseTranslator.js"
);
const radiologyRoutes = (await import("../../modules/radiology/index.js")).default;

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

let userCounter = 0;
async function makeUser(role) {
  userCounter += 1;
  return User.create({
    firstNameEncrypted: "Тест",
    lastNameEncrypted: "Тестов",
    emailEncrypted: `tr-${userCounter}@example.test`,
    emailHash: `placeholder-${userCounter}-email`,
    firstNameHash: `placeholder-${userCounter}-first`,
    lastNameHash: `placeholder-${userCounter}-last`,
    username: `truser${userCounter}`,
    password: "fake-hash",
    role,
    isDoctor: role === "doctor",
    isPatient: false,
    dateOfBirth: new Date("1990-01-01"),
    bio: "Тестовый пользователь",
    agreement: true,
  });
}

async function makeCase() {
  return RadiologyCase.create({
    modality: "cxr",
    title: "Одышка у мужчины 45 лет",
    clinicalContext: "Внезапная одышка после кашля.",
    difficulty: "medium",
    images: [{ url: "https://example.test/1.jpg", order: 0, label: "Прямая проекция" }],
    findings: [
      {
        key: "ptx",
        imageIndex: 0,
        label: "pneumothorax",
        significance: "major",
        geometry: { shape: "rect", coords: { x: 1, y: 1, w: 10, h: 10 } },
        explanation: "Виден край лёгкого без лёгочного рисунка латеральнее.",
      },
    ],
    impression: {
      correctText: "Правосторонний пневмоторакс среднего объёма.",
      diagnosisKeys: ["пневмоторакс"],
      diagnosisSynonyms: ["pneumothorax"],
    },
    source: { kind: "original" },
    status: "published",
  });
}

const BASE = "/api/v1/radiology/translations/radiology";

beforeEach(() => {
  vi.clearAllMocks();
  translateCaseContent.mockImplementation(async ({ targetLang, fields }) => ({
    fields: Object.fromEntries(
      Object.entries(fields).map(([p, t]) => [p, `[${targetLang}] ${t}`]),
    ),
    diagnosisKeys: [`${targetLang}-dx`],
    diagnosisSynonyms: [],
    model: "test-model",
    promptVersion: "test",
  }));
});

describe("доступ", () => {
  it("без авторизации — 401", async () => {
    const doc = await makeCase();
    const res = await request(appFor(null)).get(`${BASE}/${doc._id}`);
    expect(res.status).toBe(401);
  });

  it("врачу закрыто: это редакторский инструмент, у него перевод происходит сам", async () => {
    const doc = await makeCase();
    const doctor = await makeUser("doctor");
    const res = await request(appFor(doctor._id)).get(`${BASE}/${doc._id}`);
    expect(res.status).toBe(403);
  });
});

describe("состояние переводов", () => {
  it("у свежего кейса все четыре языка помечены как отсутствующие", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");

    const res = await request(appFor(admin._id)).get(`${BASE}/${doc._id}`);

    expect(res.status).toBe(200);
    expect(res.body.sourceLang).toBe("ru");
    expect(res.body.languages.map((l) => l.lang).sort()).toEqual(["ar", "az", "en", "tr"]);
    expect(res.body.languages.every((l) => l.status === "missing")).toBe(true);
  });

  it("неизвестная станция и неизвестный язык — 400, а не молчание", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);

    const badType = await request(app).get(
      `/api/v1/radiology/translations/mri-station/${doc._id}`,
    );
    expect(badType.status).toBe(400);

    await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });
    const badLang = await request(app)
      .put(`${BASE}/${doc._id}/de`)
      .send({ diagnosisKeys: ["x"] });
    expect(badLang.status).toBe(400);
  });
});

describe("вмешательство редактора", () => {
  it("перевод по кнопке и появление его в состоянии", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);

    const run = await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });
    expect(run.status).toBe(200);
    expect(run.body.report.created).toEqual([{ lang: "tr" }]);

    const state = await request(app).get(`${BASE}/${doc._id}`);
    const tr = state.body.languages.find((l) => l.lang === "tr");
    expect(tr.status).toBe("auto");
    expect(tr.fields.title).toBe("[tr] Одышка у мужчины 45 лет");
  });

  it("без langs переводит все языки, кроме языка оригинала", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");

    const run = await request(appFor(admin._id)).post(`${BASE}/${doc._id}/translate`).send({});

    expect(run.body.report.created.map((r) => r.lang).sort()).toEqual([
      "ar",
      "az",
      "en",
      "tr",
    ]);
  });

  it("ручная правка помечает перевод проверенным и защищает его от автоперевода", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);
    await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });

    const saved = await request(app)
      .put(`${BASE}/${doc._id}/tr`)
      .send({
        fields: { title: "Sağ pnömotoraks" },
        diagnosisKeys: ["pnömotoraks", "sağ pnömotoraks"],
      });
    expect(saved.status).toBe(200);
    expect(saved.body.translation.status).toBe("reviewed");

    // Обычный повторный перевод правку не затирает.
    const again = await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });
    expect(again.body.report.skipped).toEqual([{ lang: "tr", reason: "skip_reviewed" }]);

    const state = await request(app).get(`${BASE}/${doc._id}`);
    expect(state.body.languages.find((l) => l.lang === "tr").fields.title).toBe(
      "Sağ pnömotoraks",
    );
  });

  it("force не перезаписывает проверенный перевод: ручная правка защищена и от него", async () => {
    // Это не недоделка, а решение сервиса: стереть правку редактора одной
    // кнопкой нельзя. Поэтому в панели у проверенного языка кнопки «перевести
    // заново» и нет — она молча ничего бы не делала.
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);
    await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });
    await request(app)
      .put(`${BASE}/${doc._id}/tr`)
      .send({ fields: { title: "Правка редактора" }, diagnosisKeys: ["pnömotoraks"] });

    const forced = await request(app)
      .post(`${BASE}/${doc._id}/translate`)
      .send({ langs: ["tr"], force: true });

    expect(forced.body.report.skipped).toEqual([{ lang: "tr", reason: "skip_reviewed" }]);
    expect(forced.body.report.updated).toEqual([]);
  });

  it("порядок «снять проверено → перевести заново» перевод обновляет", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);
    await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });
    await request(app)
      .put(`${BASE}/${doc._id}/tr`)
      .send({ fields: { title: "Правка редактора" }, diagnosisKeys: ["pnömotoraks"] });

    await request(app).post(`${BASE}/${doc._id}/tr/unreview`);
    const again = await request(app)
      .post(`${BASE}/${doc._id}/translate`)
      .send({ langs: ["tr"], force: true });

    expect(again.body.report.updated).toEqual([{ lang: "tr" }]);
    const state = await request(app).get(`${BASE}/${doc._id}`);
    expect(state.body.languages.find((l) => l.lang === "tr").fields.title).toBe(
      "[tr] Одышка у мужчины 45 лет",
    );
  });

  it("пустой список принятых диагнозов отклоняется: иначе балл не получит никто", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);
    await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });

    const res = await request(app).put(`${BASE}/${doc._id}/tr`).send({ diagnosisKeys: [] });

    expect(res.status).toBe(400);
  });

  it("снятие «проверено» возвращает перевод под автообновление", async () => {
    const doc = await makeCase();
    const admin = await makeUser("admin");
    const app = appFor(admin._id);
    await request(app).post(`${BASE}/${doc._id}/translate`).send({ langs: ["tr"] });
    await request(app)
      .put(`${BASE}/${doc._id}/tr`)
      .send({ fields: { title: "Правка" }, diagnosisKeys: ["pnömotoraks"] });

    const un = await request(app).post(`${BASE}/${doc._id}/tr/unreview`);
    expect(un.status).toBe(200);
    expect(un.body.translation.status).toBe("auto");

    const state = await request(app).get(`${BASE}/${doc._id}`);
    // Хеш исходника не менялся, поэтому перевод снова считается свежим.
    expect(state.body.languages.find((l) => l.lang === "tr").status).toBe("auto");
  });
});
