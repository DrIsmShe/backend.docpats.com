import EventEmitter from "events";
import Notification from "../../../common/models/Notification/notification.js";

class EventBus extends EventEmitter {
  constructor() {
    super();

    /* 🟢 Пациент записался — уведомляем врача */
    this.on(
      "appointment.booked",
      async ({ doctorId, patientId, startsAt, appointmentId }) => {
        try {
          await Notification.create({
            userId: doctorId,
            type: "appointment_booked",
            title: "Новая запись пациента",
            message: `Пациент записался на приём: ${new Date(
              startsAt
            ).toLocaleString("ru-RU")}`,
            link: `/doctor/appointments/${appointmentId}`,
          });

          if (global.io) {
            global.io.to(doctorId.toString()).emit("new_notification", {
              title: "Новая запись пациента",
              message: "Проверьте своё расписание",
              link: `/doctor/appointments/${appointmentId}`,
            });
          }
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.booked:",
            err
          );
        }
      }
    );

    /* 🟠 Пациент отменил запись — уведомляем врача */
    this.on(
      "appointment.cancelled",
      async ({ doctorId, patientName, appointmentId }) => {
        try {
          await Notification.create({
            userId: doctorId,
            type: "appointment_cancelled",
            title: "Приём отменён",
            message: `${patientName} отменил запись.`,
            link: `/doctor/doctor-appointment`,
          });

          if (global.io) {
            global.io.to(doctorId.toString()).emit("new_notification", {
              title: "Приём отменён",
              message: `${patientName} отменил свою запись.`,
              link: `/doctor/doctor-appointment`,
            });
          }
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.cancelled:",
            err
          );
        }
      }
    );

    /* 🟣 Комментарий к статье — уведомляем автора */
    this.on(
      "article.commented",
      async ({ authorId, commenterName, articleId, articleTitle }) => {
        try {
          await Notification.create({
            userId: authorId,
            type: "comment",
            title: "Новый комментарий к вашей статье",
            message: `${commenterName} оставил комментарий к статье «${articleTitle}»`,
            link: `/doctor/article-detail/${articleId}`,
          });

          if (global.io) {
            global.io.to(authorId.toString()).emit("new_notification", {
              title: "Новый комментарий к статье",
              message: `${commenterName} оставил комментарий к статье «${articleTitle}»`,
              link: `/doctor/article-detail/${articleId}`,
            });
          }
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления article.commented:",
            err
          );
        }
      }
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
          // Создаём уведомление
          await Notification.create({
            userId: doctorUserId,
            senderId: patientId,
            type: "doctorProfile.commented",
            title: "Новый комментарий к вашему профилю",
            message: `${patientName} оставил комментарий к вашему профилю.`,
            link: `/doctor/profile/comments/${commentId}`,
          });

          // Если сокет активен — отправляем уведомление в реальном времени
          if (global.io) {
            global.io.to(doctorUserId.toString()).emit("new_notification", {
              title: "Комментарий к профилю",
              message: `${patientName} оставил комментарий к вашему профилю.`,
              link: `/doctor/profile/comments/${commentId}`,
            });
          }

          console.log(
            "✅ Уведомление doctorProfile.commented отправлено врачу:",
            doctorUserId
          );
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления doctorProfile.commented:",
            err
          );
        }
      }
    );

    /* 🟢 Доктор подтвердил приём — уведомляем пациента */
    this.on(
      "appointment.confirmed",
      async ({ patientId, doctorName, startsAt, appointmentId }) => {
        try {
          await Notification.create({
            userId: patientId,
            type: "appointment_confirmed",
            title: "Приём подтверждён",
            message: `Доктор ${doctorName} подтвердил ваш приём на ${new Date(
              startsAt
            ).toLocaleString("ru-RU")}`,
            link: `/patient/my-appointment/${appointmentId}`,
          });

          if (global.io) {
            global.io.to(patientId.toString()).emit("new_notification", {
              title: "Приём подтверждён",
              message: `Доктор ${doctorName} подтвердил ваш приём`,
              link: `/patient/my-appointment`,
            });
          }
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.confirmed:",
            err
          );
        }
      }
    );

    /* 🔴 Доктор отменил приём — уведомляем пациента */
    this.on(
      "appointment.cancelled.byDoctor",
      async ({ patientId, doctorName, appointmentId }) => {
        try {
          await Notification.create({
            userId: patientId,
            type: "appointment_cancelled_by_doctor",
            title: "Приём отменён",
            message: `Доктор ${doctorName} отменил ваш приём.`,
            link: `/patient/my-appointment`,
          });

          if (global.io) {
            global.io.to(patientId.toString()).emit("new_notification", {
              title: "Приём отменён доктором",
              message: `Доктор ${doctorName} отменил ваш приём`,
              link: `/patient/my-appointment/${appointmentId}`,
            });
          }
        } catch (err) {
          console.error(
            "❌ Ошибка создания уведомления appointment.cancelled.byDoctor:",
            err
          );
        }
      }
    );

    /* 🔵 Ответ на комментарий */
    this.on(
      "comment.replied",
      async ({ recipientId, replierName, articleId }) => {
        try {
          await Notification.create({
            userId: recipientId,
            type: "comment_reply",
            title: "Ответ на ваш комментарий",
            message: `${replierName} ответил на ваш комментарий`,
            link: `/article/${articleId}`,
          });

          if (global.io) {
            global.io.to(recipientId.toString()).emit("new_notification", {
              title: "Ответ на комментарий",
              message: `${replierName} ответил на ваш комментарий`,
              link: `/article/${articleId}`,
            });
          }
        } catch (err) {
          console.error("❌ Ошибка создания уведомления comment.replied:", err);
        }
      }
    );
  }
}

export const eventBus = new EventBus();
export default eventBus;
