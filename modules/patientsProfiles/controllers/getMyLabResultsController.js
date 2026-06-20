// server/modules/patientsProfiles/controllers/getMyLabResultsController.js
//
// Единый список анализов пациента (Вариант X): новые LabResult (clinic-medical)
// + старые LabTest (polyclinic) в ОДНОМ списке с полем source.
//
// Мост (выверен по getMyMedicalFilesDetailsController):
//   • clinic:  userId → ClinicPatient.linkedUserId → patientRef
//   • legacy:  userId → NewPatientPolyclinic ($or linkedUserId/registeredPatient/_id)
//              → LabTest.patient (+ patientId fallback)
//
// Приватные пациенты фрилансера (DoctorPrivatePatient) НЕ попадают: они не
// привязаны к NewPatientPolyclinic этого юзера.
//
// Флаги: LabResult — сохранённые; legacy LabTest — вычисляем на лету общим
// computeFlag (тот же стандарт-слой). Read-only. PHI plaintext.

import mongoose from "mongoose";
import LabResult from "../../clinic/clinic-medical/models/labResult.model.js";
import LabTest from "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import {
  computeFlag,
  loincFor,
  canonUnit,
} from "../../../common/standards/labStandards.js";

const getUserId = (req) =>
  req.user?.userId || req.session?.userId || req.userId || null;

// ── normalize one legacy LabTest parameter to unified shape ──
function normalizeLegacyParam(p) {
  if (!p || typeof p !== "object") return null;
  const name = p.name || p.parameter || p.title || "";
  if (!name) return null;

  const rawVal = p.value ?? p.result ?? "";
  const numVal = Number(rawVal);
  const isNum = rawVal !== "" && Number.isFinite(numVal);

  let refMin = null;
  let refMax = null;
  let refText = null;
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
    loincCode: loincFor(name) || null,
    valueType: isNum ? "number" : "text",
    value: isNum ? numVal : String(rawVal),
    unit: isNum ? canonUnit(p.unit || "") || "ед." : "—",
    referenceRange: { min: refMin, max: refMax, text: refText },
  };
  param.flag = computeFlag(param);
  return param;
}

const getMyLabResultsController = async (req, res) => {
  try {
    const rawUserId = getUserId(req);
    if (!rawUserId) {
      return res.status(401).json({ ok: false, error: "Не авторизован" });
    }
    const userId = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    // ── 1. CLINIC (new LabResult) via linkedUserId bridge ──
    const cards = await ClinicPatient.find({ linkedUserId: userId })
      .setOptions({ skipTenantScope: true })
      .select("_id")
      .lean();

    let clinicItems = [];
    if (cards.length) {
      const cardIds = cards.map((c) => c._id);
      const docs = await LabResult.find({
        patientRef: { $in: cardIds },
        patientTypeModel: "ClinicPatient",
      })
        .sort({ effectiveDateTime: -1 })
        .limit(300)
        .lean();

      if (docs.length) {
        const clinicIds = [
          ...new Set(
            docs
              .map((d) =>
                d.createdByClinicId ? String(d.createdByClinicId) : null,
              )
              .filter(Boolean),
          ),
        ];
        const clinics = clinicIds.length
          ? await Clinic.find({ _id: { $in: clinicIds } })
              .select("_id name")
              .lean()
          : [];
        const clinicNameById = new Map(
          clinics.map((c) => [String(c._id), c.name]),
        );

        clinicItems = docs.map((d) => ({
          source: "clinic",
          _id: String(d._id),
          status: d.status || "final",
          date: d.effectiveDateTime || d.createdAt || null,
          createdAt: d.createdAt || null,
          panelType: d.panelType || "Other",
          title: d.panelTitle || d.panelType || "",
          labName: d.labName || "",
          clinicId: d.createdByClinicId ? String(d.createdByClinicId) : null,
          clinicName: d.createdByClinicId
            ? clinicNameById.get(String(d.createdByClinicId)) || ""
            : "",
          diagnosis: d.diagnosis
            ? { code: d.diagnosis.code || "", text: d.diagnosis.text || "" }
            : null,
          report: d.report || "",
          parameters: Array.isArray(d.parameters)
            ? d.parameters.map((p) => ({
                name: p.name || "",
                value: p.value,
                unit: p.unit || "—",
                valueType: p.valueType,
                referenceRange: p.referenceRange || null,
                flag: p.flag || "normal",
              }))
            : [],
          hasPdf: true,
          attachedFile: d.attachedFile?.url
            ? {
                url: d.attachedFile.url,
                fileName: d.attachedFile.fileName || null,
              }
            : null,
          files: [],
        }));
      }
    }

    // ── 2. LEGACY (old LabTest) via NewPatientPolyclinic bridge ──
    // Same lookup as getMyMedicalFilesDetailsController.
    let legacyItems = [];
    const profile = await NewPatientPolyclinic.findOne({
      $or: [
        { linkedUserId: userId },
        { registeredPatient: userId },
        { _id: userId },
      ],
    })
      .select("_id")
      .lean();

    if (profile) {
      const profileId = profile._id;
      const orConditions = [];
      if (LabTest.schema.path("patient")) {
        const pf = { patient: profileId };
        if (LabTest.schema.path("patientModel")) {
          pf.patientModel = "NewPatientPolyclinic";
        }
        orConditions.push(pf);
      }
      if (LabTest.schema.path("patientId")) {
        orConditions.push({ patientId: profileId });
      }

      if (orConditions.length) {
        const docs = await LabTest.find({ $or: orConditions })
          .populate("doctor")
          .sort({ date: -1, createdAt: -1 })
          .limit(300)
          .lean();

        legacyItems = docs.map((d) => {
          const params = Array.isArray(d.testParameters)
            ? d.testParameters.map(normalizeLegacyParam).filter(Boolean)
            : [];
          return {
            source: "legacy",
            _id: String(d._id),
            status: d.validatedByDoctor ? "final" : "preliminary",
            date: d.date || d.createdAt || null,
            createdAt: d.createdAt || null,
            panelType: "Other",
            title: d.testType || d.labName || d.nameofexam || "",
            labName: d.labName || "",
            clinicId: null,
            clinicName: "",
            diagnosis: d.diagnosis ? { code: "", text: d.diagnosis } : null,
            report: d.report || "",
            parameters: params,
            hasPdf: true, // legacy now gets PDF too (same generator)
            attachedFile: null,
            files: Array.isArray(d.files) ? d.files : [],
          };
        });
      }
    }

    // ── 3. merge + sort by date desc ──
    const items = [...clinicItems, ...legacyItems].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });

    return res.status(200).json({ ok: true, items });
  } catch (error) {
    console.error("❌ getMyLabResults error:", error);
    return res.status(500).json({ ok: false, error: "Ошибка сервера" });
  }
};

export default getMyLabResultsController;
