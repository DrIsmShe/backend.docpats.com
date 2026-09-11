// modules/admin/controllers/extendVerificationController.js
//
// Продлить и восстановить допуск врача.
//
// ЗАЧЕМ ПРОДЛЕНИЕ ВООБЩЕ СУЩЕСТВУЕТ. Срок допуска выводится из дат на
// документах, и по-другому быть не должно. Но между «лицензия истекла» и
// «врач получил новую» есть промежуток, в котором он не виноват: орган
// перевыпускает месяцами, справка о подаче на руках есть, новой бумаги
// ещё нет. Автоматика в этом месте закрыла бы рецепты действующему врачу.
//
// Поэтому продление — решение человека, который видел основание. Оно
// уходит в журнал вместе с причиной, и по журналу видно: допуск держится
// не на документе, а на чьём-то решении.
//
// ПОЧЕМУ ПРИЧИНА ОБЯЗАТЕЛЬНА. Продление без объяснения через полгода
// неотличимо от ошибки, а проверяющему отвечать придётся именно на
// «почему этот врач работал по истёкшей лицензии».
//
// ВОССТАНОВЛЕНИЕ — ДРУГОЕ. Оно возвращает допуск из suspended или
// expired, пересчитывая срок по документам заново. Если документы
// по-прежнему просрочены, восстановление отказывает: вернуть допуск по
// истёкшей бумаге можно только продлением, где решение названо решением.

import mongoose from "mongoose";
import DoctorProfile, {
  действуетДо,
} from "../../../common/models/DoctorProfile/profileDoctor.js";
import User from "../../../common/models/Auth/users.js";
import {
  СОБЫТИЯ,
  записатьРешение,
  контекстЗапроса,
  пересчитатьСрок,
  чегоНеХватает,
} from "../services/doctorVerification.service.js";

/* Насколько далеко вперёд можно продлить одним решением.
   Год — потому что продление задумано как мост до новой бумаги, а не
   как замена ей. Нужен больший срок — это уже не продление, а вопрос
   к документам. */
const ПРЕДЕЛ_ПРОДЛЕНИЯ_ДНЕЙ = 365;

