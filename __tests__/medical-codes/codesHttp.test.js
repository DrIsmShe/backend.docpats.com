// __tests__/medical-codes/codesHttp.test.js
//
// Справочник кодов НА УРОВНЕ HTTP.
//
// Тесты сервиса вызывают функции напрямую и не проходят через маршрут, разбор
// строки запроса и — главное — через авторизацию. А именно там решается, кого
// в справочник пускать: ошибка в этом слое не видна тестам сервиса вообще.

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

import MedicalCode, {
  CODE_SYSTEMS,
  normalizeCode,
  buildSearchText,
} from "../../modules/medicalCodes/models/medicalCode.model.js";
import { resetSearchStrategy } from "../../modules/medicalCodes/services/codeSearch.service.js";
import codesRouter from "../../modules/medicalCodes/routes/codes.routes.js";
import { requireMedicalStaff } from "../../modules/medicalCodes/middlewares/codesAuth.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import { errorHandler } from "../../common/middlewares/errorHandler.js";

/**
 * Мини-приложение с настоящим роутером и настоящей проверкой доступа.
 * Сессия подставляется вручную — express-session здесь не поднимается.
 */
function makeApp({ userId = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = userId ? { userId: String(userId) } : {};
    next();
  });
  app.use("/codes", requireMedicalStaff, codesRouter);
  app.use(errorHandler);
  return app;
}

/**
 * Пользователь с нужной ролью. Через общий хелпер, потому что модель User
 * требует зашифрованные поля и их хеши на этапе валидации — вручную это
 * повторять незачем.
 *
 * Роли берутся из enum User.role: doctor, patient, admin, clinic_admin,
 * clinic_staff. Роли `nurse` там нет — медсёстры это ClinicEmployee.
 */
async function makeUser(role, extra = {}) {
  const { user } = await createTestDoctor({
    role,
    isDoctor: role === "doctor",
    isPatient: role === "patient",
    ...extra,
  });
  return user;
}

async function seedCodes() {
  const rows = [
    { code: "J35.01", en: "Chronic tonsillitis", ru: "Хронический тонзиллит" },
    { code: "E11.9", en: "Type 2 diabetes mellitus", ru: "Сахарный диабет 2 типа" },
  ];

  await MedicalCode.insertMany(
    rows.map(({ code, en, ru }) => {
      const doc = {
        system: CODE_SYSTEMS.ICD10CM,
        code,
        codeNormalized: normalizeCode(code),
        titles: { en, ru, az: "", tr: "", ar: "" },
        parentCode: code.split(".")[0],
        isBillable: true,
        version: "2026",
      };
      return { ...doc, searchText: buildSearchText(doc) };
    }),
  );
}

describe("HTTP: справочник кодов — доступ", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seedCodes();
  });

  it("без сессии — 401", async () => {
    const res = await request(makeApp()).get("/codes/search?q=J35");
    expect(res.status).toBe(401);
  });

  it("пациента не пускает — 403", async () => {
    const patient = await makeUser("patient");
    const res = await request(makeApp({ userId: patient._id })).get(
      "/codes/search?q=J35",
    );
    expect(res.status).toBe(403);
  });

  it("заблокированного не пускает даже с медицинской ролью — 403", async () => {
    const blocked = await makeUser("doctor", { isBlocked: true });
    const res = await request(makeApp({ userId: blocked._id })).get(
      "/codes/search?q=J35",
    );
    expect(res.status).toBe(403);
  });

  it("врача пускает", async () => {
    const doctor = await makeUser("doctor");
    const res = await request(makeApp({ userId: doctor._id })).get(
      "/codes/search?q=J35",
    );
    expect(res.status).toBe(200);
  });

  it("сотрудника клиники пускает — он заполняет направления с уже назначенным кодом", async () => {
    const staff = await makeUser("clinic_staff");
    const res = await request(makeApp({ userId: staff._id })).get(
      "/codes/search?q=J35",
    );
    expect(res.status).toBe(200);
  });

  it("несуществующему пользователю в сессии — 401, а не 500", async () => {
    const ghostId = new mongoose.Types.ObjectId();
    const res = await request(makeApp({ userId: ghostId })).get(
      "/codes/search?q=J35",
    );
    expect(res.status).toBe(401);
  });
});

describe("HTTP: справочник кодов — поиск", () => {
  let app;

  beforeEach(async () => {
    resetSearchStrategy();
    await seedCodes();
    const doctor = await makeUser("doctor");
    app = makeApp({ userId: doctor._id });
  });

  it("находит по коду", async () => {
    const res = await request(app).get("/codes/search?q=J35.01");
    expect(res.status).toBe(200);
    expect(res.body.items[0].code).toBe("J35.01");
  });

  it("язык берётся из заголовка X-Language", async () => {
    const res = await request(app)
      .get("/codes/search?q=J35.01")
      .set("X-Language", "ru");
    expect(res.body.items[0].title).toBe("Хронический тонзиллит");
  });

  it("без заголовка отдаёт язык по умолчанию, а не падает", async () => {
    const res = await request(app).get("/codes/search?q=J35.01");
    expect(res.status).toBe(200);
    expect(res.body.items[0].title).toBeTruthy();
  });

  it("короткий запрос возвращает пустой список, а не ошибку", async () => {
    const res = await request(app).get("/codes/search?q=J");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("запрос без q не роняет сервер", async () => {
    const res = await request(app).get("/codes/search");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("limit сверх допустимого срезается, а не проходит в базу", async () => {
    const res = await request(app).get("/codes/search?q=J35&limit=9999");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });

  it("неизвестная система игнорируется, а не ломает запрос", async () => {
    const res = await request(app).get("/codes/search?q=J35&system=nonsense");
    expect(res.status).toBe(200);
  });
});

describe("HTTP: справочник кодов — точное получение и статистика", () => {
  let app;

  beforeEach(async () => {
    resetSearchStrategy();
    await seedCodes();
    const doctor = await makeUser("doctor");
    app = makeApp({ userId: doctor._id });
  });

  it("возвращает код по системе и номеру", async () => {
    const res = await request(app).get("/codes/icd10cm/J35.01");
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("J35.01");
  });

  it("несуществующий код — 404", async () => {
    const res = await request(app).get("/codes/icd10cm/Z99.99");
    expect(res.status).toBe(404);
  });

  it("статистика показывает загруженное и переведённое", async () => {
    const res = await request(app).get("/codes/stats");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.bySystem.icd10cm.translated.ru).toBe(2);
  });
});
