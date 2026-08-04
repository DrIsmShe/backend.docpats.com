// __tests__/clinic-medical/examinationTemplateHttp.test.js
//
// Проверка справочника заготовок НА УРОВНЕ HTTP.
//
// Тесты сервиса вызывают функции напрямую и не проходят через маршрут,
// контроллер и разбор строки запроса — то есть ровно через тот слой, где
// браузер получил «Internal server error». Здесь поднимается настоящий
// express с тем же роутером, что и в приложении.

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import examinationTemplateRoutes from "../../modules/clinic/clinic-medical/routes/examinationTemplate.routes.js";

const oid = () => new mongoose.Types.ObjectId();

/**
 * Мини-приложение: контекст клиники ставится вручную вместо
 * tenantMiddleware — сессии и базы пользователей здесь нет.
 */
function makeApp({ clinicId, role = "doctor" }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const ctx = {
      userId: String(oid()),
      clinicId: String(clinicId),
      role,
      actorType: "user",
    };
    // Настоящий tenantMiddleware кладёт контекст В ДВА МЕСТА: в хранилище
    // (его читают сервисы) и на сам запрос (его читает buildActor для
    // журнала аудита). Тест, повторяющий только первое, не заметил бы
    // отсутствия актора — аудит падал бы молча, как и случилось на бою.
    req.tenantContext = ctx;
    runWithTenantContext(ctx, () => next());
  });
  app.use("/medical", examinationTemplateRoutes);
  return app;
}

describe("HTTP: справочник заготовок", () => {
  let app, clinicId;

  beforeEach(() => {
    clinicId = oid();
    app = makeApp({ clinicId });
  });

  it("GET списка протоколов отвечает 200", async () => {
    const res = await request(app)
      .get("/medical/examination-templates")
      .query({ scope: "examination", modality: "CT", kind: "report" });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("GET списка блоков приёма отвечает 200", async () => {
    const res = await request(app)
      .get("/medical/examination-templates")
      .query({ scope: "encounter", kind: "complaints" });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  // Именно так ходит страница справочника при открытии: без фильтров вообще.
  it("GET без параметров отвечает 200", async () => {
    const res = await request(app).get("/medical/examination-templates");
    expect(res.status).toBe(200);
  });

  it("POST создаёт заготовку протокола", async () => {
    const res = await request(app)
      .post("/medical/examination-templates")
      .send({ modality: "CT", kind: "report", title: "Норма", body: "Текст" });

    expect(res.status).toBe(201);
    expect(res.body.template.title).toBe("Норма");
  });

  it("POST создаёт заготовку приёма без вида исследования", async () => {
    const res = await request(app)
      .post("/medical/examination-templates")
      .send({ scope: "encounter", kind: "complaints", title: "Боли" });

    expect(res.status).toBe(201);
    expect(res.body.template.modality).toBeNull();
  });

  it("PATCH правит заготовку", async () => {
    const created = await request(app)
      .post("/medical/examination-templates")
      .send({ modality: "MRI", kind: "diagnosis", title: "Было" });

    const res = await request(app)
      .patch(`/medical/examination-templates/${created.body.template._id}`)
      .send({ title: "Стало" });

    expect(res.status).toBe(200);
    expect(res.body.template.title).toBe("Стало");
  });

  it("DELETE удаляет заготовку (администратор)", async () => {
    const admin = makeApp({ clinicId, role: "admin" });
    const created = await request(admin)
      .post("/medical/examination-templates")
      .send({ modality: "USG", kind: "report", title: "На удаление" });

    const res = await request(admin).delete(
      `/medical/examination-templates/${created.body.template._id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it("несуществующая заготовка — 404, а не 500", async () => {
    const res = await request(app).get(
      `/medical/examination-templates/${oid()}`,
    );
    expect(res.status).toBe(404);
  });

  it("мусор в параметрах — 4xx, а не 500", async () => {
    const res = await request(app)
      .get("/medical/examination-templates")
      .query({ scope: "нечто", kind: "чушь" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
