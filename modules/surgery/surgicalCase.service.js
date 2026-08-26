import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import SurgicalCase from "./surgicalCase.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Шифрование ───────────────────────────────────────────────────────────
const ENCRYPTION_KEY = process.env.SURGERY_ENCRYPTION_KEY;
const ALGORITHM = "aes-256-gcm";

function encrypt(text) {
  if (!text) return null;
  if (!ENCRYPTION_KEY) return text;
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  if (!ENCRYPTION_KEY) return ciphertext;
  try {
    const [ivHex, tagHex, encHex] = ciphertext.split(":");
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// ─── Пациент ──────────────────────────────────────────────────────────────
//
// Обе модели лежат в common/models/Polyclinic — сюда раньше был прописан путь
// на несуществующий PatientProfile/, из-за чего populate молча падал и кейс
// приватного пациента открывался без имени.
//
// registeredPatientId ссылается на NewPatientPolyclinic (это же значение стоит
// в `ref` схемы), а не на PatientProfile: `patientId` и зашифрованные имена
// есть только у первой.
async function loadPatientModels() {
  const [{ default: Registered }, { default: Private }] = await Promise.all([
    import("../../common/models/Polyclinic/newPatientPolyclinic.js"),
    import("../../common/models/Polyclinic/DoctorPrivatePatient.js"),
  ]);
  return { Registered, Private };
}

const REGISTERED_FIELDS =
  "firstNameEncrypted lastNameEncrypted emailEncrypted patientId photo";
const PRIVATE_FIELDS =
  "firstNameEncrypted lastNameEncrypted emailEncrypted externalId image";
// Читаем пациентов документами, а НЕ через .lean({ virtuals: true }).
// Имя пациента живёт только в виртуальном поле поверх firstNameEncrypted, а
// lean в этой версии mongoose виртуалы не применяет: запрос возвращал шифртекст
// и undefined вместо имени. Выборка ограничена пятью полями и полусотней
// записей на страницу, поэтому гидратация здесь дешевле потерянного имени.

function shapeRegistered(p) {
  return {
    _id: p._id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    patientId: p.patientId,
    photo: p.photo,
    type: "registered",
  };
}

function shapePrivate(p) {
  return {
    _id: p._id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    externalId: p.externalId,
    photo: p.image,
    type: "private",
  };
}

async function populatePatient(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
  const { Registered, Private } = await loadPatientModels();

  if (obj.patientType === "registered" && obj.registeredPatientId) {
    const p = await Registered.findById(obj.registeredPatientId).select(
      REGISTERED_FIELDS,
    );
    if (p) obj.patient = shapeRegistered(p);
  }

  if (obj.patientType === "private" && obj.privatePatientId) {
    const p = await Private.findById(obj.privatePatientId).select(
      PRIVATE_FIELDS,
    );
    if (p) obj.patient = shapePrivate(p);
  }

  return obj;
}

// Список грузит пациентов одним запросом на коллекцию, а не по одному на кейс:
// на странице из 50 кейсов поштучный populate — это 50 обращений к базе ради
// колонки, которая должна отрисоваться первой.
async function attachPatients(items) {
  const regIds = items
    .filter((c) => c.patientType === "registered" && c.registeredPatientId)
    .map((c) => String(c.registeredPatientId));
  const privIds = items
    .filter((c) => c.patientType === "private" && c.privatePatientId)
    .map((c) => String(c.privatePatientId));

  if (!regIds.length && !privIds.length) return items;

  const { Registered, Private } = await loadPatientModels();
  const [regs, privs] = await Promise.all([
    regIds.length
      ? Registered.find({ _id: { $in: [...new Set(regIds)] } }).select(
          REGISTERED_FIELDS,
        )
      : [],
    privIds.length
      ? Private.find({ _id: { $in: [...new Set(privIds)] } }).select(
          PRIVATE_FIELDS,
        )
      : [],
  ]);

  const regMap = new Map(regs.map((p) => [String(p._id), shapeRegistered(p)]));
  const privMap = new Map(privs.map((p) => [String(p._id), shapePrivate(p)]));

  return items.map((c) => {
    if (c.patientType === "registered")
      c.patient = regMap.get(String(c.registeredPatientId)) || null;
    if (c.patientType === "private")
      c.patient = privMap.get(String(c.privatePatientId)) || null;
    return c;
  });
}

// ─── Поиск по пациенту ────────────────────────────────────────────────────
//
// Имена пациентов зашифрованы, поэтому подстрочный поиск по ним невозможен в
// принципе. Ищем через blind index: хешируем введённое слово тем же
// sha256(trim + lowercase), что и модели пациентов, и сравниваем с
// firstNameHash / lastNameHash. Это даёт точное совпадение по слову — врач
// вводит фамилию целиком, а не три первые буквы. Плюс regex по открытым
// идентификаторам (patientId, externalId, анонимный код).
const sha256Lower = (v) =>
  crypto
    .createHash("sha256")
    .update(
      String(v || "")
        .trim()
        .toLowerCase(),
    )
    .digest("hex");

function escapeRegex(v) {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildSearchFilter(q) {
  const tokens = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!tokens.length) return null;

  const hashes = tokens.map(sha256Lower);
  const rx = new RegExp(escapeRegex(tokens.join(" ")), "i");
  const { Registered, Private } = await loadPatientModels();

  const [regs, privs] = await Promise.all([
    Registered.find({
      $or: [
        { firstNameHash: { $in: hashes } },
        { lastNameHash: { $in: hashes } },
        { patientId: rx },
      ],
    })
      .select("_id")
      .limit(200)
      .lean(),
    Private.find({
      $or: [
        { firstNameHash: { $in: hashes } },
        { lastNameHash: { $in: hashes } },
        { externalId: rx },
      ],
    })
      .select("_id")
      .limit(200)
      .lean(),
  ]);

  const or = [{ patientIdHash: rx }];
  if (regs.length)
    or.push({ registeredPatientId: { $in: regs.map((x) => x._id) } });
  if (privs.length)
    or.push({ privatePatientId: { $in: privs.map((x) => x._id) } });
  return { $or: or };
}

// ─── Рабочие корзины ──────────────────────────────────────────────────────
//
// Врач приходит в журнал не «посмотреть все кейсы», а с одним из шести
// вопросов. Каждый из них — это и фильтр списка, и счётчик наверху страницы.
// Держим их в одном месте, чтобы цифра в счётчике и содержимое списка не
// разошлись.
export const WORK_BUCKETS = [
  "today",
  "week",
  "needs_protocol",
  "followup_due",
  "stale_planned",
  "no_date",
];

// upcoming — не долг, а режим просмотра: с чего начинается «Расписание».
// Счётчиком он не выводится (иначе рядом стояли бы «сегодня 2» и «впереди 2»,
// где вторая цифра включает первую), но фильтровать по нему список можно.
export const LIST_BUCKETS = [...WORK_BUCKETS, "upcoming"];

function dayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return { start, end, weekEnd };
}

export function bucketFilter(bucket, now = new Date()) {
  const { start, end, weekEnd } = dayBounds(now);
  switch (bucket) {
    // Оперирую сегодня.
    case "today":
      return {
        operationDate: { $gte: start, $lt: end },
        status: { $in: ["planned", "completed"] },
      };
    // Ближайшие 7 дней, начиная с завтра — «сегодня» уже отдельной корзиной.
    case "week":
      return { operationDate: { $gte: end, $lt: weekEnd }, status: "planned" };
    // Операция состоялась, а протокола нет. Главный долг хирурга.
    case "needs_protocol":
      return {
        status: { $in: ["completed", "follow_up", "closed"] },
        $or: [{ planEncrypted: null }, { planEncrypted: { $exists: false } }],
      };
    // Контроль назначен, и его дата уже наступила.
    case "followup_due":
      return {
        nextFollowUpAt: { $ne: null, $lte: now },
        status: { $ne: "closed" },
      };
    // Дата операции прошла, а статус так и остался «запланирована»: либо
    // операцию не отметили выполненной, либо она сорвалась и об этом забыли.
    case "stale_planned":
      return { status: "planned", operationDate: { $ne: null, $lt: start } };
    // Кейс заведён, дата не назначена — он не попадёт ни в один рабочий список.
    case "no_date":
      return { status: "planned", operationDate: null };
    // Всё, что впереди, начиная с сегодняшнего дня — лента расписания.
    case "upcoming":
      return {
        operationDate: { $gte: start },
        status: { $in: ["planned", "completed"] },
      };
    default:
      return {};
  }
}

// ─── Создать кейс ─────────────────────────────────────────────────────────
export async function createCase(surgeonId, data) {
  const {
    patientType = "anonymous",
    registeredPatientId,
    privatePatientId,
    patientIdHash,
    procedure,
    operationDate,
    plan,
    metrics,
    consentGiven,
    consentDate,
  } = data;

  const newCase = await SurgicalCase.create({
    surgeonId,
    patientType,
    registeredPatientId:
      patientType === "registered" ? registeredPatientId : null,
    privatePatientId: patientType === "private" ? privatePatientId : null,
    patientIdHash: patientIdHash || "",
    procedure,
    operationDate: operationDate ? new Date(operationDate) : null,
    planEncrypted: plan ? encrypt(JSON.stringify(plan)) : null,
    metrics: metrics || {},
    consentGiven: Boolean(consentGiven),
    consentDate: consentGiven ? consentDate || new Date() : null,
    status: "planned",
  });

  return _decryptCase(newCase);
}

// ─── Получить один кейс ───────────────────────────────────────────────────
export async function getCaseById(caseId, surgeonId) {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return null;
  const decrypted = _decryptCase(doc);
  return populatePatient(decrypted);
}

// ─── Слияние фильтров ─────────────────────────────────────────────────────
// Корзина и поиск оба могут принести собственный $or. Положить их в один
// объект — значит потерять первый: второй ключ $or перезаписывает первый, и
// фильтр молча становится шире, чем задумано. Поэтому всегда $and.
function mergeFilters(...parts) {
  const list = parts.filter((x) => x && Object.keys(x).length);
  if (!list.length) return {};
  return list.length === 1 ? list[0] : { $and: list };
}

const SORTS = {
  date_desc: { operationDate: -1, createdAt: -1 },
  date_asc: { operationDate: 1, createdAt: 1 },
  created_desc: { createdAt: -1 },
};

// ─── Что требуется от врача по этому кейсу ────────────────────────────────
//
// Журнал должен не хранить кейсы, а показывать долги: незаполненный протокол,
// просроченный контроль, операцию с прошедшей датой и статусом «запланирована».
// Считаем это на сервере, чтобы одно и то же правило работало и в списке, и в
// счётчиках, и позже в напоминаниях.
export function deriveCaseFlags(c, now = new Date()) {
  const { start } = dayBounds(now);
  const photos = c.photos || [];
  const hasPhoto = (label) => photos.some((ph) => ph.label === label);

  const checklist = [
    {
      key: "patient",
      done:
        c.patientType === "anonymous"
          ? Boolean(c.patientIdHash)
          : Boolean(c.registeredPatientId || c.privatePatientId),
    },
    { key: "date", done: Boolean(c.operationDate) },
    { key: "consent", done: Boolean(c.consentGiven) },
    { key: "plan", done: Boolean(c.hasPlan) },
    { key: "photoBefore", done: hasPhoto("before") },
  ];
  const missing = checklist.filter((i) => !i.done).map((i) => i.key);

  const opDate = c.operationDate ? new Date(c.operationDate) : null;
  const fuDate = c.nextFollowUpAt ? new Date(c.nextFollowUpAt) : null;
  const isDone = ["completed", "follow_up", "closed"].includes(c.status);

  // Порядок важен: возвращаем первое, что нужно сделать, а не список всего.
  let nextAction = "";
  if (c.status === "planned" && !opDate) nextAction = "setDate";
  else if (c.status === "planned" && opDate < start) nextAction = "confirmDone";
  else if (c.status === "planned" && missing.length) nextAction = "prepare";
  else if (isDone && !c.hasPlan) nextAction = "writeProtocol";
  else if (fuDate && fuDate <= now && c.status !== "closed")
    nextAction = "followUpDue";
  else if ((c.status === "completed" || c.status === "follow_up") && !fuDate)
    nextAction = "scheduleFollowUp";
  else if (c.status === "follow_up" && !c.outcomeScore)
    nextAction = "rateOutcome";

  const dayMs = 86400000;
  return {
    nextAction,
    missing,
    ready: checklist.length - missing.length,
    readyOf: checklist.length,
    // Отрицательное — операция в прошлом, 0 — сегодня, положительное — впереди.
    daysUntil: opDate
      ? Math.round((new Date(opDate).setHours(0, 0, 0, 0) - start) / dayMs)
      : null,
    followUpOverdueDays:
      fuDate && fuDate < start
        ? Math.floor((start - new Date(fuDate).setHours(0, 0, 0, 0)) / dayMs)
        : 0,
  };
}

// Представление кейса для списка: план не расшифровываем (в списке он не
// нужен, а расшифровка 50 планов на каждый рендер — пустая трата), но факт
// его наличия сохраняем — на нём держится счётчик «нет протокола».
function _listView(doc, now) {
  const obj = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
  obj.hasPlan = Boolean(obj.planEncrypted);
  delete obj.planEncrypted;

  const followUps = obj.followUps || [];
  obj.followUpCount = followUps.length;
  obj.hasComplication = followUps.some((f) => f.complications);
  delete obj.followUps;

  obj.flags = deriveCaseFlags(obj, now);
  return obj;
}

// ─── Список кейсов ────────────────────────────────────────────────────────
export async function listCases(
  surgeonId,
  {
    status,
    procedure,
    patientType,
    bucket,
    q,
    sort = "date_desc",
    page = 1,
    limit = 12,
  } = {},
) {
  const now = new Date();
  const parts = [{ surgeonId, deletedAt: null }];
  if (status) parts.push({ status });
  if (procedure) parts.push({ procedure });
  if (patientType) parts.push({ patientType });
  if (bucket && LIST_BUCKETS.includes(bucket))
    parts.push(bucketFilter(bucket, now));

  // Защита от ?limit=10000
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 12));
  const skip = (pageNum - 1) * limitNum;

  if (q && String(q).trim()) {
    const search = await buildSearchFilter(q);
    // Поиск ничего не сопоставил — это пустой результат, а не «показать всё».
    if (!search) return { items: [], total: 0, page: pageNum, pages: 1 };
    parts.push(search);
  }

  const filter = mergeFilters(...parts);

  const [docs, total] = await Promise.all([
    SurgicalCase.find(filter)
      .sort(SORTS[sort] || SORTS.date_desc)
      .skip(skip)
      .limit(limitNum)
      .select("-simulations"),
    SurgicalCase.countDocuments(filter),
  ]);

  const items = await attachPatients(docs.map((d) => _listView(d, now)));

  return {
    items,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
  };
}

