// server/modules/patientsProfiles/controllers/getMyLabResultPdfController.js
//
// Patient-side PDF for ONE lab result — clinic LabResult OR legacy LabTest.
// Ownership: clinic via ClinicPatient.linkedUserId; legacy via
// NewPatientPolyclinic ($or linkedUserId/registeredPatient/_id).
// Both rendered by the SAME buildLabResultPdf (identical bланк).

import mongoose from "mongoose";
import crypto from "crypto";
import LabResult from "../../clinic/clinic-medical/models/labResult.model.js";
import LabTest from "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import User from "../../../common/models/Auth/users.js";
import {
  computeFlag,
  loincFor,
  canonUnit,
} from "../../../common/standards/labStandards.js";

const getUserId = (req) =>
  req.user?.userId || req.session?.userId || req.userId || null;

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const SECRET_KEY = (process.env.ENCRYPTION_KEY || "default_secret_key")
  .padEnd(32, "0")
  .slice(0, 32);
const decrypt = (value) => {
  if (!value || typeof value !== "string" || !value.includes(":")) {
    return value || "";
  }
  try {
    const [ivHex, encryptedHex] = value.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
};

// legacy param → unified shape (same as list controller)
function normalizeLegacyParam(p) {
  if (!p || typeof p !== "object") return null;
  const name = p.name || p.parameter || p.title || "";
  if (!name) return null;
  const rawVal = p.value ?? p.result ?? "";
  const numVal = Number(rawVal);
  const isNum = rawVal !== "" && Number.isFinite(numVal);
  let refMin = null,
    refMax = null,
    refText = null;
  const rr = p.referenceRange ?? p.norm ?? p.range ?? null;
  if (rr && typeof rr === "object") {
    refMin = rr.min ?? null;
    refMax = rr.max ?? null;
    refText = rr.text ?? null;
  } else if (typeof rr === "string" && rr.includes("-")) {
    const [a, b] = rr.split("-").map((s) => parseFloat(s.trim()));
    if (Number.isFinite(a)) refMin = a;
    if (Number.isFinite(b)) refMax = b;
  } else if (typeof rr === "string" && rr.trim()) {
    refText = rr.trim();
  }
  const param = {
    name: String(name).trim(),
    valueType: isNum ? "number" : "text",
    value: isNum ? numVal : String(rawVal),
    unit: isNum ? canonUnit(p.unit || "") || "ед." : "—",
    referenceRange: { min: refMin, max: refMax, text: refText },
  };
  param.flag = computeFlag(param);
  return param;
}

const getMyLabResultPdfController = async (req, res) => {
  try {
    const rawUserId = getUserId(req);
    if (!rawUserId)
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    const userId = toObjectId(rawUserId) || rawUserId;

    const labId = toObjectId(req.params.id);
    if (!labId) return res.status(400).json({ ok: false, error: "INVALID_ID" });

    const lang = req.query?.lang || "ru";
    const { buildLabResultPdf } =
      await import("../../clinic/clinic-medical/pdf/labResultPdf.js");

    // Patient name = the logged-in user (the owner viewing their own PDF).
    // Most reliable source — works for both clinic and legacy regardless of
    // whether the polyclinic profile / clinic card has the name filled.
    let selfName = { firstName: "", lastName: "", dateOfBirth: null };
    try {
      const me = await User.findById(userId)
        .select("firstNameEncrypted lastNameEncrypted dateOfBirth")
        .lean();
      if (me) {
        selfName = {
          firstName: decrypt(me.firstNameEncrypted) || "",
          lastName: decrypt(me.lastNameEncrypted) || "",
          dateOfBirth: me.dateOfBirth || null,
        };
      }
    } catch {
      /* ignore — fall back to profile/card name below */
    }

    // ── try CLINIC first ──
    const clinicDoc = await LabResult.findById(labId)
      .populate({
        path: "createdBy",
        select: "firstNameEncrypted lastNameEncrypted",
        options: { strictPopulate: false },
      })
      .lean();
    if (clinicDoc) {
      const card = await ClinicPatient.findOne({ _id: clinicDoc.patientRef })
        .setOptions({ skipTenantScope: true })
        .select(
          "linkedUserId firstNameEncrypted lastNameEncrypted firstName lastName dateOfBirth",
        )
        .lean();
      if (!card || String(card.linkedUserId || "") !== String(userId)) {
        return res.status(403).json({ ok: false, error: "FORBIDDEN" });
      }
      const clinic = clinicDoc.createdByClinicId
        ? await Clinic.findById(clinicDoc.createdByClinicId).lean()
        : null;

      // doctor name: createdBy (User, encrypted). Employee author → no name here.
      const cb = clinicDoc.createdBy;
      const doctorName = cb
        ? [decrypt(cb.firstNameEncrypted), decrypt(cb.lastNameEncrypted)]
            .filter(Boolean)
            .join(" ")
        : "";

      const labResult = {
        _id: String(clinicDoc._id),
        status: clinicDoc.status,
        panelType: clinicDoc.panelType,
        panelTitle: clinicDoc.panelTitle,
        effectiveDateTime: clinicDoc.effectiveDateTime,
        createdAt: clinicDoc.createdAt,
        labName: clinicDoc.labName || "",
        report: clinicDoc.report || "",
        diagnosis: clinicDoc.diagnosis || null,
        doctorName,
        parameters: Array.isArray(clinicDoc.parameters)
          ? clinicDoc.parameters
          : [],
      };
      const patient = {
        firstName:
          selfName.firstName ||
          card.firstName ||
          decrypt(card.firstNameEncrypted),
        lastName:
          selfName.lastName || card.lastName || decrypt(card.lastNameEncrypted),
        dateOfBirth: selfName.dateOfBirth || card.dateOfBirth || null,
      };
      const pdf = await buildLabResultPdf({ labResult, clinic, patient, lang });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="lab-result-${labResult._id}.pdf"`,
      );
      return res.status(200).send(pdf);
    }

    // ── fallback: LEGACY LabTest ──
    const legacy = await LabTest.findById(labId).populate("doctor").lean();
    if (!legacy) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // ownership: the LabTest.patient must belong to THIS user's polyclinic profile
    const profile = await NewPatientPolyclinic.findOne({
      $or: [
        { linkedUserId: userId },
        { registeredPatient: userId },
        { _id: userId },
      ],
    }).lean();

    const ownerProfileId = profile?._id ? String(profile._id) : null;
    const labPatientId = legacy.patient
      ? String(legacy.patient)
      : legacy.patientId
        ? String(legacy.patientId)
        : null;
    if (!ownerProfileId || !labPatientId || ownerProfileId !== labPatientId) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    }

    const labResult = {
      _id: String(legacy._id),
      status: legacy.validatedByDoctor ? "final" : "preliminary",
      panelType: "Other",
      panelTitle: legacy.testType || legacy.labName || legacy.nameofexam || "",
      effectiveDateTime: legacy.date || legacy.createdAt,
      createdAt: legacy.createdAt,
      labName: legacy.labName || "",
      report: legacy.report || "",
      diagnosis: legacy.diagnosis ? { code: "", text: legacy.diagnosis } : null,
      doctorName: legacy.doctor
        ? [
            decrypt(legacy.doctor.firstNameEncrypted),
            decrypt(legacy.doctor.lastNameEncrypted),
          ]
            .filter(Boolean)
            .join(" ")
        : "",
      parameters: Array.isArray(legacy.testParameters)
        ? legacy.testParameters.map(normalizeLegacyParam).filter(Boolean)
        : [],
    };
    const patient = {
      firstName: selfName.firstName || profile.firstName || profile.name || "",
      lastName: selfName.lastName || profile.lastName || profile.surname || "",
      dateOfBirth:
        selfName.dateOfBirth || profile.dateOfBirth || profile.dob || null,
    };
    // freelancer has no clinic letterhead → pass null (PDF prints title only)
    const pdf = await buildLabResultPdf({
      labResult,
      clinic: null,
      patient,
      lang,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="lab-result-${labResult._id}.pdf"`,
    );
    return res.status(200).send(pdf);
  } catch (err) {
    console.error("❌ getMyLabResultPdf error:", err);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
};

export default getMyLabResultPdfController;
