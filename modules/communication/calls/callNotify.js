// server/modules/communication/calls/callNotify.js
//
// Уведомления о звонке ЗА ПРЕДЕЛАМИ открытой вкладки.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ПОЯВИЛСЯ. Сигнализация звонка (call.gateway.js) умела
// ровно одно: отправить call:incoming в личную комнату сокета. Человек с
// закрытой вкладкой не узнавал о вызове ничего и никогда — ни в момент
// звонка, ни после: в колокольчике пропущенного не появлялось, пуш не
// уходил, а звонящий 45 секунд слушал гудки в пустоту. Для платформы, где
// звонок — это приём у врача, это не мелкий пробел, а отсутствующий канал.
//
// ДВА РАЗНЫХ СОБЫТИЯ, ДВА РАЗНЫХ КАНАЛА:
//
//   входящий звонок  → только web-push, без записи в колокольчик.
//     Звонок живёт 45 секунд; строка «вам звонят», найденная вечером,
//     бесполезна и только засоряет ленту. Пуш же приходит на телефон
//     сразу, и по нему можно успеть ответить — сигнализация повторяет
//     экран входящего тому, кто подключился, пока вызов ещё идёт
//     (см. call.gateway.js, повтор при connection).
//
//   пропущенный      → колокольчик + пуш (notify).
//     А вот это уже след события, который должен пережить вкладку:
//     человек видит, кто звонил, и может перезвонить сам.
//
// ЧТО МОЖНО ПИСАТЬ В ТЕКСТЕ. Только имя звонящего и факт звонка. Пуш
// проходит через чужой сервис (FCM/APNs) и показывается на заблокированном
// экране — ни жалобы, ни диагноза, ни причины обращения здесь быть не
// может. Тот же принцип, что в jobs/appointmentReminders.job.js.

import User from "../../../common/models/Auth/users.js";
import { sendToUser } from "../../notifications/services/webpush.service.js";
import { notify } from "../../notifications/services/notification.service.js";

// Пять локалей платформы. Строки короткие: их читают с экрана блокировки.
const TEXT = {
  ru: {
    incoming: "Входящий звонок",
    calling: (who) => (who ? `${who} звонит вам.` : "Вам звонят."),
    missed: "Пропущенный звонок",
    missedBody: (who) =>
      who ? `${who} звонил вам, вы не ответили.` : "Вам звонили.",
  },
  en: {
    incoming: "Incoming call",
    calling: (who) => (who ? `${who} is calling you.` : "You have a call."),
    missed: "Missed call",
    missedBody: (who) =>
      who ? `${who} called you, no answer.` : "You had a call.",
  },
  az: {
    incoming: "Gələn zəng",
    calling: (who) => (who ? `${who} sizə zəng edir.` : "Sizə zəng edirlər."),
    missed: "Buraxılmış zəng",
    missedBody: (who) =>
      who ? `${who} zəng etdi, cavab verilmədi.` : "Sizə zəng etmişdilər.",
  },
  tr: {
    incoming: "Gelen arama",
    calling: (who) => (who ? `${who} sizi arıyor.` : "Sizi arıyorlar."),
    missed: "Cevapsız arama",
    missedBody: (who) =>
      who ? `${who} sizi aradı, cevap verilmedi.` : "Sizi aramışlardı.",
  },
  ar: {
    incoming: "مكالمة واردة",
    calling: (who) => (who ? `${who} يتصل بك.` : "لديك مكالمة."),
    missed: "مكالمة فائتة",
    missedBody: (who) =>
      who ? `${who} اتصل بك ولم تردّ.` : "كانت لديك مكالمة.",
  },
};

const dict = (lang) => TEXT[lang] || TEXT.ru;

/**
 * Язык и раздел кабинета получателя.
 *
 * Ссылка обязана вести в ЕГО половину сайта: маршруты чата разные —
 * /doctor/communication/:dialogId и /patient/communication/:dialogId.
 * Промахнуться ролью значит привести человека на чужой экран.
 */
async function recipient(userId) {
  try {
    const u = await User.findById(userId)
      .select("preferredLanguage role")
      .lean();
    return {
      lang: u?.preferredLanguage || "ru",
      section: u?.role === "doctor" ? "doctor" : "patient",
    };
  } catch {
    return { lang: "ru", section: "patient" };
  }
}

const chatLink = (section, dialogId) =>
  dialogId ? `/${section}/communication/${dialogId}` : `/${section}/home-page`;

/**
 * Пуш о ВХОДЯЩЕМ звонке. Зовётся только когда у человека нет живого
 * сокета: у того, кто и так смотрит на экран входящего, пуш поверх окна
 * вызова — шум.
 *
 * Никогда не бросает: звонок не должен падать из-за уведомления.
 */
export async function pushIncomingCall(calleeId, { callerName, dialogId }) {
  try {
    const { lang, section } = await recipient(calleeId);
    const d = dict(lang);
    await sendToUser(calleeId, {
      title: d.incoming,
      body: d.calling(callerName),
      url: chatLink(section, dialogId),
      // Один tag на все звонки: второй вызов заменяет первый в шторке,
      // а не выкладывает рядом стопку одинаковых карточек.
      tag: "call-incoming",
    });
  } catch (err) {
    console.warn("[call] push incoming failed:", err?.message);
  }
}

/**
 * Пропущенный звонок: строка в колокольчике + пуш (внутри notify).
 * Дедупликации намеренно нет — два пропущенных звонка это два события.
 */
export async function notifyMissedCall(calleeId, { callerId, callerName, dialogId }) {
  try {
    const { lang, section } = await recipient(calleeId);
    const d = dict(lang);
    await notify({
      userId: calleeId,
      senderId: callerId || null,
      type: "call_missed",
      title: d.missed,
      message: d.missedBody(callerName),
      link: chatLink(section, dialogId),
      icon: "phone-missed",
      priority: "high",
      meta: { dialogId: dialogId ? String(dialogId) : null },
    });
  } catch (err) {
    console.warn("[call] missed notification failed:", err?.message);
  }
}

export default { pushIncomingCall, notifyMissedCall };
