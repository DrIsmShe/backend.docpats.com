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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  writeDump,
} from "../../modules/admin/controllers/adminDataTransfer.controller.js";

const PASSWORD = "Admin-Password-123";

let admin;
let app;
const tempFiles = [];

afterEach(() => {
  // Контроллер удаляет файл сам; здесь подчищаем то, что осталось после
  // отказов, — чтобы временная папка не росла от прогона к прогону.
  for (const path of tempFiles.splice(0)) {
    try {
      rmSync(path, { force: true });
    } catch {
      // уже удалён контроллером — так и должно быть
    }
  }
});

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

  // multer в тестах не нужен, но файл теперь читается С ДИСКА потоком —
  // значит и в тесте он должен быть настоящим файлом, иначе проверялся бы
  // не тот путь, которым идут данные в бою.
  const asFile = (req, _res, next) => {
    if (req.body?.fileContent) {
      const path = join(tmpdir(), `dump-test-${randomUUID()}.json`);
      writeFileSync(path, req.body.fileContent, "utf-8");
      tempFiles.push(path);
      req.file = { path };
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


// ── Загрузка ─────────────────────────────────────────────────────────────────
//
// Файлы для тестов пишет НАСТОЯЩИЙ writeDump — тот же, что отдаёт дамп
// администратору. Иначе тесты проверяли бы формат, придуманный в тестах, и
// разошлись бы с боевым молча. Порча файла делается явно, поверх настоящего.

/** Поддельная база: writeDump'у нужны только имя и курсор по коллекции. */
function fakeDb(data) {
  return {
    databaseName: "test",
    collection: (name) => ({
      find: () => ({
        async *[Symbol.asyncIterator]() {
          for (const doc of data[name] || []) yield doc;
        },
      }),
    }),
  };
}

/** Настоящий дамп из заданных коллекций. */
async function makeDump(data) {
  const parts = [];
  await writeDump({ write: (c) => parts.push(c) }, fakeDb(data), Object.keys(data));
  return parts.join("");
}

describe("загрузка", () => {
  it("отбивает оборванный файл до записи в базу", async () => {
    // Обрезанная закачка: файл кончился на середине.
    const full = await makeDump({ widgets: [{ n: 1 }, { n: 2 }] });
    const truncated = full.slice(0, Math.floor(full.length * 0.6));

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: truncated });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/неполн|оборванная/i);
    // Главное: до базы не дошло НИЧЕГО, хотя часть документов в файле была.
    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(0);
  });

  it("отказывается, если документов меньше заявленного", async () => {
    // Отметка о завершении на месте, но счётчик не сходится — файл побит.
    const full = await makeDump({ widgets: [{ n: 1 }, { n: 2 }] });
    const tampered = full.replace('"stats":{"widgets":2}', '"stats":{"widgets":5}');

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: tampered });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/не сходится/i);
    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(0);
  });

  it("не принимает посторонний JSON", async () => {
    const res = await request(app)
      .post("/transfer/import-database")
      .send({
        database: dbName(),
        password: PASSWORD,
        fileContent: JSON.stringify({ widgets: [{ n: 1 }] }),
      });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/формат/i);
  });

  it("восстанавливает ссылки между документами, а не строки", async () => {
    const ref = new mongoose.Types.ObjectId();
    const when = new Date("2026-08-12T10:00:00.000Z");
    const content = await makeDump({ widgets: [{ ownerId: ref, createdAt: when }] });

    await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: content });

    const doc = await mongoose.connection.db.collection("widgets").findOne({});
    expect(doc.ownerId?._bsontype).toBe("ObjectId");
    expect(String(doc.ownerId)).toBe(String(ref));
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.createdAt.toISOString()).toBe(when.toISOString());
  });

  it("НЕ даёт дописать журнал аудита", async () => {
    // Журнал неизменяем хуками модели, но загрузка пишет сырым драйвером и
    // обошла бы их. Журнал, в который можно подмешать записи, перестаёт быть
    // доказательством.
    const content = await makeDump({
      hipaa_audit_logs: [{ action: "read", userId: admin._id }],
    });

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: content });

    const line = res.body.report.find((r) => r.collection === "hipaa_audit_logs");
    expect(line.status).toBe("refused");
    expect(line.inserted).toBe(0);
  });

  it("НЕ даёт завести пользователя загрузкой", async () => {
    // Иначе это чёрный ход: документ с role admin и своим хэшем пароля
    // переживёт смену пароля настоящего администратора.
    const content = await makeDump({
      users: [{ email: "x@y.z", role: "admin", password: "hash" }],
    });

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: content });

    const line = res.body.report.find((r) => r.collection === "users");
    expect(line.status).toBe("refused");
    expect(await User.countDocuments({ email: "x@y.z" })).toBe(0);
  });

  it("загружает обычные коллекции и пишет это в журнал", async () => {
    const content = await makeDump({ widgets: [{ n: 1 }, { n: 2 }] });

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
    const content = await makeDump({
      widgets: [{ _id: new mongoose.Types.ObjectId(), n: 1 }],
    });
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
    const content = await makeDump({ widgets: [{ n: 1 }], gadgets: [{ n: 2 }] });

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

  it("переживает файл, который не помещается в одну строку JS", async () => {
    // Ради этого загрузка и переписана на поток. Дамп базы новостей весит
    // 1081 МБ, а строка длиннее ~512 МБ в V8 невозможна: прежняя загрузка
    // читала файл целиком в строку и такой дамп вернуть не могла.
    // Здесь объём меньше (тесты должны быть быстрыми), но путь ровно тот же:
    // файл читается с диска построчно и вставляется порциями.
    const many = Array.from({ length: 5000 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      n: i,
      text: "x".repeat(200),
    }));
    const content = await makeDump({ widgets: many });

    const res = await request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, fileContent: content });

    expect(res.status).toBe(200);
    // Ни один документ не потерялся на границах порций.
    expect(res.body.insertedTotal).toBe(5000);
    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(5000);
  });
});

