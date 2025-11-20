// server/modules/patientProfile/controllers/getMyHolterFilesDetailsController.js
import mongoose from "mongoose";
import HOLTERScan from "../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
// ^^^ проверьте и поправьте путь к модели при необходимости

/* ================= helpers ================= */
const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

/**
 * GET /.../holter/files/:id
 * Возвращает детальную информацию об исследовании HOLTER с файлами.
 *
 * Порядок поиска:
 *  1) по _id (req.params.id)
 *  2) резерв: по files.studyReference == :id
 */
export default async function getMyHolterFilesDetailsController(req, res) {
  try {
    const idParam = String(req.params?.id || "").trim();
    const anyId = toObjectId(idParam);
    if (!anyId) {
      return res.status(400).json({ ok: false, error: "INVALID_HOLTER_ID" });
    }

    // Базовый запрос + populate ключевых связей (без падений на лишних полях)
    let q = HOLTERScan.findById(anyId)
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

    // РЕЗЕРВ: если не нашли по _id — ищем запись, где files.studyReference == :id
    if (!doc) {
      doc = await HOLTERScan.findOne({ "files.studyReference": anyId })
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
        .setOptions({ strictPopulate: false })
        .exec();
    }

    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    // Нормализованный ответ
    const item = {
      _id: String(doc._id),
      date: doc.date ?? null,

      doctor: doc.doctor
        ? {
            _id: String(doc.doctor._id || doc.doctor),
            role: doc.doctor.role ?? null,
            username: doc.doctor.username ?? null,
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

      // Файловая часть
      images: Array.isArray(doc.images) ? doc.images : [],
      rawData: doc.rawData || null,
      pacsLink: doc.pacsLink || null,
      files: Array.isArray(doc.files)
        ? doc.files.map((f) => ({
            fileName: f.fileName ?? null,
            fileType: f.fileType ?? null,
            fileUrl: f.fileUrl ?? null,
            fileSize: f.fileSize ?? null,
            fileFormat: f.fileFormat ?? null,
            studyReference: f.studyReference ? String(f.studyReference) : null,
            studyTypeReference: f.studyTypeReference ?? null,
          }))
        : [],

      // Текстовые поля заключения
      nameofexam: doc.nameofexam || "",
      report: doc.report || "",
      recomandation: doc.recomandation || "",
      diagnosis: doc.diagnosis || "",

      // Параметры холтера
      radiationDose: doc.radiationDose ?? null, // если в модели используется
      contrastUsed: !!doc.contrastUsed,
      monitoringDuration: doc.monitoringDuration ?? null,
      maxHeartRate: doc.maxHeartRate ?? null,
      minHeartRate: doc.minHeartRate ?? null,
      arrhythmiaEpisodes: Array.isArray(doc.arrhythmiaEpisodes)
        ? doc.arrhythmiaEpisodes
        : [],

      // УЗ-поля (если использовались в вашей модели)
      dopplerFindings: doc.dopplerFindings ?? null,
      echogenicity: doc.echogenicity ?? null,
      probeFrequency: doc.probeFrequency ?? null,

      previousStudy: doc.previousStudy ? String(doc.previousStudy) : null,
      relatedStudies: Array.isArray(doc.relatedStudies)
        ? doc.relatedStudies.map((s) => String(s))
        : [],

      // Данные ИИ
      aiFindings: doc.aiFindings ?? null,
      aiConfidence: doc.aiConfidence ?? null,
      aiVersion: doc.aiVersion ?? null,
      aiPrediction: doc.aiPrediction ?? null,
      predictionConfidence: doc.predictionConfidence ?? null,
      aiProcessingTime: doc.aiProcessingTime ?? null,
      aiProcessedAt: doc.aiProcessedAt ?? null,

      // Качество/риск/прочее
      validatedByDoctor: !!doc.validatedByDoctor,
      doctorNotes: doc.doctorNotes || "",
      threeDModel: doc.threeDModel ?? null,
      imageQuality: doc.imageQuality ?? null,
      needsRetake: !!doc.needsRetake,
      riskLevel: doc.riskLevel ?? null,
      riskFactors: Array.isArray(doc.riskFactors) ? doc.riskFactors : [],

      // Комментарии врача
      doctorComments: Array.isArray(doc.doctorComments)
        ? doc.doctorComments.map((c) => ({
            doctor: c.doctor
              ? {
                  _id: String(c.doctor._id || c.doctor),
                  role: c.doctor.role ?? null,
                }
              : null,
            text: c.text || "",
            date: c.date || null,
          }))
        : [],

      // Служебные метки
      createdAt: doc.createdAt ?? null,
      updatedAt: doc.updatedAt ?? null,
    };

    return res.status(200).json({ ok: true, item });
  } catch (err) {
    console.error("[getMyHolterFilesDetailsController] error:", err);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
}
