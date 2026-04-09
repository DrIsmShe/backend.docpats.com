// server/modules/admin/controllers/UserDetailGetController.js
import mongoose from "mongoose";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import Article from "../../../common/models/Articles/articles.js";
import File from "../../../common/models/file.js";
import Comment from "../../../common/models/Comments/CommentDocpats.js";
import MedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import { decryptPhone } from "../../../common/middlewares/cryptoPhone.js";

/**
 * Аккуратная расшифровка пользователя
 */
function buildDecryptedUser(rawUser) {
  if (!rawUser) return null;

  return {
    ...rawUser,
    email: rawUser.emailEncrypted ? decrypt(rawUser.emailEncrypted) : null,
    firstName: rawUser.firstNameEncrypted
      ? decrypt(rawUser.firstNameEncrypted)
      : null,
    lastName: rawUser.lastNameEncrypted
      ? decrypt(rawUser.lastNameEncrypted)
      : null,
    phoneNumber: rawUser.phoneEncrypted
      ? decrypt(rawUser.phoneEncrypted)
      : null,
  };
}

/**
 * Расшифровка телефона профиля врача внутри MedicalHistory (doctorProfileId)
 * histories здесь уже .lean()
 */
function mapHistoriesWithDecryptedDoctorPhone(histories) {
  if (!Array.isArray(histories)) return [];

  return histories.map((h) => {
    if (!h.doctorProfileId) return h;

    const dp = h.doctorProfileId;

    if (!dp.phoneEncrypted) {
      return {
        ...h,
        doctorProfileId: {
          ...dp,
          phoneNumber: dp.phoneNumber || null,
        },
      };
    }

    let phoneNumber = null;
    try {
      phoneNumber = decryptPhone(dp.phoneEncrypted);
    } catch (e) {
      phoneNumber = null;
    }

    return {
      ...h,
      doctorProfileId: {
        ...dp,
        phoneNumber,
        // phoneEncrypted уходим в undefined, чтобы не улетало в JSON
        phoneEncrypted: undefined,
      },
    };
  });
}

/**
 * GET /admin/user-detail-get/:id
 * Расширенный контроллер для администратора:
 *  - возвращает все связанные данные пользователя
 *  - поддерживает расшифровку, связи и вложенные связи
 */
