// server/modules/video/studioCallback.js
//
// Приём сообщения от студии DP-Videra: «фильм отрендерен, вот файл».
//
// ПОЧЕМУ НЕ СЕССИЯ. Стучится служба с другого сервера, у неё нет ни куки, ни
// пользователя. Единственное основание доверия — общий ключ, тот же
// DPVIDERA_SECRET, которым подписывается пропуск в студию (modules/videra/
// pass.js). Второй ключ здесь ничего не добавил бы: у обеих сторон он один
// и тот же и лежит в одном и том же месте.
//
// ЧТО ИМЕННО ПОДПИСЫВАЕТСЯ. Строка `timestamp.studioFilmId.status`, а не всё
// тело. Причина практическая: express.json разбирает тело раньше, чем сюда
// доходит запрос, и сырых байтов уже нет — подписать тело можно было бы
// только смонтировав модуль до парсеров, как сделано для sitemap. Взамен
// подписаны ровно те поля, подмена которых что-то даёт: какой фильм и с
// каким исходом. Ключи файлов не подписаны, но подделать их может только
// тот, кто уже владеет ключом и может подписать что угодно.
//
// ОКНО ПЯТЬ МИНУТ. Столько же живёт пропуск. Повтор доставки студией в этом
// окне безопасен: applyStudioRender идемпотентен и второй раз просто
// перезапишет те же поля.

import crypto from "node:crypto";
import { ключ } from "../videra/pass.js";

const ОКНО_СЕКУНД = 300;

/** Та же схема подписи, что у пропуска: HMAC-SHA256, base64url. */
function подпись(строка) {
  return crypto.createHmac("sha256", ключ()).update(строка).digest("base64url");
}

/** Сравнение без утечки времени — иначе подпись подбирается побайтно. */
function равны(а, б) {
  const бA = Buffer.from(String(а));
  const бB = Buffer.from(String(б));
  if (бA.length !== бB.length) return false;
  return crypto.timingSafeEqual(бA, бB);
}

/**
 * Проверка подписи вебхука.
 *
 * Заголовки:
 *   x-videra-timestamp — секунды эпохи
 *   x-videra-signature — HMAC от `timestamp.studioFilmId.status`
 *
 * Ошибки намеренно одинаково скупы: подробность вроде «подпись верна, но
 * просрочена» рассказывает атакующему, что он на верном пути.
 */
export function проверитьПодписьСтудии(req, res, next) {
  if (!ключ()) {
    return res.status(503).json({ message: "Студия фильмов не настроена" });
  }

  const timestamp = String(req.get("x-videra-timestamp") || "");
  const signature = String(req.get("x-videra-signature") || "");
  const filmId = String(req.body?.studioFilmId || "");
  const status = String(req.body?.status || "");

  if (!timestamp || !signature || !filmId) {
    return res.status(401).json({ message: "Подпись не принята" });
  }

  const возраст = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(возраст) || возраст > ОКНО_СЕКУНД) {
    return res.status(401).json({ message: "Подпись не принята" });
  }

  if (!равны(signature, подпись(`${timestamp}.${filmId}.${status}`))) {
    return res.status(401).json({ message: "Подпись не принята" });
  }

  next();
}

/**
 * Собрать заголовки для вызова — нужен студии и тестам.
 * Держим рядом с проверкой: две половины одного протокола не должны
 * разъезжаться по разным файлам.
 */
export function заголовкиВызова({ studioFilmId, status = "" }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-videra-timestamp": timestamp,
    "x-videra-signature": подпись(`${timestamp}.${studioFilmId}.${status}`),
  };
}

export default { проверитьПодписьСтудии, заголовкиВызова };
