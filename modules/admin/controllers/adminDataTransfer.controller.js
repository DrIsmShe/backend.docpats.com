// modules/admin/controllers/adminDataTransfer.controller.js
//
// Выгрузка и загрузка данных администратором: вся база целиком или отдельные
// коллекции, по обеим базам платформы.
//
// ЧТО ЗДЕСЬ ИСПРАВЛЕНО ПО СРАВНЕНИЮ С ПРЕЖНИМИ КОНТРОЛЛЕРАМИ
//
// 1. ПОТОК ВМЕСТО ПАМЯТИ. Раньше дамп собирался в один объект и превращался в
//    одну строку через JSON.stringify(result, null, 2). На боевой базе это 85 МБ
//    данных → ~170 МБ строки, и всё это в куче одного процесса, который
//    обслуживает врачей: на время сборки event loop стоял, а запас до предела
//    кучи таял по мере роста справочника кодов. Теперь документы уходят в ответ
//    по одному, курсором, и память не зависит от размера базы.
//
// 2. EJSON ВМЕСТО JSON. Обычный JSON.stringify необратимо портит типы BSON:
//    ObjectId становится строкой, Date — строкой, Decimal128 и Binary теряются.
//    Прежний импорт восстанавливал ObjectId только у _id, поэтому ВСЕ ссылки
//    между документами (authorId, patientRef, clinicId…) после круга
//    экспорт → импорт превращались в строки, и связи молча рвались. Дамп
//    выглядел полным, а базой не был. Канонический EJSON сохраняет типы точно.
//
// 3. ПРИЗНАК ЗАВЕРШЁННОСТИ. Файл заканчивается полем "completed": true и
//    счётчиками по коллекциям. Оборванная закачка (разрыв связи, нехватка
//    места) даёт файл, который не только не содержит этого поля, но и вообще
//    не разбирается как JSON. Импорт это проверяет — «скачалось не всё»
//    обнаруживается до записи в базу, а не после.
//
// 4. АУДИТ. Каждая выгрузка и загрузка пишется в hipaa_audit_logs. Это и было
//    главным разрывом: просмотр одной карточки пациента журналировался, а
//    скачивание всей базы — нет.
//
// 5. ПОДТВЕРЖДЕНИЕ ПАРОЛЕМ. Одной украденной сессии больше недостаточно.
//
// 6. ЗАЩИЩЁННЫЕ КОЛЛЕКЦИИ ПРИ ЗАГРУЗКЕ. Прежний импорт писал сырым драйвером в
//    любую коллекцию, минуя Mongoose. Это позволяло дописать записи в
//    hipaa_audit_logs (журнал, чья неизменяемость держится на хуках модели) и
//    завести пользователя с ролью admin. Скачивать их можно, записывать —
//    нельзя.

import mongoose from "mongoose";
import { EJSON } from "bson";
import argon2 from "argon2";

import User from "../../../common/models/Auth/users.js";
import { auditAdminAccess } from "../adminAudit.js";

/* ───────────────────────── Базы ───────────────────────── */

// Обе базы живут на одном кластере Atlas, поэтому доступны через то же
// соединение — тем же способом, каким common/sitemap читает новости.
//
// Список закрытый НАМЕРЕННО. Без него параметр db стал бы способом прочитать
// служебные базы кластера (admin, config, local) через штатную кнопку админки.
// Читаем окружение при КАЖДОМ обращении, а не один раз при загрузке модуля:
// имя основной базы приходит из .env, и застывший на этапе импорта список
// расходится с реальностью везде, где переменные устанавливаются позже
// (тесты, запуск скриптом, смена базы без пересборки).
export const mainDb = () => process.env.MONGODB_DB || "DOCPATS_NEW";
export const newsDb = () => process.env.NEWS_MONGODB_DB || "DOCPATS_AI_NEWS";

export function allowedDatabases() {
  return [
    { name: mainDb(), title: "Основная база платформы", phi: true },
    { name: newsDb(), title: "Движок новостей и аналитики", phi: false },
  ];
}

