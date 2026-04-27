import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
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

// ─── Populate пациента в зависимости от типа ─────────────────────────────
async function populatePatient(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };

  if (obj.patientType === "registered" && obj.registeredPatientId) {
    const Patient = (
      await import("../../common/models/PatientProfile/patientProfile.js")
    ).default;
    const patient = await Patient.findById(obj.registeredPatientId)
      .select(
        "firstNameEncrypted lastNameEncrypted emailEncrypted patientId photo",
      )
      .lean({ virtuals: true });
    if (patient) {
      obj.patient = {
        _id: patient._id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        email: patient.email,
        patientId: patient.patientId,
        photo: patient.photo,
        type: "registered",
      };
    }
  }

  if (obj.patientType === "private" && obj.privatePatientId) {
    const DPP = (
      await import("../../common/models/PatientProfile/DoctorPrivatePatient.js")
    ).default;
    const patient = await DPP.findById(obj.privatePatientId)
      .select(
        "firstNameEncrypted lastNameEncrypted emailEncrypted externalId image",
      )
      .lean({ virtuals: true });
    if (patient) {
      obj.patient = {
        _id: patient._id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        email: patient.email,
        externalId: patient.externalId,
        photo: patient.image,
        type: "private",
      };
    }
  }

  return obj;
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

// ─── Список кейсов ────────────────────────────────────────────────────────
export async function listCases(
  surgeonId,
  { status, procedure, patientType, page = 1, limit = 12 } = {},
) {
  const filter = { surgeonId, deletedAt: null };
  if (status) filter.status = status;
  if (procedure) filter.procedure = procedure;
  if (patientType) filter.patientType = patientType;

  // Защита от ?limit=10000
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 12));
  const skip = (pageNum - 1) * limitNum;

  const [items, total] = await Promise.all([
    SurgicalCase.find(filter)
      .sort({ operationDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .select("-planEncrypted -simulations"),
    SurgicalCase.countDocuments(filter),
  ]);

  return {
    items: items.map(_decryptCase),
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
  };
}

// ─── Найти кейсы конкретного пациента ────────────────────────────────────
export async function getCasesByPatient(surgeonId, patientType, patientId) {
  const filter = { surgeonId, deletedAt: null, patientType };
  if (patientType === "registered") filter.registeredPatientId = patientId;
  if (patientType === "private") filter.privatePatientId = patientId;

  const docs = await SurgicalCase.find(filter)
    .sort({ operationDate: -1 })
    .select("-planEncrypted -simulations");

  return docs.map(_decryptCase);
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
  { date, notes, complications, addedBy = "surgeon" },
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
  const stats = await SurgicalCase.aggregate([
    { $match: { surgeonId, deletedAt: null } },
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
