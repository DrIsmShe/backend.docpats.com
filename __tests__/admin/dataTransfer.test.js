// __tests__/admin/dataTransfer.test.js
//
// Выгрузка и загрузка базы через админку.
//
// Проверяется не «работает ли скачивание» — оно очевидно работает, — а четыре
// свойства, ради которых всё переписывалось:
//
//   1. дамп ПОЛНЫЙ и это доказуемо: типы не портятся, обрезанный файл
//      отбивается на входе, а не записывается наполовину;
//   2. одной сессии мало — нужен пароль;
//   3. каждое обращение к базе целиком попадает в HIPAA-журнал;
//   4. загрузкой нельзя дописать журнал аудита и завести администратора.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import express from "express";
import request from "supertest";
import argon2 from "argon2";
import { EJSON } from "bson";

import User from "../../common/models/Auth/users.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import {
  listDatabases,
  listCollections,
  exportDatabase,
  exportCollection,
  importDatabase,
  importCollection,
} from "../../modules/admin/controllers/adminDataTransfer.controller.js";

const PASSWORD = "Admin-Password-123";

let admin;
let app;

/** Приложение без сессий: подставляем req.userId так же, как requireAdmin. */
function buildApp(actingUserId) {
  const a = express();
  a.use(express.json({ limit: "50mb" }));
  a.use((req, _res, next) => {
    req.userId = String(actingUserId);
    req.userRole = "admin";
    next();
  });

  a.get("/transfer/databases", listDatabases);
  a.get("/transfer/collections", listCollections);
  a.post("/transfer/export-database", exportDatabase);
  a.post("/transfer/export-collection", exportCollection);

  // multer в тестах не нужен: подкладываем req.file вручную из тела.
  const asFile = (req, _res, next) => {
    if (req.body?.fileContent) {
      req.file = { buffer: Buffer.from(req.body.fileContent, "utf-8") };
    }
    next();
  };
  a.post("/transfer/import-database", asFile, importDatabase);
  a.post("/transfer/import-collection", asFile, importCollection);

  return a;
}

// Коллекции, созданные сырым драйвером, НЕ попадают под общую очистку между
// тестами: setup.js обходит те, что известны mongoose, а эти ему неизвестны.
// Поэтому чистим их сами — иначе документы копятся из теста в тест.
const RAW_COLLECTIONS = ["widgets", "gadgets", "sessions"];

/** Кладёт документы прямо в базу, минуя модели. */
async function seedRaw(collection, docs) {
  await mongoose.connection.db.collection(collection).insertMany(docs);
}

async function dropRaw() {
  for (const name of RAW_COLLECTIONS) {
    await mongoose.connection.db.collection(name).deleteMany({});
  }
}

beforeEach(async () => {
  await dropRaw();

  const created = await createTestDoctor({
    role: "admin",
    isDoctor: false,
    password: await argon2.hash(PASSWORD),
  });
  admin = created.user;
  app = buildApp(admin._id);

  // Имя тестовой базы у mongodb-memory-server своё, поэтому список
  // разрешённых баз подменяем на неё же — проверяем поведение, а не имена.
  process.env.MONGODB_DB = mongoose.connection.name;
});

const dbName = () => mongoose.connection.name;

