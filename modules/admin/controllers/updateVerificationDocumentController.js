// modules/admin/controllers/updateVerificationDocumentController.js
//
// Решение администратора по ОДНОМУ документу.
//
// ЗДЕСЬ ПОДТВЕРЖДАЕТСЯ ДАТА ОКОНЧАНИЯ. Дату вписывает врач, глядя на
// свою бумагу; до сверки это его слово. Администратор, одобряя документ,
// либо соглашается с датой, либо ставит свою — и только после этого дата
// попадает в срок допуска. Без сверки врач продлевал бы себе допуск,
// вписав 2099 год.
//
// СРОК ДОПУСКА ПЕРЕСЧИТЫВАЕТСЯ ТУТ ЖЕ. Он равен самой ранней
// подтверждённой дате среди обязательных документов, и одобрение любого
// из них может его сдвинуть — как вперёд (продлили лицензию), так и
// назад (приняли сертификат с более близким сроком). Считать его
// отдельной кнопкой значило бы завести состояние, которое расходится с
// документами.
//
// ПОЧЕМУ ТРАНЗАКЦИЯ. Документ, профиль и запись в журнале меняются
// вместе: одобренный документ без пересчитанного срока — это допуск,
// который считает себя бессрочным.

import mongoose from "mongoose";
import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import {
  СОБЫТИЯ,
  записатьРешение,
  контекстЗапроса,
  пересчитатьСрок,
} from "../services/doctorVerification.service.js";

/** Дата из тела запроса: либо корректная, либо её нет. */
function дата(значение) {
  if (!значение) return null;
  const d = new Date(значение);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const updateVerificationDocumentController = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { id } = req.params;
    const {
      status,
      reviewComment,
      // Что администратор сверил с бумагой. Любое поле необязательно:
      // у диплома нет срока, у документа из страны без реестра может не
      // быть номера.
      expiresAt,
      issuedAt,
      documentNumber,
      issuingAuthority,
      jurisdictionCode,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Invalid document ID" });
    }

    if (!["approved", "rejected"].includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected",
      });
    }

    const document = await DoctorVerificationDocument.findById(id).session(
      session,
    );

    if (!document) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Document not found" });
    }

    if (document.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Document already reviewed" });
    }

    /* ── Что сверил администратор ────────────────────────────────────── */
    const новыйСрок = дата(expiresAt);
    const новаяВыдача = дата(issuedAt);

    if (новыйСрок) document.expiresAt = новыйСрок;
    if (новаяВыдача) document.issuedAt = новаяВыдача;
    if (typeof documentNumber === "string") {
      document.documentNumber = documentNumber.trim() || null;
    }
    if (typeof issuingAuthority === "string") {
      document.issuingAuthority = issuingAuthority.trim() || null;
    }
    if (typeof jurisdictionCode === "string") {
      document.jurisdictionCode = jurisdictionCode.trim().toUpperCase() || null;
    }

    /* Дата считается подтверждённой только вместе с одобрением документа:
       отклонённый документ не даёт допуска, и его срок ни на что не
       влияет. Дата, которой нет вовсе, подтверждённой не становится —
       иначе диплом (у него срока нет) выглядел бы как документ с
       подтверждённым сроком null, и отличить «бессрочно» от «не
       проверяли» стало бы нечем. */
    document.expiryConfirmed = status === "approved" && Boolean(document.expiresAt);

    document.status = status;
    document.reviewComment = reviewComment || "";
    document.reviewedBy = req.userId;
    document.reviewedAt = new Date();

    await document.save({ session });

    /* ── Срок допуска ─────────────────────────────────────────────────── */
    let срокДопускаПосле = null;
    const профиль = await DoctorProfile.findById(
      document.doctorProfileId,
    ).session(session);

    if (профиль) {
      const { срок } = await пересчитатьСрок(профиль, session);
      срокДопускаПосле = срок;
      await профиль.save({ session });
    }

    /* ── Журнал ──────────────────────────────────────────────────────── */
    const админ = await User.findById(req.userId).select("email role").lean();
    await записатьРешение({
      действие:
        status === "approved"
          ? СОБЫТИЯ.ДОКУМЕНТ_ОДОБРЕН
          : СОБЫТИЯ.ДОКУМЕНТ_ОТКЛОНЁН,
      администратор: {
        userId: req.userId,
        email: админ?.email || null,
        role: админ?.role || "admin",
      },
      профиль,
      // Ресурс здесь — сам документ, а не профиль: решение принято по нему.
      ресурсId: document._id,
      сведения: {
        documentType: document.documentType,
        // Номера и имени органа в журнале нет: правило модуля аудита —
        // в metadata только структура. Достаточно признака, что данные есть.
        hasNumber: Boolean(document.documentNumber),
        hasAuthority: Boolean(document.issuingAuthority),
        jurisdictionCode: document.jurisdictionCode || null,
        expiresAt: document.expiresAt
          ? new Date(document.expiresAt).toISOString()
          : null,
        expiryConfirmed: document.expiryConfirmed,
        accessExpiresAt: срокДопускаПосле
          ? срокДопускаПосле.toISOString()
          : null,
      },
      контекст: контекстЗапроса(req),
      session,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `Document ${status}`,
      document,
      verificationExpiresAt: срокДопускаПосле,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("updateVerificationDocumentController error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating verification document",
    });
  }
};

export default updateVerificationDocumentController;
