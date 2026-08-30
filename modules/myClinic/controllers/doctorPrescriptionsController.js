// modules/myClinic/controllers/doctorPrescriptionsController.js
//
// Рецепты, которые врач выписывает своему частному пациенту — вне клиники.
//
// Почему отдельно от clinic-medical. Тот сервис требует членства в клинике:
// он берёт clinicId из контекста арендатора и спрашивает права через RBAC
// клиники. У врача, ведущего частный приём, никакой клиники нет, и вызвать
// его нельзя. Модель рецепта такой случай предусматривает изначально —
// patientTypeModel умеет "DoctorPrivatePatient", а createdByClinicId
// обязателен только для сотрудника клиники, — поэтому здесь тонкий
// контроллер поверх той же модели и того же генератора бланка.
//
// Владение проверяется явно: пациент должен принадлежать этому врачу.
// resolvePatient находит карту по идентификатору, но НЕ проверяет, чья она.

import mongoose from "mongoose";
import Prescription from "../../../common/models/Polyclinic/Prescription.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import { encryptPHI } from "../../../common/utils/phiCrypto.js";
import {
  normalizeItems,
  normalizeRefills,
  normalizeValidUntil,
} from "../../clinic/clinic-medical/services/prescription.service.js";
import {
  buildPatientForPdf,
  decryptPrescriptionDoc,
  resolvePrescriber,
} from "../../clinic/clinic-medical/pdf/prescriptionPayload.js";

// Карта пациента этого врача — или null.
//
// У врача два вида пациентов, и рецепт можно выписать обоим: частный
// (DoctorPrivatePatient, привязан к одному врачу) и зарегистрированный в
// поликлинике (NewPatientPolyclinic, привязан к нескольким — doctorId это
// массив). Модель рецепта различает их полем patientTypeModel, поэтому
// возвращаем и карту, и то, какой она модели.
async function ownedPatient(patientId, userId) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) return null;

  const priv = await DoctorPrivatePatient.findById(patientId);
  if (priv) {
    const owner = String(priv.doctorUserId || "");
    return owner && owner === String(userId)
      ? { doc: priv, model: "DoctorPrivatePatient", type: "private" }
      : null;
  }

  const reg = await NewPatientPolyclinic.findById(patientId);
  if (reg) {
    const linked = (reg.doctorId || []).some(
      (id) => String(id) === String(userId),
    );
    return linked
      ? { doc: reg, model: "NewPatientPolyclinic", type: "registered" }
      : null;
  }

  return null;
}

// Наружу отдаём расшифрованный рецепт: клиент показывает его в списке.
function toApi(rx) {
  const d = decryptPrescriptionDoc(rx);
  return { ...d, createdAt: rx.createdAt, updatedAt: rx.updatedAt };
}

// ── Создать ─────────────────────────────────────────────────────────────
export async function createDoctorPrescription(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }

    const patient = await ownedPatient(req.params.patientId, userId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: "Пациент не найден" });
    }

    const body = req.body || {};
    const items = normalizeItems(body.items);
    if (items.length === 0) {
      return res.status(422).json({
        ok: false,
        error: "Нужна хотя бы одна позиция с международным названием (МНН)",
      });
    }

    const diagnosis = body.diagnosis
      ? {
          code: (body.diagnosis.code || "").trim(),
          codeTitle: (body.diagnosis.codeTitle || "").trim(),
          text: encryptPHI((body.diagnosis.text || "").trim()), // PHI
        }
      : { code: "", codeTitle: "", text: "" };

    const rx = new Prescription({
      patientType: patient.type,
      patientTypeModel: patient.model,
      patientRef: patient.doc._id,

      // Врач — пользователь, а не сотрудник клиники: createdByClinicId не
      // ставим, и по его отсутствию бланк печатается под маркой проекта.
      createdBy: userId,
      createdByEmployee: null,
      issuedByUserId: userId,
      issuedAt: new Date(),
      status: "active",

      items,
      generalNotes: encryptPHI((body.generalNotes || "").trim()), // PHI
      diagnosis,
      substitutionAllowed:
        typeof body.substitutionAllowed === "boolean"
          ? body.substitutionAllowed
          : null,
      refills: normalizeRefills(body.refills),
      validUntil: normalizeValidUntil(body.validUntil),
    });

    await rx.save();
    return res.status(201).json({ ok: true, prescription: toApi(rx.toObject()) });
  } catch (err) {
    if (err?.name === "ValidationError" || err?.message?.includes("INN")) {
      return res.status(422).json({ ok: false, error: err.message });
    }
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}

// ── Список по пациенту ──────────────────────────────────────────────────
export async function listDoctorPrescriptions(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }

    const patient = await ownedPatient(req.params.patientId, userId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: "Пациент не найден" });
    }

    const rows = await Prescription.find({
      patientRef: patient.doc._id,
      patientTypeModel: patient.model,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ ok: true, prescriptions: rows.map(toApi) });
  } catch (err) {
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}