describe("выгрузка базы", () => {
  it("требует пароль — одной сессии администратора мало", async () => {
    const res = await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName() });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/пароль/i);
  });

  it("отказывает при неверном пароле", async () => {
    const res = await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName(), password: "не тот" });

    expect(res.status).toBe(403);
  });

  it("не выгружает базу, которой нет в списке разрешённых", async () => {
    // Иначе параметр database стал бы способом прочитать служебные базы
    // кластера штатной кнопкой админки.
    const res = await request(app)
      .post("/transfer/export-database")
      .send({ database: "admin", password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/база/i);
  });

  it("отдаёт файл с отметкой о завершении и счётчиками", async () => {
    await seedRaw("widgets", [{ name: "первый" }, { name: "второй" }]);

    const res = await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName(), password: PASSWORD });

    expect(res.status).toBe(200);
    const dump = JSON.parse(res.text);

    expect(dump.completed).toBe(true);
    expect(dump.database).toBe(dbName());
    expect(dump.stats.widgets).toBe(2);
    expect(dump.collections.widgets).toHaveLength(2);
  });

  it("сохраняет типы BSON, а не превращает их в строки", async () => {
    // Это и есть «скачалось целиком»: обычный JSON рвёт ссылки между
    // документами, превращая ObjectId в строку, и восстановленная база
    // выглядит полной, но связей в ней нет.
    const ref = new mongoose.Types.ObjectId();
    const when = new Date("2026-08-12T10:00:00.000Z");
    await seedRaw("widgets", [{ ownerId: ref, createdAt: when, count: 7 }]);

    const res = await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName(), password: PASSWORD });

    const revived = EJSON.parse(res.text, { relaxed: false });
    const doc = revived.collections.widgets[0];

    // Сравниваем по типу BSON, а не instanceof: у mongoose своя копия bson,
    // и объекты из разных копий не проходят instanceof, оставаясь верными.
    expect(doc.ownerId?._bsontype).toBe("ObjectId");
    expect(String(doc.ownerId)).toBe(String(ref));
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.createdAt.toISOString()).toBe(when.toISOString());
  });

  it("не выгружает сессии — это живые ключи доступа", async () => {
    await seedRaw("sessions", [{ session: "секрет" }]);

    const res = await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName(), password: PASSWORD });

    const dump = JSON.parse(res.text);
    expect(dump.collections.sessions).toBeUndefined();
  });

  it("пишет выгрузку в HIPAA-журнал", async () => {
    await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName(), password: PASSWORD });

    // recordActionAsync не ждут — даём ему завершиться.
    await new Promise((r) => setTimeout(r, 150));

    const entry = await HIPAAAuditLog.findOne({ action: "admin.database.export" }).lean();
    expect(entry).toBeTruthy();
    expect(String(entry.userId)).toBe(String(admin._id));
    // Имя базы живёт в metadata: у resourceId тип ObjectId, строку туда не
    // записать — запись бы просто не прошла валидацию и потерялась.
    expect(entry.metadata.database).toBe(dbName());
  });

  it("пишет в журнал и неудачную попытку — это след подбора пароля", async () => {
    await request(app)
      .post("/transfer/export-database")
      .send({ database: dbName(), password: "не тот" });

    await new Promise((r) => setTimeout(r, 150));

    const entry = await HIPAAAuditLog.findOne({
      action: "admin.database.export",
      outcome: "denied",
    }).lean();
    expect(entry).toBeTruthy();
  });
});

describe("выгрузка одной коллекции", () => {
  it("отдаёт её в том же формате, что и полный дамп", async () => {
    await seedRaw("widgets", [{ name: "один" }]);
    await seedRaw("gadgets", [{ name: "другой" }]);

    const res = await request(app)
      .post("/transfer/export-collection")
      .send({ database: dbName(), collection: "widgets", password: PASSWORD });

    expect(res.status).toBe(200);
    const dump = JSON.parse(res.text);

    expect(dump.completed).toBe(true);
    expect(Object.keys(dump.collections)).toEqual(["widgets"]);
    // Чужая коллекция не просочилась.
    expect(dump.collections.gadgets).toBeUndefined();
  });

  it("честно отвечает, если коллекции нет", async () => {
    const res = await request(app)
      .post("/transfer/export-collection")
      .send({ database: dbName(), collection: "нетакой", password: PASSWORD });

    expect(res.status).toBe(404);
  });
});

describe("состав базы", () => {
  it("показывает коллекции со счётчиками", async () => {
    await seedRaw("widgets", [{ n: 1 }, { n: 2 }, { n: 3 }]);

    const res = await request(app)
      .get("/transfer/collections")
      .query({ database: dbName() });

    expect(res.status).toBe(200);
    const widgets = res.body.collections.find((c) => c.name === "widgets");
    expect(widgets.count).toBe(3);
    // Видно заранее, что во что можно загружать, а что защищено.
    expect(widgets.importable).toBe(true);
  });
});

