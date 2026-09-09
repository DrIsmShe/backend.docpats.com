// Экран «Модели ИИ» в админке — по HTTP, а не в обход маршрута.
//
// Проверяется то, что нельзя увидеть тестом сервиса: что маршрут вообще
// поднят, что доступ закрыт для всех, кроме администратора проекта, что
// форма экрана строится из ответа сервера (иначе список назначений
// придётся дублировать в интерфейсе и он разъедется), и что сохранение
// действительно меняет то, чем платформа работает дальше.

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { createTestDoctor } from "../helpers/createTestUser.js";
import { сброситьКэшИИ, провайдерДля } from "../../common/ai/provider.js";
import {
  getAiSettings,
  patchAiSettings,
} from "../../modules/admin/controllers/aiSettings.controller.js";
import requireAdmin from "../../modules/admin/middlewares/authvalidateMiddleware/requireAdmin.js";
import { errorHandler } from "../../common/middlewares/errorHandler.js";

/** Приложение, повторяющее монтирование из modules/admin/index.js. */
function приложение(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = userId ? { userId: String(userId) } : {};
    next();
  });
  app.get("/ai-settings", requireAdmin, getAiSettings);
  app.patch("/ai-settings", requireAdmin, patchAiSettings);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  сброситьКэшИИ();
  delete process.env.AI_PROVIDER;
});

describe("админка: модели ИИ", () => {
  it("без администратора не отдаётся", async () => {
    // Выбор модели — это выбор того, чем платформа думает и сколько это
    // стоит: у обычного врача такого права нет.
    const { userId } = await createTestDoctor();
    await request(приложение(userId)).get("/ai-settings").expect(403);
    await request(приложение(null)).get("/ai-settings").expect(401);
  });

  it("отдаёт текущее состояние и справочник для формы", async () => {
    const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });

    const res = await request(приложение(userId)).get("/ai-settings").expect(200);

    expect(res.body.provider).toBe("anthropic");
    // Список назначений приходит с сервера: продублировать его в
    // интерфейсе значило бы получить два списка, которые разъедутся.
    const ключи = res.body.catalog.tasks.map((з) => з.key);
    expect(ключи).toEqual(
      expect.arrayContaining(["translation", "chat", "summary", "consultation"]),
    );
    // У каждой задачи есть подпись «где это применяется» — без неё экран
    // «провайдер для summary» ничего не говорит человеку.
    expect(res.body.catalog.tasks[0].title).toBeTruthy();
  });

  it("сохранение провайдера действует на следующую задачу", async () => {
    const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });

    await request(приложение(userId))
      .patch("/ai-settings")
      .send({ provider: "openai" })
      .expect(200);

    expect((await провайдерДля("summary")).provider).toBe("openai");
  });

  it("часть проекта переключается отдельно от остальных", async () => {
    const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });

    await request(приложение(userId))
      .patch("/ai-settings")
      .send({ provider: "anthropic" })
      .expect(200);

    await request(приложение(userId))
      .patch("/ai-settings")
      .send({ tasks: { translation: { provider: "openai", model: "gpt-4o-mini" } } })
      .expect(200);

    expect((await провайдерДля("translation")).provider).toBe("openai");
    expect((await провайдерДля("translation")).model).toBe("gpt-4o-mini");
    // Соседнее назначение осталось на общем провайдере.
    expect((await провайдерДля("consultation")).provider).toBe("anthropic");
  });

  it("невозможный выбор отбивается с объяснением, а не молча", async () => {
    const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });

    const res = await request(приложение(userId))
      .patch("/ai-settings")
      .send({ tasks: { speech: { provider: "anthropic" } } })
      .expect(400);

    expect(res.body.error).toMatch(/не выполняется/i);
  });

  it("пустой запрос не считается сохранением", async () => {
    const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });

    await request(приложение(userId)).patch("/ai-settings").send({}).expect(400);
  });

  it("ответ не содержит ключей API", async () => {
    // Админка показывает, ЧТО выбрано, а не чем мы платим.
    const { userId } = await createTestDoctor({ role: "admin", isDoctor: false });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-value";

    const res = await request(приложение(userId)).get("/ai-settings").expect(200);

    expect(JSON.stringify(res.body)).not.toContain("sk-ant-test-value");
  });
});