// Коллекции, которые не выгружаются: смысла в них нет, а сессии — это живые
// ключи доступа, и место им не в файле на диске у администратора.
const SKIP_ON_EXPORT = new Set(["sessions"]);

// Коллекции, в которые нельзя писать загрузкой.
//
// hipaa_audit_logs — журнал, на который опирается разбор инцидентов; его
// неизменяемость обеспечена хуками модели, а сырой драйвер их обходит.
// users — потому что документ с role: "admin" и своим хэшем пароля это
// постоянный чёрный ход, переживающий смену пароля настоящего администратора.
const PROTECTED_ON_IMPORT = new Set([
  "hipaa_audit_logs",
  "auditlogs",
  "users",
  "sessions",
]);

function resolveDatabase(requested) {
  const name = String(requested || mainDb()).trim();
  const allowed = allowedDatabases().find((d) => d.name === name);
  if (!allowed) return null;
  return mongoose.connection.getClient().db(allowed.name);
}

/* ──────────────────── Подтверждение паролем ──────────────────── */

/**
 * Проверяет пароль администратора.
 *
 * Отдельно от requireAdmin: тот отвечает на вопрос «это админ?», а здесь —
 * «это он сам, прямо сейчас?». Разница существенна ровно для таких действий:
 * украденная сессия проходит первую проверку и не проходит вторую.
 *
 * @returns {Promise<true|{status:number, message:string}>}
 */
async function verifyAdminPassword(req) {
  const password = req.body?.password;
  if (!password || typeof password !== "string") {
    return { status: 400, message: "Введите пароль администратора" };
  }

  const admin = await User.findById(req.userId).select("+password").lean();
  if (!admin?.password) {
    return { status: 500, message: "Не удалось проверить пароль" };
  }

  let ok = false;
  try {
    ok = await argon2.verify(admin.password, password);
  } catch {
    ok = false;
  }

  if (!ok) return { status: 403, message: "Неверный пароль" };
  return true;
}

/** Общее начало для всех операций переноса: пароль + база. */
async function authorize(req, res, { action, resourceType, scope = {} }) {
  const db = resolveDatabase(req.body?.database ?? req.query?.database);
  if (!db) {
    res.status(400).json({ message: "Неизвестная база данных" });
    return null;
  }

  const check = await verifyAdminPassword(req);
  if (check !== true) {
    // Неудачную попытку пишем в журнал ТОЖЕ: серия отказов на выгрузке базы —
    // это и есть признак подбора пароля, ради которого журнал существует.
    auditAdminAccess(req, {
      action,
      resourceType,
      outcome: check.status === 403 ? "denied" : "failure",
      metadata: { ...scope, database: db.databaseName, reason: check.message },
    });
    res.status(check.status).json({ message: check.message });
    return null;
  }

  return db;
}

/* ───────────────────────── Состав базы ───────────────────────── */

/** GET /api/admin/transfer/databases — какие базы доступны. */
export async function listDatabases(req, res) {
  res.json({ databases: allowedDatabases() });
}

/**
 * GET /api/admin/transfer/collections?database=…
 *
 * Список коллекций со счётчиками и размером. Нужен не для красоты: перед
 * выгрузкой видно, что именно уедет и сколько это весит, а после — с чем
 * сверять.
 */
export async function listCollections(req, res) {
  try {
    const db = resolveDatabase(req.query?.database);
    if (!db) return res.status(400).json({ message: "Неизвестная база данных" });

    const infos = await db.listCollections().toArray();
    const collections = [];

    for (const info of infos) {
      if (info.name.startsWith("system.")) continue;
      let count = 0;
      let size = 0;
      try {
        const stats = await db.command({ collStats: info.name });
        count = stats.count ?? 0;
        size = stats.size ?? 0;
      } catch {
        count = await db.collection(info.name).estimatedDocumentCount();
      }
      collections.push({
        name: info.name,
        count,
        size,
        exportable: !SKIP_ON_EXPORT.has(info.name),
        importable: !PROTECTED_ON_IMPORT.has(info.name),
      });
    }

    collections.sort((a, b) => b.count - a.count);

    auditAdminAccess(req, {
      action: "admin.database.list",
      resourceType: "database",
      metadata: { database: db.databaseName, collectionCount: collections.length },
    });

    res.json({
      database: db.databaseName,
      collections,
      totalDocuments: collections.reduce((sum, c) => sum + c.count, 0),
      totalSize: collections.reduce((sum, c) => sum + c.size, 0),
    });
  } catch (err) {
    console.error("❌ listCollections error:", err);
    res.status(500).json({ message: "Не удалось прочитать состав базы" });
  }
}

