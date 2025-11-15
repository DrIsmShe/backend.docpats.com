import * as communicationService from "../services/communicationService.js";
import Notification from "../../../common/models/Notification/notification.js";
import Room from "../../../common/models/Communication/Room.js";

/**
 * Контроллер: отправка сообщения (текст / файл / медиа / AI-обработанное)
 * -----------------------------------------------------------------------
 * • Проверяет авторизацию
 * • Делегирует создание сервису communicationService
 * • Отправляет Socket.io события всем участникам комнаты
 * • Создаёт уведомления получателям
 * • При необходимости — отправляет задачу на AI-анализ
 */
export const sendMessageController = async (req, res) => {
  try {
    const senderId = req.userId;
    const { roomId, type = "text", content, fileUrl, replyTo } = req.body;

    // 🔐 Проверка авторизации
    if (!senderId)
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });

    // 🧠 1️⃣ Создаём сообщение через сервис
    const { message } = await communicationService.sendMessage({
      senderId,
      roomId,
      type,
      content,
      fileUrl,
      replyTo,
    });

    // 🏠 2️⃣ Получаем данные комнаты (для уведомлений и AI)
    const room = await Room.findById(roomId)
      .select("title doctorIds patientId participantsSummary type")
      .lean();

    // ⚡ 3️⃣ Socket.io: уведомляем всех участников комнаты
    if (global.io) {
      global.io.to(roomId.toString()).emit("newMessage", {
        roomId,
        message,
      });

      // Отправляем "readiness" для AI аналитики (обновление UI)
      global.io.to(roomId.toString()).emit("roomUpdated", {
        roomId,
        lastMessage: {
          type: message.type,
          content: message.content?.slice(0, 100),
          createdAt: message.createdAt,
        },
      });

      // Отдельное событие для получателя (возможно push)
      global.io.to(message.senderId._id.toString()).emit("messageSent", {
        success: true,
        roomId,
        messageId: message._id,
      });
    }

    // 🔔 4️⃣ Уведомления для других участников (не отправителю)
    const recipients =
      room?.participantsSummary?.filter(
        (p) => p.userId.toString() !== senderId.toString()
      ) || [];

    if (recipients.length > 0) {
      const notifications = recipients.map((p) => ({
        userId: p.userId,
        senderId,
        type: "communication.newMessage",
        title: room.title || "Новое сообщение в чате",
        message:
          message.type === "text"
            ? `${message.content?.slice(0, 80) || "Новое сообщение"}`
            : "Получен новый файл или медиа-сообщение",
        link: `/chat/${roomId}`,
        icon: message.type === "file" ? "paperclip" : "message-circle",
        priority: "normal",
      }));

      await Notification.insertMany(notifications);
    }

    // 🧩 5️⃣ Отправка задачи на AI-анализ сообщений (не блокирует ответ)
    if (global.aiQueue && message.type === "text") {
      global.aiQueue.add("analyzeMessage", {
        roomId,
        messageId: message._id,
        text: message.content,
        senderId,
      });
    }

    // 🟢 6️⃣ Успешный ответ клиенту
    res.status(201).json({
      success: true,
      message: "Сообщение успешно отправлено",
      data: message,
    });
  } catch (err) {
    console.error("❌ Ошибка sendMessageController:", err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Ошибка при отправке сообщения",
    });
  }
};
