// server/modules/video/services/patientDelivery.service.js
//
// Доставка задания пациенту: колокольчик и сообщение в чат.
//
// ПОЧЕМУ ДВА КАНАЛА, А НЕ ОДИН. Уведомление в колокольчике человек увидит,
// только если зайдёт в кабинет; сообщение в чате приходит туда, где он уже
// переписывается с врачом, и остаётся в истории — к нему можно вернуться
// через неделю, когда придёт время готовиться. Ни один из каналов по
// отдельности не гарантирует, что задание заметят, а незамеченное задание
// означает отложенную в день приёма процедуру.
//
// ПОЧЕМУ СБОЙ ДОСТАВКИ НЕ ОТМЕНЯЕТ ЗАДАНИЕ. Согласие и план уже созданы и
// видны в кабинете; молчащий канал — это неудобство, а откат созданного
// задания из-за него — потеря работы врача.
//
// ЧАТ ТОЛЬКО ОТ ЧЕЛОВЕКА К ЧЕЛОВЕКУ. Диалог заводится между двумя User; у
// сотрудника клиники (actorType "employee") своего User нет, и писать от
// его имени некому — тогда остаётся колокольчик. Это не потеря: сообщение
// от абстрактной «клиники» в личной переписке всё равно выглядело бы
// странно.

import { notify } from "../../notifications/services/notification.service.js";

/** Ссылка на страницу, где задание можно выполнить. */
const СТРАНИЦА_ЗАДАНИЙ = "/patient/video-tasks";

/**
 * Написать пациенту в личный диалог.
 *
 * Ошибки глушим намеренно — см. заголовок файла. Возвращаем признак, чтобы
 * вызывающий мог записать в журнал, дошло сообщение или нет.
 */
async function вЧат({ fromUserId, toUserId, text }) {
  if (!fromUserId || !toUserId) return false;
  try {
    const { getOrCreatePrivateDialog } = await import(
      "../../communication/dialogs/dialog.service.js"
    );
    const { sendMessage } = await import(
      "../../communication/messages/message.service.js"
    );

    const dialog = await getOrCreatePrivateDialog({
      currentUserId: String(fromUserId),
      peerUserId: String(toUserId),
    });
    const dialogId = dialog?._id || dialog?.dialog?._id || dialog?.id;
    if (!dialogId) return false;

    await sendMessage({
      userId: String(fromUserId),
      dialogId: String(dialogId),
      type: "text",
      text,
    });
    return true;
  } catch (err) {
    console.warn("[video] сообщение в чат не ушло:", err?.message);
    return false;
  }
}

/** Уведомление в колокольчик. Тексты живут в серверных словарях. */
async function вКолокольчик({ userId, type, title, message, i18n, meta }) {
  try {
    await notify({
      userId,
      type,
      title,
      message,
      link: СТРАНИЦА_ЗАДАНИЙ,
      i18n,
      meta,
    });
    return true;
  } catch (err) {
    console.warn("[video] уведомление не ушло:", err?.message);
    return false;
  }
}

/**
 * «Посмотрите объяснение и подтвердите согласие».
 *
 * @returns {Promise<{notified: boolean, chatted: boolean}>}
 */
export async function deliverConsentRequest({ consent, fromUserId, durationSec }) {
  const текст =
    `Перед вмешательством «${consent.procedureName}» посмотрите короткий ролик ` +
    `и подтвердите согласие: ${СТРАНИЦА_ЗАДАНИЙ}`;

  const [notified, chatted] = await Promise.all([
    вКолокольчик({
      userId: consent.patientUserId,
      type: "video_consent_requested",
      title: "Посмотрите объяснение перед процедурой",
      message: `Клиника просит посмотреть короткий ролик о вмешательстве «${consent.procedureName}» и подтвердить согласие.`,
      i18n: {
        title: "app.notification.videoConsent.title",
        message: "app.notification.videoConsent.message",
        params: { procedure: consent.procedureName },
      },
      meta: { consentId: String(consent._id), durationSec },
    }),
    вЧат({ fromUserId, toUserId: consent.patientUserId, text: текст }),
  ]);

  return { notified, chatted };
}

/** «Вам назначена подготовка». */
export async function deliverPlaylistAssignment({ assignment, fromUserId }) {
  const текст =
    `Вам назначена подготовка к процедуре: ${assignment.title}. ` +
    `Ролики и сроки — здесь: ${СТРАНИЦА_ЗАДАНИЙ}`;

  const [notified, chatted] = await Promise.all([
    вКолокольчик({
      userId: assignment.patientUserId,
      type: "video_playlist_assigned",
      title: "Подготовка к процедуре",
      message: `Вам назначена подготовка: ${assignment.title}. Посмотрите короткие ролики к указанным датам.`,
      i18n: {
        title: "app.notification.videoPlaylist.title",
        message: "app.notification.videoPlaylist.message",
        params: { title: assignment.title },
      },
      meta: {
        assignmentId: String(assignment._id),
        steps: assignment.steps?.length || 0,
      },
    }),
    вЧат({ fromUserId, toUserId: assignment.patientUserId, text: текст }),
  ]);

  return { notified, chatted };
}

export default { deliverConsentRequest, deliverPlaylistAssignment };