// ─── Рабочий список: счётчики долгов ──────────────────────────────────────
//
// То, ради чего врач открывает раздел утром. Каждая цифра кликабельна и
// раскрывается в тот же список — фильтр и счётчик считаются одной функцией
// bucketFilter, поэтому разойтись не могут.
export async function getWorklist(surgeonId) {
  const now = new Date();
  const base = { surgeonId, deletedAt: null };

  const [counts, total] = await Promise.all([
    Promise.all(
      WORK_BUCKETS.map((b) =>
        SurgicalCase.countDocuments(mergeFilters(base, bucketFilter(b, now))),
      ),
    ),
    SurgicalCase.countDocuments(base),
  ]);

  const buckets = {};
  WORK_BUCKETS.forEach((b, i) => {
    buckets[b] = counts[i];
  });
  return { total, buckets, generatedAt: now };
}

// ─── Найти кейсы конкретного пациента ────────────────────────────────────
export async function getCasesByPatient(surgeonId, patientType, patientId) {
  const filter = { surgeonId, deletedAt: null, patientType };
  if (patientType === "registered") filter.registeredPatientId = patientId;
  if (patientType === "private") filter.privatePatientId = patientId;

  const now = new Date();
  const docs = await SurgicalCase.find(filter)
    .sort({ operationDate: -1 })
    .select("-simulations");

  return attachPatients(docs.map((d) => _listView(d, now)));
}

