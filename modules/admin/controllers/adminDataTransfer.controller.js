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

import fs from "node:fs";
import mongoose from "mongoose";
import { EJSON } from "bson";
import argon2 from "argon2";

import User from "../../../common/models/Auth/users.js";
import { auditAdminAccess } from "../adminAudit.js";
import { readDump, scanDump, detectFormat, FORMAT } from "./dumpReader.js";

/* ───────────────────────── Базы ───────────────────────── */

// Обе базы живут на одном кластере Atlas, поэтому доступны через то же
// соединение — тем же способом, каким common/sitemap читает новости.
//
// Список закрытый НАМЕРЕННО. Без него параметр db стал бы способом прочитать
// служебные базы кластера (admin, config, local) через штатную кнопку админки.
// Список НЕ зависит от того, с какой базой работает само приложение.
//
// Это существенно для разработки: локально MONGODB_DB=DOCPATS_NEW_LOCAL, и
// если брать имя оттуда, админка на локальной машине предлагала бы выгрузить
// черновую базу вместо боевой — а нужна как раз боевая, ради резервных копий.
// Кластер один и тот же, поэтому обе базы доступны и из локального запуска.
//
// Меняется через ADMIN_TRANSFER_DATABASES (имена через запятую) — на случай,
// когда действительно нужна другая база, например черновая при отладке.
const DEFAULT_TRANSFER_DATABASES = ["DOCPATS_NEW", "DOCPATS_AI_NEWS"];

// База новостей не содержит данных пациентов — от этого зависит предупреждение
// в интерфейсе, поэтому имя вынесено отдельно.
export const newsDb = () => process.env.NEWS_MONGODB_DB || "DOCPATS_AI_NEWS";

// Читаем окружение при КАЖДОМ обращении, а не один раз при загрузке модуля:
// застывший на этапе импорта список расходится с реальностью везде, где
// переменные устанавливаются позже (тесты, запуск скриптом).
export function allowedDatabases() {
  const configured = String(process.env.ADMIN_TRANSFER_DATABASES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const names = configured.length > 0 ? configured : DEFAULT_TRANSFER_DATABASES;

  return names.map((name) => ({
    name,
    title:
      name === newsDb()
        ? "Движок новостей и аналитики"
        : name === "DOCPATS_NEW"
          ? "Основная база платформы"
          : name,
    // Всё, что не движок новостей, считаем содержащим данные пациентов:
    // ошибиться в эту сторону безопаснее.
    phi: name !== newsDb(),
  }));
}

/** База по умолчанию, когда запрос её не назвал. */
export const mainDb = () => allowedDatabases()[0]?.name || "DOCPATS_NEW";

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

/**
 * Снята ли защита записи для этого запуска.
 *
 * Нужна ровно для одного случая: восстановить рабочую копию базы для
 * разработки. Без users в копии не под кем войти, и копия бесполезна — то
 * есть запрет, осмысленный на бою, там мешает.
 *
 * На боевом сервере переменная ИГНОРИРУЕТСЯ, даже если её туда занесут:
 * защита от чёрного хода не должна сниматься строчкой в .env, которую легко
 * добавить второпях.
 */
function protectionLifted() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ADMIN_TRANSFER_ALLOW_PROTECTED === "true";
}

function isProtected(name) {
  if (name === "sessions") return true; // живые ключи доступа — никогда
  return PROTECTED_ON_IMPORT.has(name) && !protectionLifted();
}

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
  res.json({
    databases: allowedDatabases(),
    // С какой базой работает САМО приложение. Локально это черновая база, а
    // выгружаются боевые — и не видеть этой разницы прямо на странице значит
    // рано или поздно перепутать, куда только что залил файл.
    appDatabase: mongoose.connection?.name || null,
  });
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
        importable: !isProtected(info.name),
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

// FORMAT объявлен в dumpReader.js: писатель и читатель обязаны знать одну и ту
// же строку, а две константы с одним значением рано или поздно разъезжаются.

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

// Файл загрузки читается ПОТОКОМ, а не целиком в строку. Причина конкретная:
// дамп базы новостей весит 1081 МБ (17 000 документов по 33 КБ — полные тексты
// статей), а строка такой длины в V8 невозможна, предел около 512 МБ. То есть
// файл скачивался целиком, а вернуть его было нельзя.
//
// Проверка идёт ОТДЕЛЬНЫМ проходом до записи: отметка о завершении лежит в
// конце файла, и без предварительного прохода обрезанный дамп успел бы
// записаться наполовину — ровно то, чего формат и должен не допускать.
// Документы в проверочном проходе не разбираются, только считаются.

