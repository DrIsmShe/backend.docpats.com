import EventEmitter from "events";
import Notification from "../../../common/models/Notification/notification.js";
import { emitNotification } from "../../../common/realtime/userChannel.js";

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
      }) => {
        try {
          const n = await Notification.create({
            userId: doctorUserId,
            senderId: patientId,
            type: "doctorProfile.commented",
            title: "Новый комментарий к вашему профилю",
            message: `${patientName} оставил комментарий к вашему профилю.`,
            link: `/doctor/profile/comments/${commentId}`,
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
            link: `/article/${articleId}`,
          });

          emitNotification(recipientId, n);
        } catch (err) {
          console.error("❌ Ошибка создания уведомления comment.replied:", err);
        }
      },
    );
  }
}

export const eventBus = new EventBus();
export default eventBus;
