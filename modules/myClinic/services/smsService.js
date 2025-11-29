import axios from "axios";
import "dotenv/config";

// Загружаем API-ключ и URL из переменных окружения
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY;
const INFOBIP_BASE_URL = process.env.INFOBIP_BASE_URL;

if (!INFOBIP_API_KEY || !INFOBIP_BASE_URL) {
  console.error("❌ Ошибка: отсутствует API-ключ или базовый URL для Infobip.");
  process.exit(1); // Завершаем процесс, чтобы не запускать сервер с ошибками
}

export const sendSMS = async (to, message) => {
  try {
    const response = await axios.post(
      `${INFOBIP_BASE_URL}/sms/2/text/single`, // Endpoint для отправки SMS
      {
        from: "etrafliinformasiya", // Имя отправителя (должно быть одобрено Infobip)
        to: [to], // Infobip ожидает массив номеров
        text: message,
      },
      {
        headers: {
          Authorization: `App ${INFOBIP_API_KEY}`, // API-ключ
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ SMS успешно отправлено:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Ошибка при отправке SMS через Infobip:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Не удалось отправить SMS");
  }
};
