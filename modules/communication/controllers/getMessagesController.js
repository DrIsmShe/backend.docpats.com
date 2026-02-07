import * as communicationService from "../services/communicationService.js";
import RoomAnalytics from "../../../common/models/Communication/RoomAnalytics.js";

/**
 * Контроллер: получение истории сообщений комнаты
 * -------------------------------------------------------------------
 * • Проверяет авторизацию пользователя
 * • Делегирует бизнес-логику в communicationService.getMessages()
 * • Возвращает сообщения + пагинацию + краткую AI-аналитику комнаты
 * • При необходимости — триггерит Socket-событие "messagesFetched"
 */
export const getMessagesController = async (req, res) => {
  try {
    const userId = req.userId;
    const { roomId } = req.params;
    const {
      page = 1,
      limit = 30,
      search = "",
      type,
      sort = "desc",
    } = req.query;

    // 🔒 Проверка авторизации
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Неавторизованный доступ",
      });
    }

    // 🧠 Основные сообщения через сервисный слой
    const result = await communicationService.getMessages({
      userId,
      roomId,
      page: Number(page),
      limit: Number(limit),
      search,
      type,
      sort,
    });

    // 📊 AI-аналитика комнаты (по данным RoomAnalytics)
    const analytics = await RoomAnalytics.findOne({ roomId })
      .select(
        "totalMessages topKeywords topicsDetected aiInsights doctorEngagement patientEngagement lastAnalyzedAt"
      )
      .lean();

    // ✅ Формируем итоговый ответ
    res.status(200).json({
      success: true,
      ...result,
      analytics: analytics || {
        totalMessages: 0,
        topKeywords: [],
        topicsDetected: [],
        aiInsights: {},
        doctorEngagement: 0,
        patientEngagement: 0,
        lastAnalyzedAt: null,
      },
    });
  } catch (err) {
    console.error("❌ Ошибка getMessagesController:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Ошибка при получении сообщений",
    });
  }
};