// ─── Обновить кейс ────────────────────────────────────────────────────────
export async function updateCase(caseId, surgeonId, updates) {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return null;

  const allowed = [
    "status",
    "operationDate",
    "metrics",
    "outcomeScore",
    "consentGiven",
    "consentDate",
    "nextFollowUpAt",
  ];
  allowed.forEach((field) => {
    if (updates[field] !== undefined) doc[field] = updates[field];
  });

  if (updates.plan !== undefined) {
    doc.planEncrypted = encrypt(JSON.stringify(updates.plan));
  }

  if (updates.operationDate) {
    doc.operationDate = new Date(updates.operationDate);
  }

  // Пустая строка приходит из формы, когда врач снимает дату контроля, —
  // это осмысленное "контроль не назначен", а не Invalid Date.
  if (updates.nextFollowUpAt !== undefined) {
    doc.nextFollowUpAt = updates.nextFollowUpAt
      ? new Date(updates.nextFollowUpAt)
      : null;
  }

  await doc.save();
  return _decryptCase(doc);
}

// ─── Мягкое удаление ──────────────────────────────────────────────────────
export async function deleteCase(caseId, surgeonId) {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return false;
  doc.deletedAt = new Date();
  await doc.save();
  return true;
}

// ─── Добавить фото ────────────────────────────────────────────────────────
export async function addPhoto(caseId, surgeonId, fileInfo, label = "before") {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return null;

  doc.photos.push({
    filename: fileInfo.filename,
    originalName: fileInfo.originalname,
    label,
    mimetype: fileInfo.mimetype,
    size: fileInfo.size,
    takenAt: new Date(),
    isPublic: false,
  });

  await doc.save();
  return doc.photos[doc.photos.length - 1];
}

