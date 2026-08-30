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
async function ownedPatient(patientId, userId) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) return null;
  const p = await DoctorPrivatePatient.findById(patientId);
  if (!p) return null;
  const owner = String(p.doctorUserId || "");
  return owner && owner === String(userId) ? p : null;
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
      patientType: "private",
      patientTypeModel: "DoctorPrivatePatient",
      patientRef: patient._id,

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
      patientRef: patient._id,
      patientTypeModel: "DoctorPrivatePatient",
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ ok: true, prescriptions: rows.map(toApi) });
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

    const patient = await DoctorPrivatePatient.findById(rx.patientRef);
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
      patient: await buildPatientForPdf(patient, {
        allergies: patient?.medicalProfile?.allergies || "",
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