describe("загрузка", () => {
  const dumpOf = (collections, stats) =>
    JSON.stringify({
      format: "docpats-dump-v2",
      database: "test",
      collections,
      stats,
      completed: true,
    });

  it("отбивает оборванный файл до записи в базу", async () => {
    // Обрезанная закачка: файл кончился на середине.
    const truncated = dumpOf({ widgets: [{ n: 1 }] }, { widgets: 1 }).slice(0, 60);

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: truncated });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/оборванная закачка|не разбирается/i);
    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(0);
  });

  it("отказывается от файла без отметки о завершении", async () => {
    const noFlag = JSON.stringify({
      format: "docpats-dump-v2",
      collections: { widgets: [{ n: 1 }] },
    });

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: noFlag });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/неполн/i);
  });

  it("отказывается, если документов меньше заявленного", async () => {
    // Файл «полный» по отметке, но счётчик не сходится — значит потерялось.
    const short = dumpOf({ widgets: [{ n: 1 }] }, { widgets: 5 });

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: short });

    const widgets = res.body.report.find((r) => r.collection === "widgets");
    expect(widgets.status).toBe("mismatch");
    expect(widgets.inserted).toBe(0);
  });

  it("восстанавливает ссылки между документами, а не строки", async () => {
    const ref = new mongoose.Types.ObjectId();
    const content = EJSON.stringify(
      {
        format: "docpats-dump-v2",
        collections: { widgets: [{ ownerId: ref }] },
        stats: { widgets: 1 },
        completed: true,
      },
      { relaxed: false },
    );

    await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: content });

    const doc = await mongoose.connection.db.collection("widgets").findOne({});
    expect(doc.ownerId?._bsontype).toBe("ObjectId");
    expect(String(doc.ownerId)).toBe(String(ref));
  });

  it("НЕ даёт дописать журнал аудита", async () => {
    // Журнал неизменяем хуками модели, но загрузка пишет сырым драйвером и
    // обошла бы их. Журнал, в который можно подмешать записи, перестаёт быть
    // доказательством.
    const forged = dumpOf(
      { hipaa_audit_logs: [{ action: "read", userId: admin._id }] },
      { hipaa_audit_logs: 1 },
    );

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: forged });

    const line = res.body.report.find((r) => r.collection === "hipaa_audit_logs");
    expect(line.status).toBe("refused");
    expect(line.inserted).toBe(0);
  });

  it("НЕ даёт завести пользователя загрузкой", async () => {
    // Иначе это чёрный ход: документ с role admin и своим хэшем пароля
    // переживёт смену пароля настоящего администратора.
    const forged = dumpOf(
      { users: [{ email: "x@y.z", role: "admin", password: "hash" }] },
      { users: 1 },
    );

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: forged });

    const line = res.body.report.find((r) => r.collection === "users");
    expect(line.status).toBe("refused");
    expect(await User.countDocuments({ email: "x@y.z" })).toBe(0);
  });

  it("загружает обычные коллекции и пишет это в журнал", async () => {
    const content = dumpOf({ widgets: [{ n: 1 }, { n: 2 }] }, { widgets: 2 });

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: content });

    expect(res.status).toBe(200);
    expect(res.body.insertedTotal).toBe(2);
    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(2);

    await new Promise((r) => setTimeout(r, 150));
    const entry = await HIPAAAuditLog.findOne({ action: "admin.database.import" }).lean();
    expect(entry).toBeTruthy();
  });

  it("повторная загрузка того же файла не удваивает данные", async () => {
    const content = dumpOf(
      { widgets: [{ _id: new mongoose.Types.ObjectId(), n: 1 }] },
      { widgets: 1 },
    );
    const send = () =>
      request(app)
        .post("/transfer/import-database")
        .send({ database: dbName(), password: PASSWORD, fileContent: content });

    await send();
    const res = await send();

    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(1);
    expect(res.body.report[0].status).toBe("partial");
  });

  it("берёт из файла одну названную коллекцию", async () => {
    const content = dumpOf(
      { widgets: [{ n: 1 }], gadgets: [{ n: 2 }] },
      { widgets: 1, gadgets: 1 },
    );

    await request(app)
      .post("/transfer/import-collection")
      .send({
        database: dbName(),
        collection: "widgets",
        password: PASSWORD,
        fileContent: content,
      });

    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(1);
    expect(await mongoose.connection.db.collection("gadgets").countDocuments()).toBe(0);
  });
});
