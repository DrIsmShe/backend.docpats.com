import EventEmitter from "events";
import Notification from "../../../common/models/Notification/notification.js";
import { emitNotification } from "../../../common/realtime/userChannel.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

// Все обработчики ниже раньше слали realtime через `if (global.io)`. Эта
// переменная нигде не присваивалась, поэтому ни одно из этих уведомлений в
// открытую вкладку не попадало — только в БД, до следующей перезагрузки.
// Теперь адрес один: /communication + комната user:<id> (см.
// common/realtime/userChannel.js).

class EventBus extends EventEmitter {
  constructor() {
    super();

    /* 🟢 Пациент записался — уведомляем врача */
    this.on(
      "appointment.booked",
      async ({ doctorId, patientId, startsAt, appointmentId }) => {
        try {
          const n = await Notification.create({
            userId: doctorId,
            type: "appointment_booked",
            title: "Новая запись пациента",
            message: `Пациент записался на приём: ${new Date(
              startsAt,
            ).toLocaleString("ru-RU")}`,
            link: `/doctor/appointments/${appointmentId}`,
            i18n: {
              title: "app.notify.patientBooked.title",
              message: "app.notify.patientBooked.message",
              params: { when: new Date(startsAt).toISOString() },
            },
          });

          emitNotification(doctorId, n);
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.booked:",
            err,
          );
        }
      },
    );