// ── Режимы загрузки ──────────────────────────────────────────────────────────
//
// «Добавить» — не восстановление: документ с тем же _id пропускается, поэтому
// изменённые записи остаются старыми и база после загрузки не равна дампу.
// Здесь проверяется, что каждый режим делает ровно то, что обещает, и что
// разрушительный режим не трогает лишнего.

describe("режимы загрузки", () => {
  const ID = () => new mongoose.Types.ObjectId();

  async function dumpWith(docs) {
    return makeDump({ widgets: docs });
  }

  const load = (content, mode) =>
    request(app)
      .post("/transfer/import-database")
      .send({ database: dbName(), password: PASSWORD, mode, fileContent: content });

  it("«добавить» не трогает существующий документ", async () => {
    const id = ID();
    await seedRaw("widgets", [{ _id: id, name: "в базе" }]);
    const content = await dumpWith([{ _id: id, name: "из копии" }]);

    const res = await load(content, "add");

    const doc = await mongoose.connection.db.collection("widgets").findOne({ _id: id });
    expect(doc.name).toBe("в базе");
    expect(res.body.report[0].skipped).toBe(1);
  });

  it("«восстановить» замещает документ версией из копии", async () => {
    const id = ID();
    await seedRaw("widgets", [{ _id: id, name: "испорчено", лишнее: true }]);
    const content = await dumpWith([{ _id: id, name: "из копии" }]);

    const res = await load(content, "restore");

    const doc = await mongoose.connection.db.collection("widgets").findOne({ _id: id });
    expect(doc.name).toBe("из копии");
    // Замещение целиком: поля, которых нет в копии, не остаются.
    expect(doc.лишнее).toBeUndefined();
    expect(res.body.updatedTotal).toBe(1);
  });

  it("«восстановить» добавляет то, чего в базе нет", async () => {
    const content = await dumpWith([{ _id: ID(), name: "новый" }]);

    const res = await load(content, "restore");

    expect(res.body.insertedTotal).toBe(1);
    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(1);
  });

  it("«восстановить» оставляет записи, созданные после выгрузки", async () => {
    // Важная граница: это НЕ точное восстановление состояния. Документ,
    // появившийся после копии, в файле отсутствует — и остаётся на месте.
    const later = ID();
    await seedRaw("widgets", [{ _id: later, name: "появился позже" }]);
    const content = await dumpWith([{ _id: ID(), name: "из копии" }]);

    await load(content, "restore");

    expect(await mongoose.connection.db.collection("widgets").countDocuments()).toBe(2);
  });

  it("«заменить» даёт точное состояние копии", async () => {
    const later = ID();
    await seedRaw("widgets", [
      { _id: later, name: "появился позже" },
      { _id: ID(), name: "тоже лишний" },
    ]);
    const kept = ID();
    const content = await dumpWith([{ _id: kept, name: "из копии" }]);

    const res = await load(content, "replace");

    const all = await mongoose.connection.db.collection("widgets").find({}).toArray();
    expect(all).toHaveLength(1);
    expect(String(all[0]._id)).toBe(String(kept));
    expect(res.body.deletedTotal).toBe(2);
  });

  it("«заменить» не трогает коллекции, которых нет в файле", async () => {
    // «Восстановить из копии» не значит «стереть всё остальное».
    await seedRaw("gadgets", [{ name: "чужая коллекция" }]);
    const content = await dumpWith([{ _id: ID(), name: "из копии" }]);

    await load(content, "replace");

    expect(await mongoose.connection.db.collection("gadgets").countDocuments()).toBe(1);
  });

  it("защищённые коллекции не очищаются даже в режиме замены", async () => {
    // Иначе «замена» стала бы способом стереть журнал аудита — обойти его
    // неизменяемость не дописыванием, так удалением.
    const before = await HIPAAAuditLog.countDocuments();
    const content = await makeDump({
      hipaa_audit_logs: [{ action: "read", userId: admin._id }],
    });

    const res = await load(content, "replace");

    expect(res.body.report[0].status).toBe("refused");
    expect(await HIPAAAuditLog.countDocuments()).toBeGreaterThanOrEqual(before);
  });

  it("неизвестный режим считается самым безопасным", async () => {
    const id = ID();
    await seedRaw("widgets", [{ _id: id, name: "в базе" }]);
    const content = await dumpWith([{ _id: id, name: "из копии" }]);

    await load(content, "чтототакое");

    const doc = await mongoose.connection.db.collection("widgets").findOne({ _id: id });
    expect(doc.name).toBe("в базе");
  });

  it("режим попадает в журнал аудита", async () => {
    const content = await dumpWith([{ _id: ID(), name: "x" }]);
    await load(content, "replace");
    await new Promise((r) => setTimeout(r, 150));

    const entry = await HIPAAAuditLog.findOne({
      action: "admin.database.import",
    })
      .sort({ createdAt: -1 })
      .lean();
    expect(entry.metadata.mode).toBe("replace");
  });
});
