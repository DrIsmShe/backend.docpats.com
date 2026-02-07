import * as communicationService from "../services/communicationService.js";

/**
 * Контроллер: добавление участника в комнату общения
 * --------------------------------------------------
 * • Проверяет авторизацию
 * • Добавляет нового участника
 * • Возвращает результат
 */
export const addParticipantController = async (req, res) => {
  try {
    const currentUserId = req.userId;
    const { roomId } = req.params;
    const { userId, role = "patient" } = req.body;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: "Неавторизованный доступ",
      });
    }

    const result = await communicationService.addParticipant({
      currentUserId,
      roomId,
      userId,
      role,
    });

    if (result.already) {
      return res.status(200).json({
        success: true,
        message: "Пользователь уже является участником комнаты",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Участник успешно добавлен",
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
