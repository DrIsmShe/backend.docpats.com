// server/modules/admin/controllers/UserPatientDetailGetController.js
import mongoose from "mongoose";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import Article from "../../../common/models/Articles/articles.js";
import File from "../../../common/models/file.js";
import Comment from "../../../common/models/Comments/CommentDocpats.js";
import MedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";

/**
 * @route   GET /admin/user-patient-detail-get/:id
 * @desc    Возвращает полную информацию о пациенте со всеми связанными коллекциями
 * @access  Admin / Doctor
 */
export const UserPatientDetailGetController = async (req, res) => {
  try {
    const { id } = req.params;

    // === Проверка валидности ID ===
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Неверный формат ID пациента",
      });
    }

    // === 1️⃣ Основная информация о пользователе ===
    const userDoc = await User.findById(id).lean();
    if (!userDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Пациент не найден" });
    }

    // Безопасная расшифровка
    const safeDecrypt = (val) => {
      try {
        return val ? decrypt(val)?.replace(/[^\p{L}\s\d@.()+-]/gu, "") : null;
      } catch {
        return null;
      }
    };

    const decryptedUser = {
      ...userDoc,
      // .lean() обходит toJSON — вычищаем секреты и шифртекст вручную
      // (undefined-ключи не попадают в JSON-ответ).
      password: undefined,
      passwordHistory: undefined,
      twoFactorAuth: undefined,
      sessions: undefined,
      pendingNewPasswordHash: undefined,
      otpPassword: undefined,
      activationOtp: undefined,
      firstNameEncrypted: undefined,
      lastNameEncrypted: undefined,
      emailEncrypted: undefined,
      firstNameHash: undefined,
      lastNameHash: undefined,
      emailHash: undefined,
      phoneHash: undefined,
      firstName: safeDecrypt(userDoc.firstNameEncrypted),
      lastName: safeDecrypt(userDoc.lastNameEncrypted),
      email: safeDecrypt(userDoc.emailEncrypted),
    };

    // === 2️⃣ Информация из NewPatientPolyclinic ===
    const npcDoc = await NewPatientPolyclinic.findOne({
      $or: [{ linkedUserId: id }, { patientId: id }],
    }).lean();

    const npcId = npcDoc?._id || null;
    const bioText = npcDoc?.bio?.toLowerCase()?.trim() || "";

    decryptedUser.dateOfBirth =
      userDoc.dateOfBirth || npcDoc?.birthDate || null;
    decryptedUser.gender =
      userDoc.gender ||
      npcDoc?.gender ||
      (["муж", "male", "m"].includes(bioText)
        ? "male"
        : ["жен", "female", "f"].includes(bioText)
        ? "female"
        : null);
    decryptedUser.phoneNumber =
      userDoc.phoneNumber ||
      npcDoc?.phoneNumber ||
      safeDecrypt(npcDoc?.phoneEncrypted) ||
      null;
    decryptedUser.address = userDoc.address || npcDoc?.address || null;
    decryptedUser.country = userDoc.country || npcDoc?.country || null;

    // === 3️⃣ Профиль пациента ===
    let patientProfile = await PatientProfile.findOne({ userId: id })
      .populate({
        path: "doctorId",
        model: "User",
        select: "username role firstNameEncrypted lastNameEncrypted avatar",
      })
      .populate("files")
      .populate({
        path: "outDoctor.doctorId inDoctor.doctorId consultations.doctorId",
        select: "fullName specialization clinic",
      })
      .lean();

    if (!patientProfile) {
      patientProfile = {
        address: decryptedUser.address,
        country: decryptedUser.country,
      };
    }

    decryptedUser.photo = patientProfile?.photo || userDoc.photo || null;

    // === 4️⃣ Посещения поликлиники ===
    const polyclinicRecords = npcId
      ? await NewPatientPolyclinic.find({ _id: npcId })
          .populate({
            path: "doctorId",
            model: "User",
            select: "username role avatar firstNameEncrypted lastNameEncrypted",
          })
          .lean()
      : [];

    for (const record of polyclinicRecords) {
      const doctorArray = Array.isArray(record.doctorId)
        ? record.doctorId
        : record.doctorId
        ? [record.doctorId]
        : [];

      record.doctors = await Promise.all(
        doctorArray.map(async (doc) => {
          const firstName = safeDecrypt(doc.firstNameEncrypted);
          const lastName = safeDecrypt(doc.lastNameEncrypted);
          const fullName = `${firstName || ""} ${lastName || ""}`.trim();

          const doctorProfile = await DoctorProfile.findOne({
            userId: doc._id,
          })
            .select("clinic country specializationInstitution")
            .lean();

          return {
            _id: doc._id,
            fullName,
            clinic: doctorProfile?.clinic || "—",
            specialization: doctorProfile?.specializationInstitution || "—",
            country: doctorProfile?.country || "—",
            avatar: doc.avatar || "/images/default-avatar.png",
            visitDate: record.createdAt || null,
          };
        })
      );
    }

    // === 5️⃣ Истории болезни ===
    let medicalHistories = [];
    if (npcId) {
      medicalHistories = await MedicalHistory.find({ patientId: npcId })
        .populate({
          path: "doctorId",
          model: "User",
          select: "username role avatar firstNameEncrypted lastNameEncrypted",
        })
        .populate({
          path: "doctorProfileId",
          model: "DoctorProfile",
          select: "clinic country specializationInstitution",
        })
        .populate("files")
        .sort({ createdAt: -1 })
        .lean();

      for (const mh of medicalHistories) {
        if (mh.doctorId) {
          mh.doctorId.firstName = safeDecrypt(mh.doctorId.firstNameEncrypted);
          mh.doctorId.lastName = safeDecrypt(mh.doctorId.lastNameEncrypted);
        }
      }
    }

    // === 6️⃣ Комментарии ===
    const [commentsAboutPatient, commentsByPatient] = await Promise.all([
      Comment.find({ targetId: id })
        .populate({
          path: "authorId",
          model: "User",
          select: "username role avatar firstNameEncrypted lastNameEncrypted",
        })
        .lean(),
      Comment.find({ authorId: id })
        .populate({
          path: "targetId",
          model: "User",
          select: "username role avatar firstNameEncrypted lastNameEncrypted",
        })
        .lean(),
    ]);

    for (const list of [commentsAboutPatient, commentsByPatient]) {
      for (const c of list) {
        if (c.authorId) {
          c.authorId.firstName = safeDecrypt(c.authorId.firstNameEncrypted);
          c.authorId.lastName = safeDecrypt(c.authorId.lastNameEncrypted);
        }
        if (c.targetId) {
          c.targetId.firstName = safeDecrypt(c.targetId.firstNameEncrypted);
          c.targetId.lastName = safeDecrypt(c.targetId.lastNameEncrypted);
        }
      }
    }

    // === 7️⃣ Файлы пациента ===
    let files = [];
    if (npcId) {
      try {
        files = await File.find({ patientId: npcId })
          .populate({
            path: "uploadedByDoctor",
            model: "User",
            select: "username firstNameEncrypted lastNameEncrypted role avatar",
          })
          .sort({ createdAt: -1 })
          .lean();

        for (const f of files) {
          if (f.uploadedByDoctor) {
            f.uploadedByDoctor.firstName = safeDecrypt(
              f.uploadedByDoctor.firstNameEncrypted
            );
            f.uploadedByDoctor.lastName = safeDecrypt(
              f.uploadedByDoctor.lastNameEncrypted
            );
          }
        }
      } catch (err) {
        console.warn("⚠️ Ошибка при получении файлов пациента:", err.message);
      }
    }

    // === 8️⃣ Статьи пациента ===
    const articles = await Article.find({ authorId: id })
      .select("title createdAt categoryId viewsCount isPublished")
      .populate("categoryId", "name slug")
      .lean();

    // === 9️⃣ Статистика ===
    const stats = {
      totalCommentsWritten: commentsByPatient.length,
      totalCommentsReceived: commentsAboutPatient.length,
      totalFiles: files.length,
      totalMedicalHistories: medicalHistories.length,
      totalArticles: articles.length,
      totalPolyclinicRecords: polyclinicRecords.length,
    };

    // === 🔟 Финальный ответ ===
    return res.status(200).json({
      success: true,
      user: decryptedUser,
      profile: patientProfile,
      polyclinicRecords,
      medicalHistories,
      comments: {
        byPatient: commentsByPatient,
        aboutPatient: commentsAboutPatient,
      },
      files,
      articles,
      stats,
    });
  } catch (err) {
    console.error("❌ Полная ошибка в UserPatientDetailGetController:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении полной информации о пациенте",
      error: err.message,
    });
  }
};