/**
 * Проверяет файл целиком, ничего не записывая.
 * @returns {Promise<{ok: true, counts: object, stats: object}|{error: string}>}
 */
async function validateDump(filePath) {
  let scan;
  try {
    scan = await scanDump(filePath);
  } catch (err) {
    return { error: `Файл не читается: ${err.message}` };
  }

  if (!scan.completed) {
    return {
      error:
        "Файл неполный: в нём нет отметки о завершении выгрузки. Обычная " +
        "причина — оборванная закачка. Скачайте базу заново: загружать " +
        "обрезанный дамп нельзя.",
    };
  }

  // Сверка «сколько заявлено» с «сколько лежит». Расхождение означает, что
  // файл побился между выгрузкой и загрузкой.
  const bad = [];
  for (const [name, declared] of Object.entries(scan.stats || {})) {
    const actual = scan.counts[name] ?? 0;
    if (Number(declared) !== actual) {
      bad.push(`${name}: ${actual} вместо ${declared}`);
    }
  }
  if (bad.length > 0) {
    return {
      error: `Файл побит, число документов не сходится — ${bad.join("; ")}`,
    };
  }

  return { ok: true, counts: scan.counts, stats: scan.stats };
}

/* ─────────────────── Режимы загрузки ───────────────────
 *
 * «Добавить» недостаточно для восстановления: документ с тем же _id
 * пропускается, поэтому изменённые записи остаются старыми, и база после
 * загрузки не равна дампу. Отсюда три режима с разной ценой ошибки.
 *
 *   add     — только недостающее. Ничего не теряется, но и не исправляется.
 *   restore — документ из дампа замещает существующий по _id. База становится
 *             такой, как в дампе, но записи, созданные ПОСЛЕ выгрузки и
 *             отсутствующие в файле, остаются на месте.
 *   replace — коллекция очищается и наполняется из дампа. Единственный режим,
 *             дающий точное состояние на момент выгрузки, и единственный, в
 *             котором данные УДАЛЯЮТСЯ: всё, что появилось после выгрузки,
 *             исчезнет.
 */
export const IMPORT_MODES = Object.freeze(["add", "restore", "replace"]);

function normalizeMode(value) {
  const mode = String(value || "add").trim();
  return IMPORT_MODES.includes(mode) ? mode : "add";
}

/** Записывает порцию документов согласно режиму. */
async function writeBatch(db, name, docs, tally, mode) {
  if (mode === "restore") {
    // replaceOne с upsert по _id: существующий документ замещается целиком,
    // отсутствующий создаётся. Именно это и значит «восстановить».
    const ops = docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    const result = await db.collection(name).bulkWrite(ops, { ordered: false });
    tally.inserted += result.upsertedCount ?? 0;
    tally.updated += result.modifiedCount ?? 0;
    return;
  }

  // add и replace пишут одинаково: в replace коллекция уже очищена, поэтому
  // дубликатов там взяться неоткуда.
  try {
    const result = await db.collection(name).insertMany(docs, { ordered: false });
    tally.inserted += result.insertedCount;
  } catch (err) {
    // E11000 — документы с такими _id уже есть. В режиме add это не ошибка:
    // при повторном заливе того же дампа так и должно быть.
    const inserted = err.result?.insertedCount ?? err.result?.nInserted ?? 0;
    tally.inserted += inserted;
    tally.duplicates += docs.length - inserted;
  }
}

/**
 * Загружает дамп в базу.
 *
 * @param {object} db
 * @param {string} filePath
 * @param {string|null} only  загрузить только эту коллекцию
 */
