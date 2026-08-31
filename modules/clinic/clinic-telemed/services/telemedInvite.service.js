// server/modules/clinic/clinic-telemed/services/telemedInvite.service.js
//
// Позвать пациента на видеоприём.
//
// ЗАЧЕМ. Модуль телемедицины не уведомлял пациента ВООБЩЕ: клиника
// назначала видеоприём, а человек об этом не узнавал никак — ни ссылки,
// ни письма. Замысел проекта (видеоприём положен только
// зарегистрированным, и это причина завести аккаунт) не мог сработать
// просто потому, что о приёме никто не сообщал.
//
// ДВА СЛУЧАЯ, И ОНИ РАЗНЫЕ.
//
// Пациент с аккаунтом — уведомление в кабинет. Он уже внутри, ему нужен
// только повод открыть нужную страницу.
//
// Пациента ещё нет — письмо на адрес из карты. Оно и есть тот самый
// стимул: человек регистрируется этой же почтой, карта подцепляется сама
// (clinic-patients/services/linkOnSignup), и приём открывается сразу
// после подтверждения. Без этого письма цепочка не начинается.
//
// ЧЕГО В ПИСЬМЕ НЕТ И НЕ ДОЛЖНО БЫТЬ. Названия приёма. Адрес не
// подтверждён — почту в карту вписал регистратор, и мы не знаем, дошла
// ли она до того человека. Название бывает клиническим («консультация
// онколога»), и отправлять его на непроверенный адрес — раскрывать
// диагноз постороннему. В письме только название клиники, время и
// приглашение: этого хватает, чтобы прийти, и не хватает, чтобы узнать
// о человеке лишнее.

import ClinicPatient from "../../clinic-patients/models/clinicPatient.model.js";
import { notify } from "../../../notifications/services/notification.service.js";
import { sendEmail, escapeHtml } from "../../../../common/services/emailService.js";
import { decryptPHI } from "../../../../common/utils/phiCrypto.js";
import { t } from "../../../../common/i18n/index.js";
import logger from "../../../../common/logger.js";

const LOCALES = { ru: "ru-RU", en: "en-GB", az: "az-AZ", tr: "tr-TR", ar: "ar-EG" };

/** Карта пациента: кому писать и на какой адрес. */
async function resolveRecipient(session) {
  if (session.patientUserId) {
    return { userId: session.patientUserId, email: null };
  }
  if (!session.patientId) return { userId: null, email: null };

  // skipTenantScope: карта уже названа самой сессией этой клиники —
  // выборка сужена до одного _id, шире ничего не видно.
  const card = await ClinicPatient.findOne({ _id: session.patientId })
    .select("linkedUserId emailEncrypted")
    .setOptions({ skipTenantScope: true })
    .lean();
  if (!card) return { userId: null, email: null };

  if (card.linkedUserId) return { userId: card.linkedUserId, email: null };
  return { userId: null, email: decryptPHI(card.emailEncrypted) || null };
}

async function clinicInfo(clinicId) {
  try {
    const Clinic = (await import("../../clinic-core/models/clinic.model.js"))
      .default;
    const c = await Clinic.findById(clinicId)
      .select("name defaultLanguage")
      .lean();
    return { name: c?.name || null, lang: c?.defaultLanguage || "ru" };
  } catch {
    return { name: null, lang: "ru" };
  }
}

/**
 * Позвать пациента на назначенный видеоприём.
 *
 * Никогда не бросает: приём уже создан, и несостоявшееся приглашение —
 * не повод отменять его задним числом.
 *
 * @param {object} session  созданная сессия телемедицины
 * @returns {Promise<{via: "app"|"email"|"none"}>}
 */
export async function inviteToTelemedSession(session) {
  try {
    if (!session?.clinicId || !session?.scheduledAt) return { via: "none" };

    const { userId, email } = await resolveRecipient(session);
    if (!userId && !email) return { via: "none" };

    const { name: clinicName, lang } = await clinicInfo(session.clinicId);
    const whenIso = new Date(session.scheduledAt).toISOString();

    if (userId) {
      await notify({
        userId,
        type: "system_message",
        title: "Назначен видеоприём",
        message: clinicName
          ? `Клиника «${clinicName}» назначила вам видеоприём.`
          : "Вам назначен видеоприём.",
        i18n: {
          title: "app.notify.telemedScheduled.title",
          message: clinicName
            ? "app.notify.telemedScheduled.messageWithClinic"
            : "app.notify.telemedScheduled.message",
          params: { clinicName: clinicName || "", when: whenIso },
        },
        link: "/patient/telemed",
        icon: "camera-video",
        priority: "high",
        meta: { telemedSessionId: String(session._id) },
      });
      return { via: "app" };
    }

    // ─── Письмо тому, у кого ещё нет аккаунта ───
    const when = new Date(session.scheduledAt).toLocaleString(
      LOCALES[lang] || LOCALES.ru,
      { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" },
    );
    const p = { clinicName: clinicName || "", when };
    const subject = t("app.mail.telemedInvite.subject", lang, p);
    const site = process.env.CLIENT_URL || "https://docpats.com";

    const body = [
      `<p>${escapeHtml(t("app.mail.telemedInvite.greeting", lang, p))}</p>`,
      `<p><b>${escapeHtml(when)}</b></p>`,
      `<p>${escapeHtml(t("app.mail.telemedInvite.howto", lang, p))}</p>`,
      `<p><a href="${site}/registration" style="display:inline-block;padding:12px 22px;` +
        `background:#4f8bff;color:#fff;border-radius:8px;text-decoration:none">` +
        `${escapeHtml(t("app.mail.telemedInvite.cta", lang, p))}</a></p>`,
      `<p style="color:#888;font-size:12px">${escapeHtml(
        t("app.mail.telemedInvite.footer", lang, p),
      )}</p>`,
    ].join("");

    await sendEmail(email, subject, body);
    return { via: "email" };
  } catch (err) {
    logger?.warn?.(
      { err: err?.message, sessionId: String(session?._id || "") },
      "telemed invite failed",
    );
    return { via: "none" };
  }
}

export default { inviteToTelemedSession };
