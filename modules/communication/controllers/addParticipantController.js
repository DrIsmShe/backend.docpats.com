import * as communicationService from "../services/communicationService.js";

/**
 * Контроллер: добавление участника в комнату общения
 * --------------------------------------------------
 * • Проверяет авторизацию
 * • Добавляет нового участника
 * • Создаёт уведомление
 * • Отправляет Socket-события в комнату и лично пользователю
 */
export const addParticipantController = async (req, res) => {
  try {
    const currentUserId = req.userId; // кто добавляет
    const { roomId } = req.params;
    const { userId, role = "patient" } = req.body;

    // 🔐 Проверка авторизации
    if (!currentUserId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    // 🧠 Вызов бизнес-логики через сервис
    const result = await communicationService.addParticipant({
      currentUserId,
      roomId,
      userId,
      role,
    });

    // 🧩 Если пользователь уже в комнате
    if (result.already) {
      return res.status(200).json({
        success: true,
        message: "Пользователь уже является участником комнаты",
      });
    }

    // ⚡ Socket.io уведомления
    if (global.io) {
      // Оповещение всей комнаты о новом участнике
      global.io.to(roomId.toString()).emit("participantAdded", {
        roomId,
        participant: result.participant,
      });

      // Личное уведомление приглашённому пользователю
      global.io.to(userId.toString()).emit("invitedToRoom", {
        roomId,
        roomTitle: result.participant?.roomTitle || "Комната общения",
      });
    }

    // 🟢 Ответ клиенту
    res.status(201).json({
      success: true,
      message: "Участник успешно добавлен и уведомлён",
      participant: result.participant,
    });
  } catch (err) {
    console.error("❌ Ошибка addParticipantController:", err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Ошибка при добавлении участника",
    });
  }
};
