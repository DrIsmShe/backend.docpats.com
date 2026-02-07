import mongoose from "mongoose";
import NewPatientPolyclinicMedical from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

/**
 * Контроллер для создания нового пациента (история болезни поликлиники)
 * — безопасная обработка сессии, файла, мягкая валидация и предсказуемые ответы
 */
const addPatientsPolyclinicMedicalHistoryController = async (req, res) => {
  // ─────────────── 1) Авторизация ───────────────
  if (!req.session?.userId) {
    console.warn("[MedicalHistory] Неаутентифицированный доступ");
    return res.status(403).json({
      success: false,
      message: "Пожалуйста, войдите в систему.",
      uiMeta: { variant: "warning", ttlMs: 6000 },
    });
  }

  // ─────────────── 2) Параметры ───────────────
  const { id: patientId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    console.warn(`[MedicalHistory] Неверный patientId: ${patientId}`);
    return res.status(400).json({
      success: false,
      message: "Некорректный идентификатор пациента.",
      uiMeta: { variant: "error" },
    });
  }

  // ─────────────── 3) Извлечение тела запроса ───────────────
  const {
    metaDescription,
    metaKeywords,
    readTime,
    complaints,
    anamnesisMorbi,
    anamnesisVitae,
    statusPreasens,
    statusLocalis,
    diagnosis,
    additionalDiagnosis,
    recommendations,
    ctScanResults,
    mriResults,
    ultrasoundResults,
    laboratoryTestResults,
    isConsentGiven,
  } = req.body ?? {};

  // ─────────────── 4) Нормализация и мягкая валидация ───────────────
  const trimOrNull = (v) => (typeof v === "string" ? v.trim() : v ?? null);

  const toArrayOrNull = (v) =>
    v == null
      ? null
      : Array.isArray(v)
      ? v
      : typeof v === "string" && v.trim()
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

  const toBoolean = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.toLowerCase().trim();
      if (["true", "1", "yes", "on"].includes(s)) return true;
      if (["false", "0", "no", "off"].includes(s)) return false;
    }
    return Boolean(v);
  };

  // readTime приводим к числу, но не ломаем поток при NaN
  const readTimeNum =
    typeof readTime === "number"
      ? readTime
      : readTime && !Number.isNaN(Number(readTime))
      ? Number(readTime)
      : undefined;

  // ─────────────── 5) Обработка файла(ов) ───────────────
  // Поддержка как single (req.file), так и multiple (req.files)
  const uploadsBase = process.env.FILE_PUBLIC_PATH_BASE ?? ""; // например, "" или "/uploads"
  let photoUrl = null;

  const makePublicUrl = (filename) =>
    `${uploadsBase}/${filename}`.replace(/\/{2,}/g, "/");

  if (req.file?.filename) {
    photoUrl = makePublicUrl(req.file.filename);
  } else if (Array.isArray(req.files) && req.files[0]?.filename) {
    photoUrl = makePublicUrl(req.files[0].filename);
  } else if (req.files && typeof req.files === "object") {
    // Если multer в режиме полей: { photo: [ { filename } ] }
    const guess =
      req.files.photo?.[0]?.filename ||
      Object.values(req.files)?.[0]?.[0]?.filename;
    if (guess) photoUrl = makePublicUrl(guess);
  }

  // ─────────────── 6) Сбор документа ───────────────
  const docPayload = {
    photo: photoUrl ?? null,
    doctorId: req.session.userId,
    createdBy: req.session.userId,
    patientId,

    metaDescription: trimOrNull(metaDescription),
    metaKeywords: toArrayOrNull(metaKeywords) ?? trimOrNull(metaKeywords), // поддержка строки или массива
    readTime: readTimeNum,

    complaints: trimOrNull(complaints),
    anamnesisMorbi: trimOrNull(anamnesisMorbi),
    anamnesisVitae: trimOrNull(anamnesisVitae),
    statusPreasens: trimOrNull(statusPreasens),
    statusLocalis: trimOrNull(statusLocalis),

    diagnosis: trimOrNull(diagnosis),
    additionalDiagnosis: trimOrNull(additionalDiagnosis),
    recommendations: trimOrNull(recommendations),

    ctScanResults: trimOrNull(ctScanResults),
    mriResults: trimOrNull(mriResults),
    ultrasoundResults: trimOrNull(ultrasoundResults),
    laboratoryTestResults: trimOrNull(laboratoryTestResults),

    isConsentGiven:
      typeof isConsentGiven === "undefined"
        ? undefined
        : toBoolean(isConsentGiven),

    // UI-подсказки для фронта (не ломают схему, просто доп. данные)
    _uiHints: {
      icon: "🩺",
      accent: "emerald",
      toast: {
        title: "История добавлена",
        description: "Данные пациента сохранены.",
      },
    },
  };

  // ─────────────── 7) Сохранение ───────────────
  try {
    console.log("[MedicalHistory] Сохранение истории болезни…", {
      by: req.session.userId,
      for: patientId,
    });

    const newMedicalHistory = new NewPatientPolyclinicMedical(docPayload);
    await newMedicalHistory.save();

    console.log(
      "[MedicalHistory] Успех:",
      newMedicalHistory?._id?.toString?.() ?? "(no id)"
    );

    // ─────────────── 8) Единый красивый ответ ───────────────
    return res.status(201).json({
      success: true,
      message: "История болезни успешно добавлена!",
      uiMeta: {
        variant: "success",
        ttlMs: 5000,
        toast: {
          title: "Готово",
          description: "История болезни сохранена.",
        },
      },
      medicalHistory: newMedicalHistory,
    });
  } catch (error) {
    console.error("[MedicalHistory] Ошибка сохранения:", error);
    return res.status(500).json({
      success: false,
      message: "Произошла ошибка при добавлении истории болезни.",
      error: process.env.NODE_ENV === "production" ? undefined : error.message,
      uiMeta: {
        variant: "error",
        toast: {
          title: "Ошибка",
          description: "Не удалось сохранить историю. Повторите попытку.",
        },
      },
    });
  }
};

export default addPatientsPolyclinicMedicalHistoryController;
