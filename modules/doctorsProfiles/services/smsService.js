import axios from "axios";
import "dotenv/config";

// Загружаем API-ключ и URL из переменных окружения
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY;
const INFOBIP_BASE_URL = process.env.INFOBIP_BASE_URL;

if (!INFOBIP_API_KEY || !INFOBIP_BASE_URL) {
  console.error("❌ Error: API key or base URL for Infobip is missing.");
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

    console.log("✅ SMS successfully sent:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error sending SMS via Infobip:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to send SMS");
  }
};
