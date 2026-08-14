// __tests__/admin/adminDashboard.test.js
//
// Сводка для главной страницы админпанели.
//
// Проверяется не «вернулось 200», а три свойства, на которых страница
// держится:
//
//   1. ДОСТУП. Сводка раскрывает объёмы всей платформы — она только админу.
//   2. УСТОЙЧИВОСТЬ. Половины коллекций в свежей базе просто нет. Раньше на
//      этом падал бы весь дашборд; здесь недостающая коллекция обязана
//      давать ноль, а не ошибку.
//   3. ДИНАМИКА. Прирост считается только от непустого прошлого периода:
//      рост с нуля до трёх — это не «+300 %», и подписывать его процентом
//      нельзя.

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

import adminOverviewRoute from "../../modules/admin/routes/adminOverviewRoute.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

function makeApp({ userId = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = userId ? { userId: String(userId) } : {};
    next();
  });
  app.use("/admin", adminOverviewRoute);
  return app;
}

async function makeAdmin() {
  const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });
  return userId;
}

describe("сводка админпанели", () => {
  let admin;

  beforeEach(async () => {
    admin = await makeAdmin();
  });

  it("закрыта без сессии", async () => {
    const res = await request(makeApp()).get("/admin/dashboard");
    expect([401, 403]).toContain(res.status);
  });

  it("закрыта для врача", async () => {
    const { userId } = await createTestDoctor();
    const res = await request(makeApp({ userId })).get("/admin/dashboard");
    expect(res.status).toBe(403);
  });

  it("отдаёт все блоки, даже когда коллекций ещё нет", async () => {
    const res = await request(makeApp({ userId: admin })).get("/admin/dashboard");

    expect(res.status).toBe(200);
    for (const key of [
      "metrics",
      "queue",
      "sections",
      "series",
      "activity",
      "health",
    ]) {
      expect(res.body).toHaveProperty(key);
    }

    // Ни одной коллекции арены в пустой базе нет — должны быть нули.
    expect(res.body.sections.radiologyCases).toBe(0);
    expect(res.body.queue.doctorVerification).toBe(0);
  });

  it("считает заведённых пользователей и сегодняшний прирост", async () => {
    // Администратор из beforeEach — уже пользователь, плюс заведём врача.
    await createTestDoctor();

    const res = await request(makeApp({ userId: admin })).get("/admin/dashboard");

    expect(res.body.metrics.users.total).toBeGreaterThanOrEqual(2);
    expect(res.body.metrics.users.today).toBeGreaterThanOrEqual(2);
  });

  it("не подписывает процентом рост с нуля", async () => {
    const res = await request(makeApp({ userId: admin })).get("/admin/dashboard");

    // Прошлого периода не существует, поэтому процент не считается —
    // страница в этом случае просто не рисует плашку.
    expect(res.body.metrics.users.trend).toBeNull();
  });

  it("ряд для графика — ровно две недели подряд", async () => {
    const res = await request(makeApp({ userId: admin })).get("/admin/dashboard");
    const series = res.body.series.users;

    expect(series).toHaveLength(14);
    // Дни идут по возрастанию и без пропусков: график рисуется прямо по
    // массиву, дыра в нём исказила бы линию.
    const days = series.map((p) => p.date);
    expect([...days].sort()).toEqual(days);
    expect(series.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("показывает врача, ждущего верификации", async () => {
    const { userId } = await createTestDoctor();
    await mongoose.connection.db
      .collection("doctorprofiles")
      .insertOne({ userId, verificationStatus: "pending" });

    const res = await request(makeApp({ userId: admin })).get("/admin/dashboard");
    expect(res.body.queue.doctorVerification).toBe(1);
  });

  it("сообщает, что база на связи", async () => {
    const res = await request(makeApp({ userId: admin })).get("/admin/dashboard");
    expect(res.body.health.mongo).toBe(true);
    expect(res.body.health.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
