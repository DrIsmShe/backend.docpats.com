import axios from "axios";

// Отправка почты через Brevo.
//
// Три вещи здесь сделаны намеренно и ломать их не надо:
//
// 1. КАЖДОМУ ОТДЕЛЬНОЕ ПИСЬМО. Раньше массив адресов уходил одним запросом
//    в поле `to`, и все получатели видели адреса друг друга в шапке письма.
//    Пока функцию звали по одному адресу за раз, это спало; первая же
//    массовая рассылка разослала бы базу email врачей всей базе врачей.
//
// 2. ЭКРАНИРОВАНИЕ. `htmlContent` собирается подстановкой, а тексты писем
//    теперь содержат данные с внешних сайтов (названия конференций,
//    организаторы), то есть недоверенный ввод. Без экранирования кавычка
//    ломает вёрстку, а подставленная ссылка превращает письмо от имени
//    DocPats в фишинг.
//
// 3. ОТПИСКА В ЗАГОЛОВКАХ. Gmail и Yahoo с 2024 года требуют от массовых
//    отправителей отписку в один клик. Без неё вместо отписок приходят
//    жалобы на спам, а они бьют по доставляемости ВСЕХ писем домена —
//    включая напоминания о приёмах.

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(message) {
  return escapeHtml(message).replace(/\r?\n/g, "<br>");
}

async function sendOne({ apiKey, sender, email, subject, message, html, unsubscribeUrl }) {
  const payload = {
    sender,
    to: [{ email }],
    subject,
    textContent: unsubscribeUrl
      ? `${message}\n\n—\nОтписаться: ${unsubscribeUrl}`
      : message,
    htmlContent: html
      ? html
      : `<p>${textToHtml(message)}</p>` +
        (unsubscribeUrl
          ? `<p style="color:#888;font-size:12px">` +
            `<a href="${escapeHtml(unsubscribeUrl)}">Отписаться от этой рассылки</a></p>`
          : ""),
  };

  if (unsubscribeUrl) {
    // List-Unsubscribe-Post — та самая «отписка в один клик»: почтовый
    // клиент дёргает URL сам, не заставляя человека открывать страницу.
    payload.headers = {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  const response = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
    headers: { "Content-Type": "application/json", "api-key": apiKey },
  });
  return response.data;
}

/**
 * @param {string|string[]} emails
 * @param {string} subject
 * @param {string} message                     простой текст
 * @param {object} [options]
 * @param {string} [options.unsubscribeUrl]    обязателен для любой рассылки,
 *                                             которую человек не запрашивал
 * @param {string} [options.html]              готовый HTML вместо сборки из текста;
 *                                             экранирование тогда на вызывающем
 * @returns {Promise<boolean>} true — доставлено всем адресатам
 */
export const sendEmail = async (emails, subject, message, options = {}) => {
  const recipients = (Array.isArray(emails) ? emails : [emails]).filter(Boolean);
  if (!recipients.length) return false;

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("❌ BREVO_API_KEY is missing");
    return false;
  }

  const sender = {
    email: process.env.EMAIL_FROM || "no-reply@docpats.com",
    name: process.env.EMAIL_FROM_NAME || "DOCPATS",
  };

  let sent = 0;
  for (const email of recipients) {
    try {
      console.log("📨 Sending email to:", email);
      await sendOne({ apiKey, sender, email, subject, message, ...options });
      sent += 1;
    } catch (error) {
      // Один плохой адрес не должен ронять всю рассылку.
      console.error("❌ Brevo error for", email, ":", error.response?.data || error.message);
    }
  }

  return sent === recipients.length;
};

export { escapeHtml };
