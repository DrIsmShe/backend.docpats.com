// controllers/getMyLablFilesDetailsController.js
import mongoose from "mongoose";
import LabTest from "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";

const hasModel = (name) => {
  try {
    mongoose.model(name);
    return true;
  } catch {
    return false;
  }
};

const getPatientCardIdByUser = async (userId) => {
  if (!userId || !hasModel("NewPatientPolyclinic")) return null;
  const PatientCard = mongoose.model("NewPatientPolyclinic");
  const pc = await PatientCard.findOne({ user: userId }).select("_id").lean();
  return pc?._id ? String(pc._id) : null;
};

const extractPatientUserId = (patient) => {
  if (!patient) return null;
  const raw =
    typeof patient.user === "object"
      ? patient.user?._id || patient.user?.id
      : patient.user;
  return raw ? String(raw) : null;
};

const sameId = (a, b) => a && b && String(a) === String(b);

const applySafePopulates = (query) => {
  query
    .populate({
      path: "patient",
      select: "firstName lastName middleName sex dateOfBirth user",
    })
    .populate({
      path: "doctor",
      select: "firstName lastName role specialization",
      populate: { path: "specialization", select: "name" },
    })
    .populate({
      path: "doctorComments.doctor",
      select: "firstName lastName role",
    })
    .populate({ path: "files" });

  if (hasModel("Technician")) {
    query.populate({ path: "labTechnician", select: "firstName lastName" });
  }
  if (hasModel("ImagingStudy")) {
    query.populate({
      path: "relatedStudies",
      select: "title type studyType modality createdAt",
    });
  }
  return query;
};

const findLabTestByIdOrFileId = async (id) => {
  // пробуем как _id анализа
  let q1 = applySafePopulates(LabTest.findById(id));
  let labTest = await q1.lean();
  if (labTest) return labTest;

  // пробуем как fileId
  let q2 = applySafePopulates(LabTest.findOne({ files: id }));
  labTest = await q2.lean();
  return labTest || null;
};

const patientOwnsLabTest = async (labTest, session) => {
  if (!session) return false;
  const sessUserId = session.userId ? String(session.userId) : null;
  if (!sessUserId) return false;

  // 1) прямое совпадение userId в карточке пациента
  const patientUserId = extractPatientUserId(labTest?.patient);
  if (patientUserId && sameId(patientUserId, sessUserId)) return true;

  // 2) найдём карточку пациента по userId и сверим _id
  const myPatientCardId = await getPatientCardIdByUser(sessUserId);
  if (!myPatientCardId) return false;

  const labPatientId = labTest?.patient?._id || labTest?.patient?.id;
  if (labPatientId && sameId(labPatientId, myPatientCardId)) return true;

  // 3) фолбэк по файлам: files[].patientId
  if (Array.isArray(labTest?.files)) {
    for (const f of labTest.files) {
      const filePatientId =
        (f?.patientId && (f.patientId._id || f.patientId.id || f.patientId)) ||
        null;
      if (filePatientId && sameId(filePatientId, myPatientCardId)) return true;
    }
  }

  return false;
};

const getMyLablFilesDetailsController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Некорректный ID" });
    }
    if (req.session?.role !== "patient") {
      return res
        .status(403)
        .json({ message: "Доступ разрешён только пациенту" });
    }

    const labTest = await findLabTestByIdOrFileId(id);
    if (!labTest) {
      return res.status(404).json({ message: "Анализ не найден" });
    }

    const allowed = await patientOwnsLabTest(labTest, req.session);
    if (!allowed) {
      return res
        .status(403)
        .json({ message: "⛔ У вас нет прав на просмотр этого анализа" });
    }

    return res.status(200).json({
      message: "✅ Детали лабораторного анализа",
      data: labTest,
    });
  } catch (err) {
    console.error("❌ Ошибка получения деталей LabTest:", err);
    return res.status(500).json({
      message: "Ошибка сервера при получении деталей анализа",
      error: err.message,
    });
  }
};

export default getMyLablFilesDetailsController;
