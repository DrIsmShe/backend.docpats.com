import crypto from "node:crypto";

// Токен отписки: подписанная ссылка, которая работает БЕЗ входа в аккаунт.
//
// Почему не сессия. Отписываются из письма, часто с телефона, часто спустя
// месяцы — заставлять человека вспоминать пароль ради отписки значит
// получить вместо отписки жалобу на спам. Жалоба бьёт по доставляемости
// всех писем домена, включая напоминания о приёмах.
//
// Почему HMAC, а не «id в ссылке». Ссылка с сырым userId позволяет отписать
// чужой аккаунт перебором. Подпись это закрывает: подделать её нельзя, не
// зная секрета.
//
// Токен привязан к КОНКРЕТНОЙ рассылке (list), а не к почте вообще: отписка
// от конференций не должна отключать письма о приёмах.

const SEPARATOR = ".";

function secret() {
  const value = process.env.UNSUBSCRIBE_SECRET || process.env.SECRET;
  if (!value) {
    // Закрываемся, а не открываемся: без секрета подпись проверить нельзя,
    // и «пропустить» здесь означало бы отписывать кого угодно.
    throw new Error("UNSUBSCRIBE_SECRET (или SECRET) не задан");
  }
  return value;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * @param {string} userId
 * @param {string} list  идентификатор рассылки: "conference", "digest", ...
 * @param {number} [ttlDays] по умолчанию год — письмо могут открыть нескоро
 */
export function createUnsubscribeToken(userId, list, ttlDays = 365) {
  const exp = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
  const payload = b64url(`${userId}${SEPARATOR}${list}${SEPARATOR}${exp}`);
  return `${payload}${SEPARATOR}${sign(payload)}`;
}

/**
 * @returns {{ userId: string, list: string } | null} null — подделка или протух
 */
export function verifyUnsubscribeToken(token) {
  const raw = String(token || "");
  const idx = raw.lastIndexOf(SEPARATOR);
  if (idx <= 0) return null;

  const payload = raw.slice(0, idx);
  const provided = raw.slice(idx + 1);

  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }

  // Сравнение за постоянное время — чтобы подпись нельзя было подобрать
  // посимвольно по времени ответа.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [userId, list, exp] = Buffer.from(payload, "base64url")
    .toString("utf8")
    .split(SEPARATOR);
  if (!userId || !list || !exp) return null;
  if (Number(exp) < Date.now()) return null;

  return { userId, list };
}

export function unsubscribeUrl(userId, list) {
  const base = process.env.BACKEND_URL || "https://backend.docpats.com";
  return `${base}/api/v1/public/unsubscribe?token=${createUnsubscribeToken(userId, list)}`;
}
