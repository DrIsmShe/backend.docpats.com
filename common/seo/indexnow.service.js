// common/seo/indexnow.service.js
//
// IndexNow — уведомление поисковиков о новых и изменившихся страницах.
//
// Зачем. Обычный путь новой страницы в индекс — дождаться, пока робот сам
// зайдёт по sitemap. Это дни, для молодого домена недели. IndexNow
// переворачивает схему: один POST со списком URL, и Bing, Yandex, Seznam,
// Naver узнают о странице за минуты. Протокол общий — отправка на любой
// участвующий эндпоинт раздаётся остальным.
//
// Google в IndexNow НЕ участвует, и его старый ping?sitemap= отключён в
// 2023-м. Для Google остаётся sitemap + Search Console; ускорить его
// отсюда нельзя, и обещать этого не надо.
//
// Ключ. Поисковик проверяет право владения доменом: по адресу
// https://<хост>/<ключ>.txt должен лежать файл с этим же ключом. Файл
// живёт в client/public/ и уезжает на Netlify вместе с фронтом; сервер
// знает тот же ключ через INDEXNOW_KEY. Не совпадут — отправка молча
// отклоняется на их стороне, поэтому расхождение проверяем сами.
//
// Без INDEXNOW_KEY модуль не делает ничего: это выключатель.

const ENDPOINT = process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow";

// Протокол разрешает до 10 000 URL в одном запросе.
const MAX_URLS_PER_REQUEST = 10000;

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://docpats.com"
    : "http://localhost:3000");

export function indexNowKey() {
  return (process.env.INDEXNOW_KEY || "").trim();
}

export function indexNowEnabled() {
  return Boolean(indexNowKey());
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Отправить список URL. Возвращает сводку, не бросает: уведомление
 * поисковика — вспомогательное действие, из-за него не должна падать
 * публикация.
 */
export async function submitUrls(urls = []) {
  const key = indexNowKey();
  if (!key) return { skipped: "no-key", sent: 0 };

  const host = hostOf(FRONTEND_URL);
  if (!host) return { skipped: "bad-frontend-url", sent: 0 };

  // Чужие хосты протокол отвергает целиком — один посторонний URL губит
  // весь пакет. Поэтому отсекаем их здесь, а не надеемся на сервер.
  const clean = [...new Set(urls.filter((u) => hostOf(u) === host))];
  if (clean.length === 0) return { skipped: "nothing-to-send", sent: 0 };

  const keyLocation = `${FRONTEND_URL}/${key}.txt`;
  let sent = 0;
  const errors = [];

  for (let i = 0; i < clean.length; i += MAX_URLS_PER_REQUEST) {
    const batch = clean.slice(i, i + MAX_URLS_PER_REQUEST);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host,
          key,
          keyLocation,
          urlList: batch,
        }),
      });

      // 200 — принято, 202 — принято, ключ ещё проверяется. Оба нормальны.
      if (res.status === 200 || res.status === 202) {
        sent += batch.length;
      } else {
        // 403 — ключ не найден по keyLocation, самая частая ошибка:
        // фронт не задеплоен или INDEXNOW_KEY разошёлся с именем файла.
        errors.push(`HTTP ${res.status}${res.status === 403 ? " (ключ не подтверждён)" : ""}`);
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (errors.length) {
    console.warn("[indexnow] часть пакетов не принята:", errors.join("; "));
  }
  return { sent, total: clean.length, errors };
}

export default { submitUrls, indexNowEnabled, indexNowKey };
