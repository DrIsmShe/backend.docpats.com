import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js";
import { errorText } from "../../../common/i18n/index.js";
import {
  СОБЫТИЯ,
  записатьРешение,
  контекстЗапроса,
} from "../../admin/services/doctorVerification.service.js";

/** Дата из формы: либо корректная, либо её нет. */
function дата(значение) {
  if (!значение) return null;
  const d = new Date(значение);
  return Number.isNaN(d.getTime()) ? null : d;
}

const AddVerificationDocumentsController = async (req, res) => {
  try {
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    /* Что написано в документе — врач переписывает это с бумаги.
     *
     * ПОЧЕМУ ВРУЧНУЮ, А НЕ РАСПОЗНАВАНИЕМ. Дата окончания решает, когда
     * закроется допуск к рецептам; ошибка распознавания в ней стоит
     * дороже, чем минута работы врача. Администратор потом сверяет это
     * с изображением и подтверждает — до подтверждения дата на срок
     * допуска не влияет вовсе.
     *
     * Все поля необязательны: у диплома нет срока, у документа из
     * страны без реестра может не быть номера. Требовать их от всех
     * значило бы заставлять придумывать. */
    const {
      documentType,
      documentNumber,
      issuingAuthority,
      jurisdictionCode,
      issuedAt,
      expiresAt,
    } = req.body;

    if (!documentType) {
      return res.status(400).json({
        success: false,
        message: "Document type is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    // 🔎 Найти профиль врача
    const doctorProfile = await DoctorProfile.findOne({ userId: userId });

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found",
      });
    }

    // 🔍 Проверяем, есть ли уже документ этого типа
    const existingDocument = await DoctorVerificationDocument.findOne({
      doctorProfileId: doctorProfile._id,
      documentType,
      status: { $in: ["pending", "approved"] },
    });

    if (existingDocument) {
      // 🚫 Если уже pending
      if (existingDocument.status === "pending") {
        return res.status(400).json({
          success: false,
          message: "You already have a pending document of this type",
        });
      }

      // 🔒 Если уже approved
      if (existingDocument.status === "approved") {
        return res.status(400).json({
          success: false,
          message: "This document type is already approved",
        });
      }

      // ♻ Если rejected — удаляем старый и разрешаем новый
      if (existingDocument.status === "rejected") {
        await DoctorVerificationDocument.deleteOne({
          _id: existingDocument._id,
        });
      }
    }

    // 📤 Загружаем файл (R2 или local)
    const fileUrl = await uploadFile(req.file);

    // 💾 Создаем новый документ
    const newDocument = await DoctorVerificationDocument.create({
      doctorProfileId: doctorProfile._id,
      userId,
      documentType,
      fileUrl,
      fileName: req.file.originalname,
      fileMime: req.file.mimetype,
      fileSize: req.file.size,
      status: "pending",
      documentNumber: (documentNumber || "").trim() || null,
      issuingAuthority: (issuingAuthority || "").trim() || null,
      jurisdictionCode:
        (jurisdictionCode || "").trim().toUpperCase() ||
        // Юрисдикция документа по умолчанию — страна врача. Лицензия
        // почти всегда выдана там, где он работает; несовпадение
        // (турецкая лицензия в Азербайджане) врач указывает сам.
        (doctorProfile.country || "").trim().toUpperCase() ||
        null,
      issuedAt: дата(issuedAt),
      expiresAt: дата(expiresAt),
      // Слово врача, пока администратор не сверил с изображением.
      expiryConfirmed: false,
    });

    /* ПОДАННЫЙ ДОКУМЕНТ ПЕРЕВОДИТ ВРАЧА В ОЧЕРЕДЬ.
     *
     * Этого не делалось вовсе: документ создавался, а
     * DoctorProfile.verificationStatus оставался not_submitted. Очередь
     * администратора берёт врачей со статусом pending — и врач, честно
     * приславший лицензию, в неё не попадал НИКОГДА. На карточке врача
     * документ было видно, в очереди — нет; заявка ждала, пока кто-нибудь
     * случайно откроет именно этого пользователя.
     *
     * Переводим только из not_submitted и rejected: это и есть «подал
     * заново». Одобренного и приостановленного трогать нельзя — новый
     * документ не отменяет действующего решения и не снимает
     * приостановку, а сама подача не должна быть способом сбросить
     * статус, который поставил администратор. */
    if (["not_submitted", "rejected"].includes(doctorProfile.verificationStatus)) {
      doctorProfile.verificationStatus = "pending";
      doctorProfile.isVerified = false;
      await doctorProfile.save();
    }

    /* Подача документа — событие журнала.
     *
     * Оно нужно не меньше решения администратора: спор «я подавал
     * лицензию ещё в марте» разрешается записью о подаче, а не
     * отсутствием таковой. Пишем без транзакции и не роняем загрузку
     * при сбое журнала: файл уже в хранилище, и откатывать его дороже,
     * чем потерять одну строчку следа о подаче. Решения администратора,
     * в отличие от этого, пишутся внутри транзакции. */
    записатьРешение({
      действие: СОБЫТИЯ.ПОДАНО,
      администратор: { userId, role: "doctor" },
      профиль: doctorProfile,
      ресурсId: newDocument._id,
      сведения: {
        documentType,
        hasNumber: Boolean(newDocument.documentNumber),
        hasAuthority: Boolean(newDocument.issuingAuthority),
        jurisdictionCode: newDocument.jurisdictionCode || null,
        expiresAt: newDocument.expiresAt
          ? new Date(newDocument.expiresAt).toISOString()
          : null,
        fileMime: req.file.mimetype,
        fileSize: req.file.size,
      },
      контекст: контекстЗапроса(req),
    }).catch((err) =>
      console.warn("[верификация] подача не записана в журнал:", err.message),
    );

    return res.status(201).json({
      success: true,
      message: "Verification document uploaded successfully",
      document: newDocument,
    });
  } catch (error) {
    console.error("❌ Verification upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while uploading verification document",
      error: errorText(error, req),
    });
  }
};

export default AddVerificationDocumentsController;
