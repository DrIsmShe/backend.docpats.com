// common/social/telegram.service.js
//
// Публикация в СОБСТВЕННЫЙ Telegram-канал через официальный Bot API.
//
// Граница здесь принципиальная и проходит не по технологии, а по тому,
// куда отправляется сообщение: свой канал со своими подписчиками — это
// публикация, чужие чаты и группы — рассылка. Второе этот модуль делать
// не умеет: адрес назначения ровно один и берётся из переменной
// окружения, а не из данных.
//
// Настройка:
//   TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
//   TELEGRAM_CHANNEL_ID — @имя_канала или числовой id (бот должен быть
//                         администратором канала)
//
// Нет любой из двух — модуль выключен и молчит.

const API_BASE = "https://api.telegram.org";

export function telegramEnabled() {
  return Boolean(
    (process.env.TELEGRAM_BOT_TOKEN || "").trim() &&
      (process.env.TELEGRAM_CHANNEL_ID || "").trim(),
  );
}

/** Экранирование под parse_mode=HTML — Telegram принимает только эти три. */
export function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Отправить одно сообщение в канал.
 * Возвращает true/false и не бросает: постинг — дело вспомогательное,
 * из-за него не должен падать cron.
 */
export async function sendToChannel(html) {
  if (!telegramEnabled()) return false;

  const token = process.env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = process.env.TELEGRAM_CHANNEL_ID.trim();

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        // Превью ссылки оставляем: для новости это картинка и заголовок,
        // то есть половина смысла поста.
        disable_web_page_preview: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 403 — бот не админ канала либо канал не тот; 400 — чаще всего
      // сломанная HTML-разметка в тексте.
      console.warn(`[telegram] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[telegram] отправка не удалась:", err.message);
    return false;
  }
}

export default { sendToChannel, telegramEnabled, escapeHtml };