// ─── Удалить фото ─────────────────────────────────────────────────────────
export async function removePhoto(caseId, surgeonId, photoId) {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return false;

  const photo = doc.photos.find((p) => String(p._id) === String(photoId));
  doc.photos = doc.photos.filter((p) => String(p._id) !== String(photoId));

  if (photo) {
    const filePath = path.join(
      __dirname,
      "../../uploads/surgery",
      photo.filename,
    );
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await doc.save();
  return true;
}

// ─── Follow-up ────────────────────────────────────────────────────────────
export async function addFollowUp(
  caseId,
  surgeonId,
  { date, notes, complications, addedBy = "surgeon", nextFollowUpAt } = {},
) {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return null;

  doc.followUps.push({
    date: new Date(date),
    notesEncrypted: encrypt(notes),
    complications: complications || "",
    addedBy,
  });

  if (doc.status === "completed") doc.status = "follow_up";

  // Осмотр состоялся — значит запланированный контроль больше не висит долгом.
  // Либо врач тут же назначает следующий, либо поле обнуляется, иначе кейс
  // навсегда останется в корзине "контроль просрочен".
  doc.nextFollowUpAt =
    nextFollowUpAt !== undefined && nextFollowUpAt !== null
      ? nextFollowUpAt
        ? new Date(nextFollowUpAt)
        : null
      : null;

  await doc.save();
  return _decryptFollowUp(doc.followUps[doc.followUps.length - 1]);
}

// ─── Оценка ───────────────────────────────────────────────────────────────
export async function setOutcomeScore(caseId, surgeonId, score) {
  if (score < 1 || score > 10)
    throw new Error("Score must be between 1 and 10");
  const doc = await SurgicalCase.findOneAndUpdate(
    { _id: caseId, surgeonId, deletedAt: null },
    { outcomeScore: score },
    { new: true },
  );
  return doc ? _decryptCase(doc) : null;
}

// ─── Публикация ───────────────────────────────────────────────────────────
export async function togglePublic(caseId, surgeonId, publish) {
  const doc = await SurgicalCase.findOne({
    _id: caseId,
    surgeonId,
    deletedAt: null,
  });
  if (!doc) return null;

  if (publish && !doc.consentGiven)
    throw new Error("Patient consent is required before publishing");
  const hasAfter = doc.photos.some((p) => p.label === "after");
  if (publish && !hasAfter)
    throw new Error('At least one "after" photo is required before publishing');

  doc.isPublic = Boolean(publish);
  doc.publishedAt = publish ? new Date() : null;
  doc.photos.forEach((p) => {
    p.isPublic = publish ? p.label === "after" : false;
  });

  await doc.save();
  return _decryptCase(doc);
}

// ─── Публичный маркетплейс ────────────────────────────────────────────────
export async function getPublicCases({ procedure, page = 1, limit = 12 } = {}) {
  const filter = {
    isPublic: true,
    deletedAt: null,
    outcomeScore: { $exists: true },
  };
  if (procedure) filter.procedure = procedure;

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    SurgicalCase.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("surgeonId", "firstName lastName specialization city avatar"),
    SurgicalCase.countDocuments(filter),
  ]);

  return {
    items: items.map((doc) => ({
      ...doc.toPublicView(),
      surgeon: doc.surgeonId,
    })),
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
  };
}

