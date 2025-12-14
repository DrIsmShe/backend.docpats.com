// controllers/clinic/add-examinations/addLabtestscanController.js
import mongoose from "mongoose";
import LabTest from "../../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";
import File from "../../../../common/models/file.js";
import User from "../../../../common/models/Auth/users.js";

/* ---------- допускаемые специализации ---------- */
const allowedLabTestSpecializations = [
  "Laboratory Diagnostics Specialist",
  "Laboratory Doctor",
  "Clinical Pathologist",
  "Biochemist",
  "Molecular Diagnostics Specialist",
  "Pathologist",
  "Cytologist",
  "Geneticist",
  "Medical Geneticist",
  "Internal Medicine Doctor",
  "Therapist",
  "Family Doctor",
  "Pediatrician",
  "Pediatric Endocrinologist",
  "Endocrinologist",
  "Infectious Disease Specialist",
  "Oncologist",
  "Immunologist",
  "Allergist-Immunologist",
  "Nephrologist",
  "Gynecologist",
  "Obstetrician",
  "Clinical Pharmacologist",
  "Hematologist",
  "Radiologist",
];

/* ---------- helpers ---------- */
function resolveFileType(mimetype) {
  if (!mimetype) return "other";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype === "application/pdf") return "pdf";
  if (
    mimetype === "application/msword" ||
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "document";
  return "other";
}