function дата(значение) {
  if (!значение) return null;
  const d = new Date(значение);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function администратор(req, res) {
  const adminId = req.session?.userId;
  if (!adminId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  const user = await User.findById(adminId).select("email role").lean();
  if (!user || user.role !== "admin") {
    res.status(403).json({
      success: false,
      message: "Only admin can change verification",
    });
    return null;
  }
  return { userId: adminId, email: user.email, role: user.role };
}

/** PUT /admin/verification/doctor/:doctorProfileId/extend */
export const extendVerificationController = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const админ = await администратор(req, res);
    if (!админ) {
      await session.abortTransaction();
      session.endSession();
      return undefined;
    }

    const { until, reason } = req.body;
    const доКогда = дата(until);

    if (!доКогда) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Нужна дата, до которой продлевается допуск",
      });
    }

    if (!String(reason || "").trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        code: "REASON_REQUIRED",
        message: "Нужно указать основание продления",
      });
    }

    const сейчас = new Date();
    if (доКогда <= сейчас) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Дата продления должна быть в будущем",
      });
    }

    const предел = new Date(сейчас);
    предел.setDate(предел.getDate() + ПРЕДЕЛ_ПРОДЛЕНИЯ_ДНЕЙ);
    if (доКогда > предел) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Продлить можно не более чем на ${ПРЕДЕЛ_ПРОДЛЕНИЯ_ДНЕЙ} дней`,
      });
    }

    const профиль = await DoctorProfile.findById(
      req.params.doctorProfileId,
    ).session(session);

    if (!профиль) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Doctor profile not found" });
    }

    const былоДо = действуетДо(профиль);
    const былСтатус = профиль.verificationStatus;

    профиль.verificationExtendedUntil = доКогда;
    профиль.verificationExtendedBy = админ.userId;
    профиль.verificationExtendedAt = сейчас;
    профиль.verificationExtensionReason = String(reason).trim().slice(0, 500);
    /* Ступень предупреждений сбрасывается: срок уехал, и письмо «истекает
       через 7 дней» должно уйти заново, когда до НОВОЙ даты останется
       семь дней. */
    профиль.verificationExpiryNoticeStage = null;

    /* Продление возвращает допуск, снятый по сроку. Приостановленный —
       не возвращает: suspended снимает решением, а не датой, и вернуть
       его должен тот, кто приостанавливал. */
    if (профиль.verificationStatus === "expired") {
      профиль.verificationStatus = "approved";
      профиль.isVerified = true;
    }

    await профиль.save({ session });

    await записатьРешение({
      действие: СОБЫТИЯ.ПРОДЛИТЬ,
      администратор: админ,
      профиль,
      сведения: {
        previousStatus: былСтатус,
        newStatus: профиль.verificationStatus,
        previousExpiresAt: былоДо ? былоДо.toISOString() : null,
        extendedUntil: доКогда.toISOString(),
        // Основание — свободный текст администратора. В журнал уходит
        // только его длина: причина может назвать врача по имени, а имя
        // в metadata журнала не кладут.
        reasonLength: String(reason).trim().length,
      },
      контекст: контекстЗапроса(req),
      session,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Допуск продлён",
      verificationStatus: профиль.verificationStatus,
      verificationExpiresAt: профиль.verificationExpiresAt,
      verificationExtendedUntil: профиль.verificationExtendedUntil,
      действуетДо: действуетДо(профиль),
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ extendVerification error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error while extending" });
  }
};

/** PUT /admin/verification/doctor/:doctorProfileId/restore */
export const restoreVerificationController = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const админ = await администратор(req, res);
    if (!админ) {
      await session.abortTransaction();
      session.endSession();
      return undefined;
    }

    const профиль = await DoctorProfile.findById(
      req.params.doctorProfileId,
    ).session(session);

    if (!профиль) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Doctor profile not found" });
    }

    const былСтатус = профиль.verificationStatus;
    if (!["suspended", "expired"].includes(былСтатус)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Восстанавливать можно только приостановленный или истёкший допуск",
      });
    }

    /* Срок считаем заново по документам: за время приостановки врач мог
       подать новую лицензию, а мог и не подать. */
    const { срок, документы, всёСобрано } = await пересчитатьСрок(
      профиль,
      session,
    );

    if (!всёСобрано) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        code: "REQUIRED_DOCUMENTS_MISSING",
        missing: чегоНеХватает(документы),
        message: "Не хватает обязательных документов",
      });
    }

    профиль.verificationStatus = "approved";
    профиль.isVerified = true;
    профиль.verificationReviewedBy = админ.userId;
    профиль.verificationReviewedAt = new Date();
    профиль.verificationReviewComment = String(req.body?.comment || "").slice(
      0,
      500,
    );

    /* Проверяем уже ПОСЛЕ пересчёта: документы могли остаться
       просроченными, и тогда восстановление вернуло бы допуск, который
       страж всё равно не пропустит, — врач получил бы «вы допущены» и
       отказ на первом же рецепте. */
    if (!действуетДо(профиль) || действуетДо(профиль) > new Date()) {
      await профиль.save({ session });
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        code: "DOCUMENTS_EXPIRED",
        expiresAt: срок ? срок.toISOString() : null,
        message:
          "Документы просрочены. Нужен новый документ или продление с основанием.",
      });
    }

    await записатьРешение({
      действие: СОБЫТИЯ.ВОССТАНОВИТЬ,
      администратор: админ,
      профиль,
      сведения: {
        previousStatus: былСтатус,
        newStatus: "approved",
        expiresAt: срок ? срок.toISOString() : null,
      },
      контекст: контекстЗапроса(req),
      session,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Допуск восстановлен",
      verificationStatus: профиль.verificationStatus,
      verificationExpiresAt: профиль.verificationExpiresAt,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ restoreVerification error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error while restoring" });
  }
};

export default { extendVerificationController, restoreVerificationController };