/* ───────────────────────── Выгрузка ───────────────────────── */

const FORMAT = "docpats-dump-v2";

function startDownload(res, filename) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Отключаем сжатие и буферизацию посредников: ответ длинный и идёт потоком,
  // накапливать его целиком где-то по дороге — вернуться к той же проблеме
  // с памятью, только этажом выше.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
}

/**
 * Пишет содержимое одной коллекции как массив EJSON, документ за документом.
 * @returns {Promise<number>} сколько документов записано
 */
async function streamCollection(res, db, name) {
  const cursor = db.collection(name).find({});
  let written = 0;

  res.write("[");
  for await (const doc of cursor) {
    if (written > 0) res.write(",");
    // relaxed: false — канонический EJSON: типы сохраняются точно, включая
    // числовые (int32 против double), а не «как получится».
    res.write("\n" + EJSON.stringify(doc, { relaxed: false }));
    written++;
  }
  res.write(written > 0 ? "\n]" : "]");

  return written;
}

/**
 * Пишет весь дамп: конверт, коллекции, счётчики и отметку о завершении.
 *
 * Вынесено отдельно и экспортировано намеренно — чтобы проверять полноту
 * выгрузки на НАСТОЯЩЕЙ базе тем же кодом, который работает у администратора,
 * а не его пересказом в скрипте проверки. Приёмник любой, лишь бы у него был
 * write(): ответ Express, файл, счётчик.
 *
 * @param {{write: Function}} sink
 * @param {object} db      база (mongodb Db)
 * @param {string[]} names коллекции в порядке записи
 * @returns {Promise<object>} счётчики по коллекциям
 */
export async function writeDump(sink, db, names) {
  const stats = {};

  sink.write("{\n");
  sink.write(`"format":${JSON.stringify(FORMAT)},\n`);
  sink.write(`"database":${JSON.stringify(db.databaseName)},\n`);
  sink.write(`"exportedAt":${JSON.stringify(new Date().toISOString())},\n`);
  sink.write('"collections":{');

  let first = true;
  for (const name of names) {
    sink.write(first ? "\n" : ",\n");
    first = false;
    sink.write(`${JSON.stringify(name)}:`);
    stats[name] = await streamCollection(sink, db, name);
  }

  sink.write("\n},\n");
  sink.write(`"stats":${JSON.stringify(stats)},\n`);
  // Последняя строка файла. Её отсутствие — единственный надёжный признак
  // того, что закачка оборвалась: без неё файл даже не разберётся как JSON.
  sink.write('"completed":true\n}');

  return stats;
}

