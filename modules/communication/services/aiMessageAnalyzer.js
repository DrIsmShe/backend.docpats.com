import OpenAI from "openai";
import RoomAnalytics from "../../../common/models/Communication/RoomAnalytics.js";
import Notification from "../../../common/models/Notification/notification.js";
import Participant from "../../../common/models/Communication/Participant.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 🧠 Анализ сообщения ИИ для медицинского чата
 * ------------------------------------------------
 * • Определяет тональность, темы, ключевые слова и краткое резюме
 * • Сохраняет результат в RoomAnalytics
 * • При тревожном тоне уведомляет врачей комнаты
 */
export const analyzeMessageAI = async (roomId, text, senderId = null) => {
  try {
    const prompt = `
      Ты — медицинский ассистент, анализирующий общение пациента и врача.
      Проанализируй следующее сообщение и верни строго JSON без комментариев:
      {
        "tone": "positive|neutral|negative|urgent",
        "keywords": ["..."],
        "topics": ["..."],
        "summary": "..."
      }

      Пример: если пациент говорит "мне больно дышать", 
      tone = "urgent", keywords = ["боль", "дыхание"], topics = ["дыхательная система"].
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    // 🧩 Безопасный парсинг JSON
    let analysis = null;
    try {
      analysis = JSON.parse(response.choices[0]?.message?.content || "{}");
    } catch {
      console.warn(
        "⚠️ AI ответ не JSON. Контент:",
        response.choices[0]?.message?.content
      );
      analysis = { tone: "neutral", keywords: [], topics: [], summary: "" };
    }

    // 📊 Обновляем аналитику комнаты
    await RoomAnalytics.updateOne(
      { roomId },
      {
        $inc: { totalMessages: 1 },
        $addToSet: {
          topKeywords: { $each: analysis.keywords || [] },
          topicsDetected: { $each: analysis.topics || [] },
        },
        $set: {
          "aiInsights.lastTone": analysis.tone,
          lastAnalyzedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // ⚠️ Уведомляем врачей при тревожных сигналах
    if (analysis.tone === "urgent" || analysis.keywords?.includes("боль")) {
      const doctorReceivers = await Participant.find({
        roomId,
        role: "doctor",
      });

      for (const doc of doctorReceivers) {
        await Notification.create({
          userId: doc.userId,
          senderId,
          type: "communication.ai.alert",
          title: "⚠️ Пациент сообщил о боли или тревоге",
          message: "ИИ обнаружил тревожный сигнал в сообщении пациента.",
          link: `/communication/room/${roomId}`,
          isRead: false,
          priority: "high",
        });

        // 🚨 Отправляем моментальный Socket-сигнал врачу
        if (global.io) {
          global.io.to(doc.userId.toString()).emit("aiAlert", {
            roomId,
            analysis,
          });
        }
      }
    }

    return analysis;
  } catch (err) {
    console.error("❌ Ошибка AI анализа:", err.message);
    return null;
  }
};
