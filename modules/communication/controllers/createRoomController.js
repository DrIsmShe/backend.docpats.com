import * as communicationService from "../services/communicationService.js";

/**
 * Контроллер: создание комнаты общения (чат / консультация / консилиум)
 * ---------------------------------------------------------------------
 * • Проверяет авторизацию
 * • Создаёт комнату и участников через сервис
 * • Отправляет уведомления (через сервис)
 * • Рассылает события через Socket.io
 */
export const createRoomController = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;

    // 🔐 Проверка авторизации
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    // 🧠 Вызов сервисного метода
    const result = await communicationService.createRoom({
      userId,
      userRole,
      ...req.body,
    });

    // 🟡 Если комната уже существует
    if (result.existing) {
      return res.status(200).json({
        success: true,
        message: "Комната уже существует",
        room: result.room,
      });
    }

    // ⚡ Отправляем Socket.io уведомления
    if (global.io) {
      // 1️⃣ Уведомляем участников комнаты
      for (const participant of result.participants) {
        if (participant.userId.toString() !== userId.toString()) {
          global.io.to(participant.userId.toString()).emit("roomCreated", {
            roomId: result.room._id,
            title: result.room.title,
            type: result.room.type,
          });
        }
      }

      // 2️⃣ Отправляем событие создателю (обновление списка комнат)
      global.io.to(userId.toString()).emit("roomCreatedByUser", {
        roomId: result.room._id,
        title: result.room.title,
      });
    }

    // 🟢 Успешный ответ клиенту
    res.status(201).json({
      success: true,
      message: "Комната создана, участники уведомлены",
      room: result.room,
    });
  } catch (err) {
    console.error("❌ Ошибка createRoomController:", err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Ошибка при создании комнаты",
    });
  }
};