const parseJSONSafe = (v, fallback) => {
  if (v == null) return fallback;
  if (Array.isArray(v) || typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

const ensureString = (v) => {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

const toNumOrNull = (v) => {
  if (v === "" || v === null || typeof v === "undefined") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Подсказки для текстовых показателей (если valueType не задан с фронта) */
const TEXT_PARAM_HINTS = [
  /цвет/i,
  /color/i,
  /прозрач/i, // прозрачность
  /консист/i, // консистенция
  /реакц/i, // реакция
  /слизь/i,
  /осадок/i,
  /опис/i, // описание
  /коммент/i, // комментарий
  /налич/i, // наличие
  /detected/i,
  /обнаруж/i,
  /форма/i,
  /тип/i,
  /качест/i,
];

function isLikelyText(name, p) {
  // если фронт явно прислал valueType
  const vt = String(p?.valueType || "").toLowerCase();
  if (vt === "text") return true;
  if (vt === "number") return false;

  const n = String(name || "").trim();
  if (!n) return false;

  // эвристика по названию
  if (TEXT_PARAM_HINTS.some((rx) => rx.test(n))) return true;

  // эвристика по значению
  if (typeof p?.value === "string") {
    const trimmed = p.value.trim();
    if (trimmed && Number.isNaN(Number(trimmed))) return true;
  }

  // подсказка по unit (обнаружено/не обнаружено и т.п.)
  const unit = String(p?.unit || "").toLowerCase();
  if (unit.includes("обнаруж") || unit.includes("detected")) return true;

  return false;
}

/** Дефолты для unit, чтобы не падать на required в модели */
function guessUnit(name, unit, valueType) {
  const u = String(unit ?? "").trim();
  if (u) return u;

  const n = String(name ?? "").toLowerCase();

  if (valueType === "number") {
    if (n.includes("ph")) return "pH"; // pH как безразмерная шкала
    if (n.includes("удельный вес") || n.includes("specific gravity"))
      return "ед.";
    return "ед."; // общий дефолт для чисел
  }

  // текстовые показатели
  return "—";
}

/** Нормализация массива testParameters с разделением «число/текст» */
function normalizeTestParameters(input) {
  const raw = parseJSONSafe(input, []);
  if (!Array.isArray(raw)) return [];

  return raw.map((p) => {
    const name = String(p?.name ?? "").trim();

    // если фронт прислал явный valueType — используем его
    let valueType = (p?.valueType || "").toLowerCase();
    if (valueType !== "number" && valueType !== "text") {
      valueType = isLikelyText(name, p) ? "text" : "number";
    }

    if (valueType === "text") {
      const value = String(p?.value ?? "").trim();
      const unit = guessUnit(name, p?.unit, "text");
      return {
        name,
        unit,
        valueType: "text",
        value, // строка
        referenceRange: null, // не нужно для текста
      };
    }

    // valueType === "number"
    const value = toNumOrNull(p?.value);
    const min = toNumOrNull(p?.referenceRange?.min);
    const max = toNumOrNull(p?.referenceRange?.max);
    const unit = guessUnit(name, p?.unit, "number");

    return {
      name,
      unit,
      valueType: "number",
      value, // число или null (модель проверит)
      referenceRange: { min, max },
    };
  });
}

/* ---------- контроллер ---------- */
const addLabtestscanController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.session?.userId;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ message: "Неверный формат ID пациента" });
    }
    if (!doctorId) {
      return res.status(401).json({ message: "Вы не авторизованы" });
    }

    const doctor = await User.findById(doctorId).populate("specialization");
    if (!doctor || !doctor.specialization) {
      return res
        .status(403)
        .json({ message: "Специализация врача не определена" });
    }

    const specializationName = doctor.specialization.name;
    if (!allowedLabTestSpecializations.includes(specializationName)) {
      return res.status(403).json({
        message: `⛔ Специальность «${specializationName}» не имеет доступа к добавлению лабораторных анализов`,
      });
    }

    const {
      testType,
      labName,
      report,
      diagnosis,
      testParameters,
      relatedStudies,
      rawData,

      aiFindings,
      aiConfidence,
      aiVersion,
      aiPrediction,
      predictionConfidence,
      aiProcessingTime,

      validatedByDoctor,
      doctorNotes,
      riskLevel,
      riskFactors,
    } = req.body;

    if (!testType) {
      return res
        .status(400)
        .json({ message: "Не указан тип анализа (testType)" });
    }

    const normalizedParams = normalizeTestParameters(testParameters);
    if (!normalizedParams.length) {
      return res.status(400).json({
        message:
          "Показатели анализа (testParameters) не переданы или имеют неверный формат",
      });
    }

    // файлы: поддержка и кастомного req.uploadedFiles, и multer req.files
    const incomingFiles = Array.isArray(req.uploadedFiles)
      ? req.uploadedFiles
      : Array.isArray(req.files)
      ? req.files
      : [];

    let uploadedFiles = [];
    if (incomingFiles.length > 0) {
      const filesToInsert = incomingFiles.map((file) => {
        const fileFormat =
          file.fileFormat || file.mimetype || "application/octet-stream";
        const fileSize = file.fileSize ?? file.size ?? 0;
        const fileName = file.fileName || file.originalname || "unnamed_file";
        const fileUrl = file.fileUrl || file.path || "unknown_url";

        return {
          fileName,
          fileType: resolveFileType(fileFormat),
          fileUrl,
          fileSize,
          fileFormat,
          studyTypeReference: "LabTest",
          uploadedByDoctor: doctorId,
          patientId: new mongoose.Types.ObjectId(patientId),
        };
      });

      uploadedFiles = await File.insertMany(filesToInsert);
    }

    // relatedStudies — ожидаем массив ObjectId; rawData — строка
    const relatedStudiesParsed = parseJSONSafe(relatedStudies, undefined);
    const rawDataStr = ensureString(parseJSONSafe(rawData, rawData));

    // риск-уровень
    const normalizedRiskLevel = ["low", "medium", "high"].includes(
      String(riskLevel).toLowerCase()
    )
      ? String(riskLevel).toLowerCase()
      : undefined;

    const labTestDoc = new LabTest({
      patient: patientId,
      doctor: doctorId,
      testType,
      labName: labName ?? "",
      report: report ?? "",
      diagnosis: diagnosis ?? "",
      testParameters: normalizedParams,
      relatedStudies: relatedStudiesParsed,
      rawData: rawDataStr,
      files: uploadedFiles,

      aiAnalysis: {
        findings: aiFindings ?? null,
        confidence: aiConfidence ?? null,
        version: aiVersion ?? null,
        prediction: aiPrediction ?? null,
        predictionConfidence: predictionConfidence ?? null,
        processingTime: aiProcessingTime ?? null,
        processedAt: new Date(),
      },

      validatedByDoctor:
        typeof validatedByDoctor === "string"
          ? validatedByDoctor === "true"
          : Boolean(validatedByDoctor),

      doctorNotes: doctorNotes ?? "",
      riskLevel: normalizedRiskLevel,
      riskFactors: Array.isArray(riskFactors)
        ? riskFactors
        : riskFactors
        ? [riskFactors]
        : [],
      doctorComments: doctorNotes
        ? [{ doctor: doctorId, text: doctorNotes }]
        : [],
    });

    await labTestDoc.save();
    const saved = await LabTest.findById(labTestDoc._id).populate("files");

    return res.status(201).json({
      message: "✅ Лабораторный анализ успешно добавлен",
      data: saved,
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении лабораторного анализа:", error);
    return res.status(500).json({
      message: "Ошибка сервера при сохранении анализа",
      error: error.message,
    });
  }
};

export default addLabtestscanController;