    /* 🟠 Пациент отменил запись — уведомляем врача */
    this.on(
      "appointment.cancelled",
      async ({ doctorId, patientName, appointmentId }) => {
        try {
          const n = await Notification.create({
            userId: doctorId,
            type: "appointment_cancelled",
            title: "Приём отменён",
            message: `${patientName} отменил запись.`,
            i18n: {
              title: "app.notify.appointmentCancelled.title",
              message: "app.notify.cancelledByPatient.message",
              params: { patientName },
            },
            link: `/doctor/doctor-appointment`,
          });

          emitNotification(doctorId, n);
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.cancelled:",
            err,
          );
        }
      },
    );

    /* 🟣 Комментарий к статье — уведомляем автора */
    this.on(
      "article.commented",
      async ({ authorId, commenterName, articleId, articleTitle }) => {
        try {
          const n = await Notification.create({
            userId: authorId,
            type: "comment",
            title: "Новый комментарий к вашей статье",
            message: `${commenterName} оставил комментарий к статье «${articleTitle}»`,
            i18n: {
              title: "app.notify.articleComment.title",
              message: "app.notify.articleComment.message",
              params: { commenterName, articleTitle },
            },
            link: `/doctor/article-detail/${articleId}`,
          });

          emitNotification(authorId, n);
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления article.commented:",
            err,
          );
        }
      },
    );

    /* 💬 Комментарий к профилю врача — уведомляем врача */
    this.on(
      "doctorProfile.commented",
      async ({
        doctorUserId,
        patientId,
        patientName,
        doctorName,
        commentId,
        articleId,
        articleTitle,
        doctorProfileId,
      }) => {
        try {
          // Прежний адрес /doctor/profile/comments/:id не соответствовал ни
          // одному маршруту — переход по уведомлению давал 404.
          //
          // Ведём туда, где комментарий действительно виден: к статье, если
          // комментировали её, иначе на публичную страницу врача. Профиль
          // ищем по userId, только когда его не передали: событие приходит из
          // двух мест, и не в каждом он под рукой.
          let link = null;
          if (articleId) {
            link = `/public/doctor-profile/article-detail-for-all/${articleId}`;
          } else {
            let profileId = doctorProfileId || null;
            if (!profileId) {
              const profile = await ProfileDoctor.findOne({
                userId: doctorUserId,
              })
                .select("_id")
                .lean();
              profileId = profile?._id ? String(profile._id) : null;
            }
            link = profileId
              ? `/public/doctor-profile/doctor-details/${profileId}`
              : null;
          }

          // Текст по типу цели. Событие приходит и с комментарием к профилю
          // врача, и с комментарием к его статье; раньше во втором случае
          // человеку всё равно сообщали «комментарий к вашему профилю», и
          // найти этот комментарий по такому описанию было негде.
          const title = articleId
            ? "Новый комментарий к вашей статье"
            : "Новый комментарий к вашему профилю";
          const message = articleId
            ? `${patientName} оставил комментарий к статье${
                articleTitle ? ` «${articleTitle}»` : ""
              }.`
            : `${patientName} оставил комментарий к вашему профилю.`;

          const n = await Notification.create({
            userId: doctorUserId,
            senderId: patientId,
            type: "doctorProfile.commented",
            title,
            message,
            // Без адреса уведомление остаётся некликабельным — это лучше, чем
            // ссылка в 404: NotificationBell переходит только при наличии link.
            link,
          });

          emitNotification(doctorUserId, n);
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления doctorProfile.commented:",
            err,
          );
        }
      },
    );

    /* 🟢 Доктор подтвердил приём — уведомляем пациента */
    this.on(
      "appointment.confirmed",
      async ({ patientId, doctorName, startsAt, appointmentId }) => {
        try {
          const n = await Notification.create({
            userId: patientId,
            type: "appointment_confirmed",
            title: "Приём подтверждён",
            i18n: {
              title: "app.notify.appointmentConfirmed.title",
              message: "app.notify.appointmentConfirmed.message",
              params: { doctorName, when: new Date(startsAt).toISOString() },
            },
            message: `Доктор ${doctorName} подтвердил ваш приём на ${new Date(
              startsAt,
            ).toLocaleString("ru-RU")}`,
            link: `/patient/my-appointment/${appointmentId}`,
          });

          emitNotification(patientId, n);
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.confirmed:",
            err,
          );
        }
      },
    );

    /* 🔴 Доктор отменил приём — уведомляем пациента */
    this.on(
      "appointment.cancelled.byDoctor",
      async ({ patientId, doctorName, appointmentId }) => {
        try {
          const n = await Notification.create({
            userId: patientId,
            // Было "appointment_cancelled_by_doctor" — такого значения нет в
            // enum модели, поэтому create падал с ValidationError, ошибку
            // съедал catch, и пациент об отмене не узнавал вовсе.
            // Кто отменил, видно из текста.
            type: "appointment_cancelled",
            title: "Приём отменён",
            message: `Доктор ${doctorName} отменил ваш приём.`,
            i18n: {
              title: "app.notify.appointmentCancelled.title",
              message: "app.notify.cancelledByDoctorShort.message",
              params: { doctorName },
            },
            link: `/patient/my-appointment`,
          });

          emitNotification(patientId, n);
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.cancelled.byDoctor:",
            err,
          );
        }
      },
    );

    /* 💬 Новое сообщение в чате — уведомляем получателя */
    this.on(
      "chat.message",
      async ({ recipientId, senderId, senderName, preview, dialogId }) => {
        try {
          // Не создаём DB-запись — колокольчик уже получил событие из
          // message.routes.js (он шлёт его в тот же личный канал напрямую).
          // Запись нужна только если хотим показывать в /doctor/notifications
        } catch (err) {
          console.error("❌ Ошибка chat.message eventBus:", err);
        }
      },
    );

    /* 🔵 Ответ на комментарий */
    this.on(
      "comment.replied",
      async ({ recipientId, replierName, articleId }) => {
        try {
          const n = await Notification.create({
            userId: recipientId,
            type: "comment_reply",
            title: "Ответ на ваш комментарий",
            message: `${replierName} ответил на ваш комментарий`,
            i18n: {
              title: "app.notify.commentReply.title",
              message: "app.notify.commentReply.message",
              params: { replierName },
            },
            link: `/article/${articleId}`,
          });

          emitNotification(recipientId, n);
        } catch (err) {
          console.error("❌ Ошибка создания уведомления comment.replied:", err);
        }
      },
    );

    /* 🔔 Системное сообщение — общий случай.
     *
     * Обработчика на это событие не было вовсе, а испускалось оно дважды:
     * при завершении приёма и следом — с просьбой оценить врача. Оба
     * уведомления не создавались никогда. Второе описано в коде как петля
     * роста «сарафанного радио» — она не работала с тех пор, как была
     * написана: emit без слушателя молчит, ошибки не бывает.
     */
    this.on(
      "system.message",
      async ({ userId, title, message, link = null, i18n = null }) => {
        try {
          const n = await Notification.create({
            userId,
            type: "system_message",
            title,
            message,
            link,
            ...(i18n ? { i18n } : {}),
          });
          emitNotification(userId, n);
        } catch (err) {
          console.error("❌ Ошибка создания уведомления system.message:", err);
        }
      },
    );
  }
}

export const eventBus = new EventBus();
export default eventBus;
