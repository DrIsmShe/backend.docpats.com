import mongoose from "mongoose";
import EEGScan from "../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
// ^ проверь точный путь к модели EEGScan

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

export default async function getEEGScanFilesDetailController(req, res) {
  try {
    const idParam = String(req.params?.id || "").trim();
    const anyId = toObjectId(idParam);
    if (!anyId)
      return res.status(400).json({ ok: false, error: "INVALID_EEG_ID" });

    // Если нужно — добавь populate тех полей, которые реально есть в схеме
    let q = EEGScan.findById(anyId)
      .populate({
        path: "doctor",
        select:
          "role username email firstName lastName firstNameEncrypted lastNameEncrypted",
      })
      .populate({
        path: "patientId",
        select:
          "linkedUserId firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
        populate: {
          path: "linkedUserId",
          select:
            "role username email firstNameEncrypted lastNameEncrypted dateOfBirth birthDate dob birthday",
        },
      })
      .populate({ path: "nameofexamTemplate", select: "title" })
      .populate({ path: "reportTemplate", select: "title" })
      .populate({ path: "diagnosisTemplate", select: "title" })
      .populate({ path: "recomandationTemplate", select: "title" })
      .populate({
        path: "doctorComments.doctor",
        select: "role firstNameEncrypted lastNameEncrypted",
      })
      .setOptions({ strictPopulate: false });

    let doc = await q.exec();

    // резерв — поиск по files.studyReference
    if (!doc) {
      doc = await EEGScan.findOne({ "files.studyReference": anyId }).exec();
    }

    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // Сформируй ответ как в SPECT-контроллере
    const item = {
      _id: String(doc._id),
      date: doc.date,
      doctor: doc.doctor
        ? {
            _id: String(doc.doctor._id || doc.doctor),
            role: doc.doctor.role,
            username: doc.doctor.username,
            email: doc.doctor.email ?? null,
            firstName: doc.doctor.firstName ?? null,
            lastName: doc.doctor.lastName ?? null,
          }
        : null,
      patientId: doc.patientId
        ? {
            _id: String(doc.patientId._id),
            linkedUserId: doc.patientId.linkedUserId
              ? String(
                  doc.patientId.linkedUserId._id || doc.patientId.linkedUserId
                )
              : null,
            firstName: doc.patientId.firstName ?? null,
            lastName: doc.patientId.lastName ?? null,
            dateOfBirth:
              doc.patientId.dateOfBirth ??
              doc.patientId.birthDate ??
              doc.patientId.dob ??
              doc.patientId.birthday ??
              null,
          }
        : null,

      images: Array.isArray(doc.images) ? doc.images : [],
      rawData: doc.rawData || null,
      pacsLink: doc.pacsLink || null,
      files: Array.isArray(doc.files)
        ? doc.files.map((f) => ({
            fileName: f.fileName,
            fileType: f.fileType,
            fileUrl: f.fileUrl,
            fileSize: f.fileSize,
            fileFormat: f.fileFormat,
            studyReference: f.studyReference ? String(f.studyReference) : null,
            studyTypeReference: f.studyTypeReference || null,
          }))
        : [],

      nameofexam: doc.nameofexam || "",
      report: doc.report || "",
      recomandation: doc.recomandation || "",
      diagnosis: doc.diagnosis || "",

      electrodePlacement: doc.electrodePlacement ?? null,
      signalDuration: doc.signalDuration ?? null,
      eventMarkers: Array.isArray(doc.eventMarkers) ? doc.eventMarkers : [],
      brainRegions: Array.isArray(doc.brainRegions) ? doc.brainRegions : [],

      previousEEG: doc.previousEEG ? String(doc.previousEEG) : null,

      aiFindings: doc.aiFindings ?? null,
      aiConfidence: doc.aiConfidence ?? null,
      aiVersion: doc.aiVersion ?? null,

      validatedByDoctor: !!doc.validatedByDoctor,
      doctorNotes: doc.doctorNotes || "",
      doctorComments: Array.isArray(doc.doctorComments)
        ? doc.doctorComments.map((c) => ({
            doctor: c.doctor
              ? {
                  _id: String(c.doctor._id || c.doctor),
                  role: c.doctor.role,
                }
              : null,
            text: c.text || "",
            date: c.date || null,
          }))
        : [],

      createdAt: doc.createdAt ?? null,
      updatedAt: doc.updatedAt ?? null,
    };

    return res.status(200).json({ ok: true, item });
  } catch (err) {
    console.error("[getEEGScanFilesDetailController] error:", err);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
}
