// server/jobs/indexnowSubmit.job.js
// ─────────────────────────────────────────────────────────────────────
//   Отправка новых и изменившихся URL в IndexNow (Bing, Yandex, Seznam,
//   Naver). Раз в час.
//
//   Почему job, а не хук на публикацию. Публикация происходит в трёх
//   разных местах: статьи врачей и витрины клиник — здесь, новости и
//   синтез-статьи — в отдельном процессе news-engine, который пишет
//   прямо в свою базу. Хук пришлось бы вешать в каждом и не забыть про
//   следующий; забытый хук молчит, и заметить это невозможно. Job же
//   сравнивает полный список публичных URL с уже отправленными и потому
//   ловит любой источник, включая те, которых ещё нет.
//
//   Источник URL — тот же набор, что отдаёт /sitemap.xml (теперь это
//   индекс из нескольких файлов). Второй список публичных страниц завёл
//   бы вторую правду; разбор XML живёт в самом sitemap-сервисе, который
//   этот формат и порождает.
//
//   Без INDEXNOW_KEY job не регистрируется вовсе.
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import { collectAllUrlPairs } from "../common/sitemap/services/sitemap.service.js";
import SeoSubmission from "../common/models/Seo/seoSubmission.js";
import {
  submitUrls,
  indexNowEnabled,
} from "../common/seo/indexnow.service.js";

// Предохранитель на первый прогон. В базе ещё пусто, а в sitemap могут
// быть тысячи URL — вывалить их разом значит выглядеть как свалка.
// Дальше очередь разгребается по MAX_PER_RUN за час.
//
// Значение обязано оставаться НЕ БОЛЬШЕ лимита одного запроса IndexNow
// (10 000): тогда прогон — ровно один HTTP-запрос, и «отправлено» это
// всё или ничего. Иначе пришлось бы отмечать в базе успешные пакеты
// отдельно от неуспешных, а не пачку целиком, как сделано ниже.
const MAX_PER_RUN = 2000;

const CRON = process.env.INDEXNOW_CRON || "20 * * * *";

export async function runIndexNowSubmit() {
  if (!indexNowEnabled()) return { skipped: "no-key" };

  const entries = await collectAllUrlPairs();
  if (entries.length === 0) return { candidates: 0, sent: 0 };

  // Одним запросом достаём всё, что уже отправляли: по URL, а не по
  // одному документу на страницу в цикле — иначе тысяча round-trip'ов.
  const known = new Map(
    (
      await SeoSubmission.find(
        { url: { $in: entries.map((e) => e.loc) } },
        { url: 1, lastmod: 1 },
      ).lean()
    ).map((d) => [d.url, d.lastmod]),
  );

  // Новое — или то, у чего сменился lastmod.
  const fresh = entries.filter((e) => known.get(e.loc) !== e.lastmod);
  if (fresh.length === 0) return { candidates: entries.length, sent: 0 };

  const batch = fresh.slice(0, MAX_PER_RUN);
  const result = await submitUrls(batch.map((e) => e.loc));

  // Записываем только при успехе: иначе неотправленный URL считался бы
  // отправленным и не попал бы в индекс уже никогда.
  if (result.sent > 0) {
    await SeoSubmission.bulkWrite(
      batch.map((e) => ({
        updateOne: {
          filter: { url: e.loc },
          update: {
            $set: { lastmod: e.lastmod, submittedAt: new Date() },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  return {
    candidates: entries.length,
    fresh: fresh.length,
    sent: result.sent || 0,
    deferred: Math.max(0, fresh.length - batch.length),
  };
}

/** Регистрация cron — ежечасно в :20. */
export function scheduleIndexNowSubmit() {
  if (!indexNowEnabled()) {
    console.log("ℹ️ IndexNow выключен (нет INDEXNOW_KEY) — job не запущен");
    return;
  }

  cron.schedule(CRON, async () => {
    try {
      const r = await runIndexNowSubmit();
      if (r.skipped) return;
      console.log(
        `🔎 IndexNow: всего=${r.candidates} новых=${r.fresh} отправлено=${r.sent}` +
          (r.deferred ? ` отложено=${r.deferred}` : ""),
      );
    } catch (err) {
      console.error("❌ IndexNow cron error:", err.message);
    }
  });
  console.log(`⏰ IndexNow cron активен (${CRON})`);
}

export default scheduleIndexNowSubmit;