async function importDump(db, filePath, { only = null, mode = "add" } = {}) {
  const tallies = new Map();

  const tallyFor = (name) => {
    if (!tallies.has(name)) {
      tallies.set(name, {
        inserted: 0,
        updated: 0,
        deleted: 0,
        duplicates: 0,
        refused: false,
      });
    }
    return tallies.get(name);
  };

  await readDump(filePath, {
    onCollection: async (name) => {
      const tally = tallyFor(name);
      if (isProtected(name)) {
        tally.refused = true;
        return;
      }
      if (only && name !== only) return;

      // Очистка — ЗДЕСЬ, до первой порции, и только для тех коллекций, что
      // действительно есть в файле. Коллекции, которых в дампе нет, остаются
      // нетронутыми: «восстановить из копии» не значит «стереть остальное».
      if (mode === "replace") {
        const result = await db.collection(name).deleteMany({});
        tally.deleted += result.deletedCount ?? 0;
      }
    },
    onBatch: async (name, docs) => {
      const tally = tallyFor(name);
      if (tally.refused) return;
      if (only && name !== only) return;
      await writeBatch(db, name, docs, tally, mode);
    },
  });

  const report = [];
  for (const [name, tally] of tallies) {
    if (only && name !== only) continue;

    if (tally.refused) {
      report.push({
        collection: name,
        inserted: 0,
        skipped: 0,
        status: "refused",
        reason:
          name === "users"
            ? "Записывать пользователей загрузкой нельзя: так заводят скрытого администратора"
            : "Журнал аудита неизменяем — дописывать его загрузкой нельзя",
      });
      continue;
    }

    const touched = tally.inserted + tally.updated;
    report.push({
      collection: name,
      inserted: tally.inserted,
      updated: tally.updated,
      deleted: tally.deleted,
      skipped: tally.duplicates,
      status:
        tally.duplicates > 0 ? "partial" : touched > 0 || tally.deleted > 0 ? "ok" : "empty",
      reason:
        tally.duplicates > 0
          ? "часть документов уже есть в базе — они оставлены как были"
          : undefined,
    });
  }

  return report;
}

const sumBy = (rows, field) => rows.reduce((sum, r) => sum + (r[field] || 0), 0);

/** Файл во временной папке нужен только на время загрузки. */
async function discard(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Файла уже нет — не повод падать.
  }
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
  if (!db) {
    await discard(req.file?.path);
    return;
  }

  if (!req.file) return res.status(400).json({ message: "Файл не передан" });

  try {
    const format = await detectFormat(req.file.path);
    if (format !== FORMAT) {
      return res.status(400).json({
        message:
          "Файл не в формате выгрузки DocPats. Загружать можно только то, " +
          "что скачано этой же админкой.",
      });
    }

    const check = await validateDump(req.file.path);
    if (check.error) return res.status(400).json({ message: check.error });

    const mode = normalizeMode(req.body?.mode);
    const report = await importDump(db, req.file.path, { mode });

    // Режим — часть события: «добавили недостающее» и «стёрли и залили
    // заново» при разборе инцидента отвечают на разные вопросы.
    auditAdminAccess(req, {
      action: "admin.database.import",
      resourceType: "database",
      metadata: {
        database: db.databaseName,
        mode,
        collectionCount: report.length,
        insertedTotal: sumBy(report, "inserted"),
        updatedTotal: sumBy(report, "updated"),
        deletedTotal: sumBy(report, "deleted"),
        refused: report.filter((r) => r.status === "refused").length,
      },
    });

    res.json({
      database: db.databaseName,
      mode,
      report,
      insertedTotal: sumBy(report, "inserted"),
      updatedTotal: sumBy(report, "updated"),
      deletedTotal: sumBy(report, "deleted"),
    });
  } catch (err) {
    console.error("❌ importDatabase error:", err);
    res.status(500).json({ message: "Ошибка загрузки данных" });
  } finally {
    await discard(req.file?.path);
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
  if (!db) {
    await discard(req.file?.path);
    return;
  }

  if (!req.file) return res.status(400).json({ message: "Файл не передан" });
  if (!name) {
    await discard(req.file.path);
    return res.status(400).json({ message: "Не указана коллекция" });
  }

  try {
    const format = await detectFormat(req.file.path);
    if (format !== FORMAT) {
      return res
        .status(400)
        .json({ message: "Файл не в формате выгрузки DocPats." });
    }

    const check = await validateDump(req.file.path);
    if (check.error) return res.status(400).json({ message: check.error });

    if (!(name in check.counts)) {
      const available = Object.keys(check.counts).join(", ") || "ничего";
      return res.status(400).json({
        message: `В файле нет коллекции «${name}». Есть: ${available}`,
      });
    }

    const mode = normalizeMode(req.body?.mode);
    const report = await importDump(db, req.file.path, { only: name, mode });

    auditAdminAccess(req, {
      action: "admin.collection.import",
      resourceType: "database-collection",
      metadata: {
        database: db.databaseName,
        collection: name,
        mode,
        inserted: report[0]?.inserted ?? 0,
        updated: report[0]?.updated ?? 0,
        deleted: report[0]?.deleted ?? 0,
        status: report[0]?.status,
      },
    });

    res.json({ database: db.databaseName, mode, report });
  } catch (err) {
    console.error("❌ importCollection error:", err);
    res.status(500).json({ message: "Ошибка загрузки коллекции" });
  } finally {
    await discard(req.file?.path);
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