const UserDetailGetController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    /* === Основной пользователь === */
    const userDoc = await User.findById(id)
      .populate("specialization", "name category _id")
      .populate(
        "friends.userId",
        "firstNameEncrypted lastNameEncrypted avatar role status",
      )
      .lean();

    if (!userDoc) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const decryptedUser = buildDecryptedUser(userDoc);

    /* === Общие данные (для обеих ролей) === */
    const [articles, files, historiesRaw] = await Promise.all([
      Article.find({ authorId: id }).populate("category", "name").lean(),
      File.find({ $or: [{ uploadedByDoctor: id }, { patientId: id }] }).lean(),
      MedicalHistory.find({ $or: [{ doctorId: id }, { patientRef: id }] })
        .populate("doctorId", "firstNameEncrypted lastNameEncrypted role")
        .populate("patientRef")
        .populate("files")
        .populate(
          "doctorProfileId",
          "clinic company country phoneEncrypted phoneNumber",
        )
        .populate("allergies")
        .populate("chronicDiseases")
        .populate("operations")
        .populate("familyHistoryOfDisease")
        .populate("immunization")
        .lean(),
    ]);

    const histories = mapHistoriesWithDecryptedDoctorPhone(historiesRaw);

    /* =====================================================================
       ЕСЛИ ВРАЧ
       ===================================================================== */
    if (userDoc.role === "doctor" || userDoc.isDoctor) {
      // ⬇️ DoctorProfile БЕЗ .lean(), чтобы сработали virtual + toJSON
      const doctorProfileDoc = await DoctorProfile.findOne({ userId: id })
        .populate(
          "outpatientPatients.patientId",
          "firstNameEncrypted lastNameEncrypted birthDate",
        )
        .populate(
          "inpatientPatients.patientId",
          "firstNameEncrypted lastNameEncrypted birthDate",
        );

      // Если профиль найден — используем его toJSON(), где уже:
      //  - добавлен virtual phoneNumber
      //  - удалены phoneEncrypted / phoneHash
      const doctorProfile = doctorProfileDoc ? doctorProfileDoc.toJSON() : null;

      // Пациенты врача (NewPatientPolyclinic)
      const npcDocs = await NewPatientPolyclinic.find({ doctorId: id })
        .populate(
          "linkedUserId",
          "firstNameEncrypted lastNameEncrypted avatar role emailEncrypted",
        )
        .lean();

      const allPatients = npcDocs.map((p) => ({
        _id: p.linkedUserId?._id || p._id,
        firstName: p.linkedUserId
          ? decrypt(p.linkedUserId.firstNameEncrypted)
          : decrypt(p.firstNameEncrypted),
        lastName: p.linkedUserId
          ? decrypt(p.linkedUserId.lastNameEncrypted)
          : decrypt(p.lastNameEncrypted),
        email: p.linkedUserId?.emailEncrypted
          ? decrypt(p.linkedUserId.emailEncrypted)
          : decrypt(p.emailEncrypted),
        avatar: p.linkedUserId?.avatar || null,
        bio: p.bio,
        birthDate: p.birthDate,
        country: p.country,
        status: p.status,
        isVerified: p.isVerified,
      }));

      const stats = {
        totalPatients: allPatients.length,
        totalArticles: articles.length,
        totalFiles: files.length,
        totalHistories: histories.length,
      };

      return res.status(200).json({
        success: true,
        user: decryptedUser,
        doctorProfile,
        patients: allPatients,
        stats,
        articles,
        files,
        histories,
      });
    }

    /* =====================================================================
       ЕСЛИ ПАЦИЕНТ
       ===================================================================== */
    if (userDoc.role === "patient" || userDoc.isPatient) {
      const patientProfile = await PatientProfile.findOne({ userId: id })
        .populate("files")
        .populate("comments")
        .populate("doctorId", "firstNameEncrypted lastNameEncrypted role")
        .populate("outDoctor.doctorId", "clinic company country")
        .populate("inDoctor.doctorId", "clinic company country")
        .lean();

      const polyclinicProfile = await NewPatientPolyclinic.findOne({
        linkedUserId: id,
      })
        .populate(
          "doctorId",
          "firstNameEncrypted lastNameEncrypted role emailEncrypted",
        )
        .lean();

      const decryptedDoctors =
        polyclinicProfile?.doctorId?.map((d) => ({
          _id: d._id,
          firstName: decrypt(d.firstNameEncrypted),
          lastName: decrypt(d.lastNameEncrypted),
          email: decrypt(d.emailEncrypted),
          role: d.role,
        })) || [];

      const patientHistories = await MedicalHistory.find({
        patientRef: polyclinicProfile?._id,
      })
        .populate("doctorId", "firstNameEncrypted lastNameEncrypted role")
        .populate("doctorProfileId", "clinic company country")
        .populate("files")
        .populate("allergies")
        .populate("operations")
        .populate("chronicDiseases")
        .populate("familyHistoryOfDisease")
        .populate("immunization")
        .lean();

      const patientFiles = await File.find({
        patientId: polyclinicProfile?._id,
      })
        .populate(
          "uploadedByDoctor",
          "firstNameEncrypted lastNameEncrypted role",
        )
        .lean();

      const [commentsWritten, commentsReceived] = await Promise.all([
        Comment.find({ author: id })
          .populate("targetId")
          .populate(
            "author",
            "firstNameEncrypted lastNameEncrypted role avatar",
          )
          .lean(),
        Comment.find({ targetId: id })
          .populate(
            "author",
            "firstNameEncrypted lastNameEncrypted role avatar",
          )
          .lean(),
      ]);

      const decryptedPatientProfile = patientProfile
        ? {
            ...patientProfile,
            books: patientProfile.books || [],
            videos: patientProfile.videos || [],
            library: patientProfile.library || [],
            lessons: patientProfile.lessons || [],
            consultations: patientProfile.consultations || [],
            videoConferences: patientProfile.videoConferences || [],
            status: patientProfile.status,
            paymentStatus: patientProfile.paymentStatus,
            about: patientProfile.about,
            company: patientProfile.company,
            address: patientProfile.address,
            educationInstitution: patientProfile.educationInstitution,
          }
        : null;

      const decryptedPolyclinicProfile = polyclinicProfile
        ? {
            ...polyclinicProfile,
            firstName: decrypt(polyclinicProfile.firstNameEncrypted),
            lastName: decrypt(polyclinicProfile.lastNameEncrypted),
            email: decrypt(polyclinicProfile.emailEncrypted),
            phone: polyclinicProfile.phoneEncrypted
              ? decryptPhone(polyclinicProfile.phoneEncrypted)
              : null,
            chronicDiseases: polyclinicProfile.chronicDiseases,
            operations: polyclinicProfile.operations,
            allergies: polyclinicProfile.allergies,
            familyHistoryOfDisease: polyclinicProfile.familyHistoryOfDisease,
            immunization: polyclinicProfile.immunization,
            bio: polyclinicProfile.bio,
            about: polyclinicProfile.about,
            address: polyclinicProfile.address,
          }
        : null;

      const stats = {
        totalDoctors: decryptedDoctors.length,
        totalFiles: patientFiles.length,
        totalHistories: patientHistories.length,
        totalComments:
          (commentsWritten?.length || 0) + (commentsReceived?.length || 0),
        totalArticles: articles.length,
      };

      return res.status(200).json({
        success: true,
        user: decryptedUser,
        patientProfile: decryptedPatientProfile,
        polyclinicProfile: decryptedPolyclinicProfile,
        doctors: decryptedDoctors,
        commentsWritten,
        commentsReceived,
        stats,
        patientHistories,
        patientFiles,
        articles,
      });
    }

    /* =====================================================================
       ДРУГИЕ РОЛИ (админ и т.п.)
       ===================================================================== */
    return res.status(200).json({
      success: true,
      user: decryptedUser,
      articles,
      files,
      histories,
    });
  } catch (error) {
    console.error("❌ Error retrieving user information:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching user details",
      error: error.message,
    });
  }
};

export default UserDetailGetController;
