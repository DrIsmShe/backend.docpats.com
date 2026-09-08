// server/modules/video/services/videoEmbed.service.js
//
// Встраивание ролика на чужой сайт — страница плеера внутри <iframe>.
//
// ПОЧЕМУ СТРАНИЦУ ОТДАЁТ СЕРВЕР, А НЕ SPA. Весь остальной сайт фреймить
// нельзя: приложение работает под сессионной cookie, и страница с кнопками
// внутри чужого фрейма — это готовый кликджекинг. Поэтому helmet ставит
// X-Frame-Options на всё приложение, а здесь стоит единственное исключение:
// маленькая самодостаточная страница без сессии, без кнопок действий и без
// доступа к чему-либо, кроме одного публичного ролика.
//
// ЧТО ЭТА СТРАНИЦА НЕ ДЕЛАЕТ. Не читает cookie, не ходит в приватные
// маршруты, не показывает ни PHI-ролики, ни скрытые, ни архивные. Ссылка
// на просмотр открывается target="_blank" — вернуть человека на площадку
// нужно, но подменять чужую страницу своей нельзя.
//
// ССЫЛКА НА ФАЙЛ ЖИВЁТ ЧАС. Внутри фрейма некому обновить подписанный
// адрес, а часа хватает на любой наш ролик (предел загрузки — 10 минут).

import Video from "../models/video.model.js";
import { NotFoundError, ForbiddenError } from "../../../common/utils/errors.js";
import { getPublicPlaybackUrls } from "./videoPlayback.service.js";

/** Публичный адрес площадки — для ссылки «смотреть на DocPats». */
function площадка() {
  return (process.env.CLIENT_URL || "https://docpats.com").replace(/\/+$/, "");
}

/** Экранирование: заголовок ролика пишет человек, и он попадёт в HTML. */
function экранировать(строка) {
  return String(строка || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Данные для страницы встраивания.
 *
 * Отдельная функция, потому что этими же проверками пользуется oEmbed:
 * два места, решающих «можно ли встраивать», разойдутся.
 */
export async function embedData(id) {
  const video = await Video.findOne({
    _id: id,
    visibility: "public",
    status: "ready",
    phi: false,
    archivedAt: null,
  })
    .select("title allowEmbed media lang")
    .lean();

  if (!video) throw new NotFoundError("Ролик не найден");
  if (video.allowEmbed === false) {
    throw new ForbiddenError("Автор запретил встраивание этого ролика");
  }

  const показ = await getPublicPlaybackUrls({ id });
  return { video, показ };
}

/**
 * HTML страницы плеера.
 *
 * Никаких сборок и внешних скриптов: страница должна открываться в чужом
 * фрейме мгновенно и работать, даже когда наш фронт лежит.
 */
export async function embedPage(id) {
  const { video, показ } = await embedData(id);

  const заголовок = экранировать(video.title);
  const ссылка = `${площадка()}/videos/${id}`;
  const дорожки = (показ.subtitles || [])
    .map(
      (д) =>
        `<track kind="subtitles" src="${экранировать(д.url)}" srclang="${экранировать(
          д.lang,
        )}" label="${экранировать(String(д.lang).toUpperCase())}">`,
    )
    .join("");

  return `<!doctype html>
<html lang="${экранировать(video.lang || "ru")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${заголовок}</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; }
  .wrap { position: relative; width: 100%; height: 100%; }
  video { width: 100%; height: 100%; display: block; background: #000; }
  .back {
    position: absolute; left: 12px; top: 12px; z-index: 2;
    font: 600 12px/1 system-ui, sans-serif; color: #fff; text-decoration: none;
    background: rgba(0,0,0,.6); padding: 7px 10px; border-radius: 6px;
  }
  .back:hover { background: rgba(0,0,0,.8); }
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="${экранировать(ссылка)}" target="_blank" rel="noopener">DocPats</a>
  <video controls playsinline preload="metadata"
         poster="${экранировать(показ.poster || "")}"
         src="${экранировать(показ.url)}">${дорожки}</video>
</div>
</body>
</html>`;
}

/**
 * Код для вставки — то, что человек копирует у себя на странице ролика.
 *
 * Соотношение 16:9 держим на padding-top, а не на height: у встраивающего
 * может быть какая угодно ширина колонки, и фиксированная высота даст
 * чёрные поля.
 */
export function embedCode(id) {
  const адрес = `${площадка()}/embed/${id}`;
  return {
    url: адрес,
    html:
      `<div style="position:relative;padding-top:56.25%">` +
      `<iframe src="${адрес}" style="position:absolute;inset:0;width:100%;height:100%;border:0"` +
      ` allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"` +
      ` title="DocPats"></iframe></div>`,
  };
}

export default { embedData, embedPage, embedCode };