/** Коллекции базы, которые попадают в выгрузку. */
export async function exportableCollections(db) {
  return (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system.") && !SKIP_ON_EXPORT.has(n))
    .sort();
}

/**
 * POST /api/admin/transfer/export-database  { database, password }
 *
 * Вся база одним файлом, потоком.
 */
export async function exportDatabase(req, res) {
  const db = await authorize(req, res, {
    action: "admin.database.export",
    resourceType: "database",
    scope: { database: String(req.body?.database ?? mainDb()) },
  });
  if (!db) return;

  const infos = await exportableCollections(db);

  // Пишем в журнал ДО начала выгрузки. Данные покидают контур с этой секунды;
  // если соединение оборвётся на середине, событие всё равно должно остаться
  // записанным — «выгрузка не завершилась» не значит «ничего не ушло».
  auditAdminAccess(req, {
    action: "admin.database.export",
    resourceType: "database",
    metadata: { database: db.databaseName, collectionCount: infos.length },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  startDownload(res, `${db.databaseName}-${stamp}.json`);

  try {
    await writeDump(res, db, infos);
    res.end();
  } catch (err) {
    console.error("❌ exportDatabase error:", err);
    // Заголовки уже ушли, обычной ошибкой не ответить. Обрываем соединение:
    // недописанный файл не пройдёт проверку целостности при загрузке.
    res.destroy(err);
  }
}

/**
 * POST /api/admin/transfer/export-collection  { database, collection, password }
 */
export async function exportCollection(req, res) {
  const name = String(req.body?.collection || "").trim();
  if (!name || name.startsWith("system.")) {
    return res.status(400).json({ message: "Не указана коллекция" });
  }

  const db = await authorize(req, res, {
    action: "admin.collection.export",
    resourceType: "database-collection",
    scope: { database: String(req.body?.database ?? mainDb()), collection: name },
  });
  if (!db) return;

  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    return res.status(404).json({ message: `Коллекция «${name}» не найдена` });
  }

  auditAdminAccess(req, {
    action: "admin.collection.export",
    resourceType: "database-collection",
    metadata: { database: db.databaseName, collection: name },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  startDownload(res, `${db.databaseName}-${name}-${stamp}.json`);

  try {
    // Тот же формат и тот же код, что у полного дампа, — чтобы файл одной
    // коллекции загружался тем же путём и с теми же проверками.
    await writeDump(res, db, [name]);
    res.end();
  } catch (err) {
    console.error("❌ exportCollection error:", err);
    res.destroy(err);
  }
}

/* ───────────────────────── Загрузка ───────────────────────── */

/**
 * Разбирает присланный файл и проверяет, что он полон.
 * @returns {{collections: object, stats: object}|{error: string}}
 */
function parseDump(buffer) {
  let parsed;
  try {
    // EJSON.parse понимает и наш канонический формат, и обычный JSON —
    // поэтому старые дампы тоже загрузятся, просто без восстановления типов.
    parsed = EJSON.parse(buffer.toString("utf-8"), { relaxed: false });
  } catch (err) {
    return {
      error:
        "Файл не разбирается. Обычная причина — оборванная закачка: " +
        `дамп сохранён не целиком (${err.message})`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Ожидается объект с коллекциями" };
  }

  // Наш формат — с проверкой завершённости. Старый (просто карта коллекций)
  // принимаем тоже, но честно предупреждаем, что проверить его нечем.
  if (parsed.format === FORMAT || parsed.collections) {
    if (parsed.completed !== true) {
      return {
        error:
          "Файл неполный: в нём нет отметки о завершении выгрузки. " +
          "Скачайте базу заново — загружать обрезанный дамп нельзя.",
      };
    }
    return { collections: parsed.collections || {}, stats: parsed.stats || {} };
  }

  return { collections: parsed, stats: {}, legacy: true };
}

async function importInto(db, collections, stats) {
  const report = [];

  for (const [name, documents] of Object.entries(collections)) {
    if (PROTECTED_ON_IMPORT.has(name)) {
      report.push({
        collection: name,
        inserted: 0,
        skipped: Array.isArray(documents) ? documents.length : 0,
        status: "refused",
        reason:
          name === "users"
            ? "Записывать пользователей загрузкой нельзя: так заводят скрытого администратора"
            : "Журнал аудита неизменяем — дописывать его загрузкой нельзя",
      });
      continue;
    }

    if (!Array.isArray(documents) || documents.length === 0) {
      report.push({ collection: name, inserted: 0, skipped: 0, status: "empty" });
      continue;
    }

    // Сверка с заявленным числом: если в файле сказано 1000 документов, а
    // лежит 900, значит скачалось не всё — записывать такое молча нельзя.
    // Number(), а не typeof: канонический EJSON отдаёт числа объектами Int32,
    // и проверка «это число» на них не срабатывала — сверка молча не работала.
    const declared = Number(stats?.[name]);
    if (Number.isFinite(declared) && declared !== documents.length) {
      report.push({
        collection: name,
        inserted: 0,
        skipped: documents.length,
        status: "mismatch",
        reason: `в файле ${documents.length} документов вместо заявленных ${declared}`,
      });
      continue;
    }

    try {
      const result = await db
        .collection(name)
        .insertMany(documents, { ordered: false });
      report.push({
        collection: name,
        inserted: result.insertedCount,
        skipped: documents.length - result.insertedCount,
        status: "ok",
      });
    } catch (err) {
      // E11000 — документы с такими _id уже есть. Это не ошибка загрузки:
      // при повторном заливе того же дампа так и должно быть.
      const inserted = err.result?.insertedCount ?? err.result?.nInserted ?? 0;
      report.push({
        collection: name,
        inserted,
        skipped: documents.length - inserted,
        status: "partial",
        reason: "часть документов уже есть в базе (совпадение _id)",
      });
    }
  }

  return report;
}

/**
 * POST /api/admin/transfer/import-database
 * multipart: file + { database, password }
 */
export async function importDatabase(req, res) {
  const db = await authorize(req, res, {
    action: "admin.database.import",
    resourceType: "database",
    scope: { database: String(req.body?.database ?? mainDb()) },
  });
  if (!db) return;

  if (!req.file) return res.status(400).json({ message: "Файл не передан" });

  const parsed = parseDump(req.file.buffer);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  try {
    const report = await importInto(db, parsed.collections, parsed.stats);

    auditAdminAccess(req, {
      action: "admin.database.import",
      resourceType: "database",
      metadata: {
        database: db.databaseName,
        collectionCount: report.length,
        insertedTotal: report.reduce((s, r) => s + r.inserted, 0),
        refused: report.filter((r) => r.status === "refused").length,
        legacyFormat: Boolean(parsed.legacy),
      },
    });

    res.json({
      database: db.databaseName,
      report,
      insertedTotal: report.reduce((s, r) => s + r.inserted, 0),
      warning: parsed.legacy
        ? "Файл в старом формате: типы данных (ссылки, даты) могли не восстановиться."
        : null,
    });
  } catch (err) {
    console.error("❌ importDatabase error:", err);
    res.status(500).json({ message: "Ошибка загрузки данных" });
  }
}

/**
 * POST /api/admin/transfer/import-collection
 * multipart: file + { database, collection, password }
 *
 * Отличается от загрузки базы только тем, что берёт из файла одну названную
 * коллекцию — удобно, когда нужно вернуть на место что-то одно.
 */
export async function importCollection(req, res) {
  const name = String(req.body?.collection || "").trim();

  const db = await authorize(req, res, {
    action: "admin.collection.import",
    resourceType: "database-collection",
    scope: { database: String(req.body?.database ?? mainDb()), collection: name },
  });
  if (!db) return;

  if (!req.file) return res.status(400).json({ message: "Файл не передан" });
  if (!name) return res.status(400).json({ message: "Не указана коллекция" });

  const parsed = parseDump(req.file.buffer);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const documents = parsed.collections[name];
  if (!documents) {
    return res.status(400).json({
      message: `В файле нет коллекции «${name}». Есть: ${Object.keys(parsed.collections).join(", ") || "ничего"}`,
    });
  }

  try {
    const report = await importInto(
      db,
      { [name]: documents },
      parsed.stats,
    );

    auditAdminAccess(req, {
      action: "admin.collection.import",
      resourceType: "database-collection",
      metadata: {
        database: db.databaseName,
        collection: name,
        inserted: report[0]?.inserted ?? 0,
        status: report[0]?.status,
      },
    });

    res.json({ database: db.databaseName, report });
  } catch (err) {
    console.error("❌ importCollection error:", err);
    res.status(500).json({ message: "Ошибка загрузки коллекции" });
  }
}

export default {
  listDatabases,
  listCollections,
  exportDatabase,
  exportCollection,
  importDatabase,
  importCollection,
};
