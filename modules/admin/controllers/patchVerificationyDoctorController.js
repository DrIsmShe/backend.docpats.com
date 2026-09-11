// modules/admin/controllers/patchVerificationyDoctorController.js
//
// Решение администратора по допуску врача.
//
// ЧТО ИЗМЕНИЛОСЬ И ПОЧЕМУ.
//
// 1. РЕШЕНИЕ ПОПАДАЕТ В ЖУРНАЛ. Раньше след оставался в трёх полях
//    профиля, и следующее решение затирало предыдущее: на вопрос «кто и
//    когда допустил этого врача к рецептам» ответа не было. Теперь
//    событие пишется в append-only журнал HIPAA — его нельзя ни
//    изменить, ни удалить.
//
// 2. У ДОПУСКА ПОЯВИЛСЯ СРОК. Раньше "approved" стоял вечно: лицензия
//    истекала в 2026-м, а врач оставался подтверждённым в 2030-м. Срок
//    считается по документам — самая ранняя подтверждённая дата
//    окончания среди обязательных.
//
// 3. ОДОБРИТЬ МОЖНО ТОЛЬКО С ПОЛНЫМ НАБОРОМ. Обязательных четыре:
//    лицензия, диплом, подтверждение специализации, удостоверение
//    личности. Раньше администратор нажимал «одобрить» при любом наборе
//    файлов, вплоть до пустого, — то есть допуск к рецептам выдавался
//    без единого документа.
//
//    Обход есть: force: true. Он существует не для удобства, а потому
//    что бывают законные исключения — врач прислал документ по другому
//    каналу, страна не выдаёт отдельного сертификата специалиста. Обход
//    уходит в журнал отдельным признаком, и это его главное свойство:
//    исключение должно быть видно проверяющему.
//
// 4. ПОЯВИЛИСЬ suspended И restore. Приостановка — не то же самое, что
//    отказ: документы в порядке, допуск снят на время (жалоба,
//    расследование). Врачу это объясняется иначе, и возвращается он
//    иначе.

import mongoose from "mongoose";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import User from "../../../common/models/Auth/users.js";
import {
  СОБЫТИЯ,
  записатьРешение,
  контекстЗапроса,
  пересчитатьСрок,
  чегоНеХватает,
} from "../services/doctorVerification.service.js";

/* Статус → событие журнала. Переход в pending события не порождает:
   это возврат документов на проверку, а не решение. */
const СОБЫТИЕ_СТАТУСА = {
  approved: СОБЫТИЯ.ОДОБРИТЬ,
  rejected: СОБЫТИЯ.ОТКЛОНИТЬ,
  suspended: СОБЫТИЯ.ПРИОСТАНОВИТЬ,
};

const ДОПУСТИМЫЕ = ["approved", "rejected", "pending", "suspended"];

const PatchVerificationDoctorController = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const adminId = req.session?.userId;
    const { doctorProfileId } = req.params;
    const { status, comment, force } = req.body;

    if (!adminId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const adminUser = await User.findById(adminId);
    if (!adminUser || adminUser.role !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only admin can change verification status",
      });
    }

    if (!ДОПУСТИМЫЕ.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid verification status",
      });
    }

    const doctorProfile =
      await DoctorProfile.findById(doctorProfileId).session(session);

    if (!doctorProfile) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Doctor profile not found" });
    }

    const былСтатус = doctorProfile.verificationStatus;

    /* ── Одобрение требует полного набора документов ─────────────────── */
    if (status === "approved" && !force) {
      const документы = await DoctorVerificationDocument.find({
        doctorProfileId: doctorProfile._id,
      })
        .select("documentType status isArchivedByDoctor")
        .session(session)
        .lean();

      /* Документы, лежащие на проверке, засчитываются как одобренные: этим
         же запросом администратор их и одобряет (updateMany ниже). Иначе
         «одобрить всё разом» упиралось бы в требование сначала одобрить
         каждый документ по отдельности. */
      const сУчётомРешения = документы.map((д) =>
        д.status === "pending" ? { ...д, status: "approved" } : д,
      );

      const нехватка = чегоНеХватает(сУчётомРешения);
      if (нехватка.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          code: "REQUIRED_DOCUMENTS_MISSING",
          missing: нехватка,
          message:
            "Не хватает обязательных документов: " + нехватка.join(", "),
        });
      }
    }

    /* ── Документы ──────────────────────────────────────────────────────
     * Порядок важен: сначала документы, потом пересчёт срока — иначе срок
     * считался бы по тому, что было ДО решения. */
    if (["approved", "rejected"].includes(status)) {
      await DoctorVerificationDocument.updateMany(
        { doctorProfileId: doctorProfile._id, status: "pending" },
        {
          $set: {
            status,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            reviewComment: comment || "",
          },
        },
        { session },
      );
    }

    /* ── Профиль ─────────────────────────────────────────────────────── */
    doctorProfile.verificationStatus = status;
    doctorProfile.verificationReviewedBy = adminId;
    doctorProfile.verificationReviewedAt = new Date();
    doctorProfile.verificationReviewComment = comment || "";
    doctorProfile.isVerified = status === "approved";

    let срок = null;
    if (status === "approved") {
      ({ срок } = await пересчитатьСрок(doctorProfile, session));
    } else {
      /* Допуск снят — срок и ступень предупреждений теряют смысл.
         Оставить их значило бы прислать врачу без допуска письмо
         «ваша лицензия истекает через 30 дней». */
      doctorProfile.verificationExpiresAt = null;
      doctorProfile.verificationExpiryNoticeStage = null;
    }

    await doctorProfile.save({ session });

    /* ── Журнал ──────────────────────────────────────────────────────── */
    const событие = СОБЫТИЕ_СТАТУСА[status];
    if (событие) {
      await записатьРешение({
        действие: событие,
        администратор: {
          userId: adminId,
          email: adminUser.email,
          role: adminUser.role,
        },
        профиль: doctorProfile,
        сведения: {
          previousStatus: былСтатус,
          newStatus: status,
          expiresAt: срок ? срок.toISOString() : null,
          hasComment: Boolean(comment),
          // Признак обхода набора документов. Именно ради него force и
          // существует как отдельное поле, а не как молчаливое послабление.
          forced: Boolean(force),
        },
        контекст: контекстЗапроса(req),
        session,
      });
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `Doctor verification status updated to ${status}`,
      verificationStatus: doctorProfile.verificationStatus,
      isVerified: doctorProfile.isVerified,
      verificationExpiresAt: doctorProfile.verificationExpiresAt,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("❌ Patch verification error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while updating verification",
      error: error.message,
    });
  }
};

export default PatchVerificationDoctorController;