// ── Правка ──────────────────────────────────────────────────────────────
//
// Те же правила, что в клинике: рецепт — документ, и переписывать его
// задним числом нельзя. Но опечатка, замеченная через минуту, — это
// опечатка, а не новый рецепт. Поэтому правка разрешена, пока бланк
// активен, и каждое изменение ложится в history со старым значением.
export async function updateDoctorPrescription(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: "Неверный формат ID" });
    }

    const rx = await Prescription.findById(req.params.id);
    if (!rx) {
      return res.status(404).json({ ok: false, error: "Рецепт не найден" });
    }
    // Править может только автор: рецепт — документ с его именем.
    if (String(rx.createdBy || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Доступ запрещён" });
    }
    if (rx.status !== "active") {
      return res.status(409).json({
        ok: false,
        error:
          "Править можно только активный рецепт. Отмените его и выпишите новый.",
      });
    }

    const body = req.body || {};
    const next_ = {};
    if (body.items !== undefined) {
      const items = normalizeItems(body.items);
      if (items.length === 0) {
        return res.status(422).json({
          ok: false,
          error: "Нужна хотя бы одна позиция с международным названием (МНН)",
        });
      }
      next_.items = items;
    }
    if (body.diagnosis !== undefined) {
      next_.diagnosis = body.diagnosis
        ? {
            code: (body.diagnosis.code || "").trim(),
            codeTitle: (body.diagnosis.codeTitle || "").trim(),
            text: encryptPHI((body.diagnosis.text || "").trim()),
          }
        : { code: "", codeTitle: "", text: "" };
    }
    if (body.generalNotes !== undefined) {
      next_.generalNotes = encryptPHI(String(body.generalNotes || "").trim());
    }
    if (body.substitutionAllowed !== undefined) {
      next_.substitutionAllowed =
        typeof body.substitutionAllowed === "boolean"
          ? body.substitutionAllowed
          : null;
    }
    if (body.refills !== undefined) next_.refills = normalizeRefills(body.refills);
    if (body.validUntil !== undefined) {
      next_.validUntil = normalizeValidUntil(body.validUntil);
    }

    const now = new Date();
    let changed = 0;
    for (const field of Object.keys(next_)) {
      const oldRaw = rx.get(field);
      const oldPlain =
        oldRaw && typeof oldRaw.toObject === "function"
          ? oldRaw.toObject()
          : oldRaw;
      // Сравниваем по содержимому: сабдокумент и обычный объект не равны
      // никогда, и в истории оказалась бы правка, которой не было.
      if (JSON.stringify(oldPlain ?? null) === JSON.stringify(next_[field] ?? null))
        continue;
      rx.history.push({
        updatedBy: userId,
        updatedAt: now,
        changes: { field, oldValue: oldPlain, newValue: next_[field] },
      });
      rx.set(field, next_[field]);
      changed += 1;
    }

    if (changed > 0) await rx.save();
    return res.json({ ok: true, prescription: toApi(rx.toObject()) });
  } catch (err) {
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}

// ── Бланк ───────────────────────────────────────────────────────────────
export async function doctorPrescriptionPdf(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: "Неверный формат ID" });
    }

    const rx = await Prescription.findById(req.params.id).lean();
    if (!rx) {
      return res.status(404).json({ ok: false, error: "Рецепт не найден" });
    }
    // Печатать может только тот, кто выписал: рецепт — документ с именем.
    if (String(rx.createdBy || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: "Доступ запрещён" });
    }

    const patient =
      rx.patientTypeModel === "NewPatientPolyclinic"
        ? await NewPatientPolyclinic.findById(rx.patientRef)
        : await DoctorPrivatePatient.findById(rx.patientRef);
    const { buildPrescriptionPdf } = await import(
      "../../clinic/clinic-medical/pdf/prescriptionPdf.js"
    );

    const pdfBuffer = await buildPrescriptionPdf({
      prescription: {
        ...decryptPrescriptionDoc(rx),
        ...(await resolvePrescriber(rx)),
      },
      // Аллергии частного пациента лежат прямо в карте одной строкой, а не
      // отдельными записями, как у клиники.
      // Аллергии лежат прямо в карте одной строкой, а не отдельными
      // записями, как у клиники; поле у двух моделей называется по-разному.
      patient: await buildPatientForPdf(patient, {
        allergies:
          patient?.medicalProfile?.allergies || patient?.allergies || "",
      }),
      // Клиники нет — генератор напечатает шапку проекта с данными врача.
      clinic: null,
      lang: req.query?.lang || "ru",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="prescription-${rx._id}.pdf"`,
    );
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}