// ─── Статистика хирурга ───────────────────────────────────────────────────
export async function getSurgeonStats(surgeonId) {
  // surgeonId приходит из сессии строкой. find() приводит её к ObjectId сам по
  // схеме, а aggregate — нет: он отдаёт запрос в Mongo как есть, строка не
  // совпадает с ObjectId, и разбивка по операциям возвращалась пустой при
  // непустом total (он считается через countDocuments, где каст работает).
  const surgeonObjectId =
    typeof surgeonId === "string"
      ? new mongoose.Types.ObjectId(surgeonId)
      : surgeonId;

  const stats = await SurgicalCase.aggregate([
    { $match: { surgeonId: surgeonObjectId, deletedAt: null } },
    {
      $group: {
        _id: "$procedure",
        count: { $sum: 1 },
        avgScore: { $avg: "$outcomeScore" },
        byType: { $push: "$patientType" },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const total = await SurgicalCase.countDocuments({
    surgeonId,
    deletedAt: null,
  });
  return { total, byProcedure: stats };
}

// ─── Внутренние хелперы ───────────────────────────────────────────────────
function _decryptCase(doc) {
  const obj = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };

  if (obj.planEncrypted) {
    try {
      obj.plan = JSON.parse(decrypt(obj.planEncrypted));
    } catch {
      obj.plan = null;
    }
    delete obj.planEncrypted;
  }

  if (obj.followUps) obj.followUps = obj.followUps.map(_decryptFollowUp);

  return obj;
}

function _decryptFollowUp(fu) {
  const obj = fu.toObject ? fu.toObject() : { ...fu };
  if (obj.notesEncrypted) {
    obj.notes = decrypt(obj.notesEncrypted);
    delete obj.notesEncrypted;
  }
  return obj;
}
