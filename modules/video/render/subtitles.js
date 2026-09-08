// server/modules/video/render/subtitles.js
//
// Субтитры из сценария и их перевод на остальные языки.
//
// ПОЧЕМУ СУБТИТРЫ, А НЕ ПЯТЬ ОЗВУЧЕК. Озвучка каждого языка — это пять
// рендеров вместо одного и пятикратный счёт за синтез речи. Субтитры дают
// девять десятых пользы за сотую долю денег: азербайджанец в Турции поймёт
// ролик, снятый по-русски. Озвучка остаётся отдельной задачей для языков,
// где она действительно окупится.
//
// ТАЙМИНГ БЕРЁТСЯ ИЗ СЦЕНАРИЯ, А НЕ ИЗ ФАЙЛА. Сцены заданы в секундах ещё
// до рендера — распознавать речь в готовом ролике, чтобы узнать то, что мы
// сами же и написали, было бы странно и неточно.
//
// ПЕРЕВОД ИДЁТ ПО СЦЕНАМ, А НЕ ПО СКЛЕЕННОМУ ТЕКСТУ. Склеенный текст
// возвращается другой длины и другим числом абзацев, и разложить его
// обратно по репликам без ошибок невозможно — а ошибка здесь означает
// подпись не к тому кадру.

import { VIDEO_LOCALES } from "../constants.js";
import { ValidationError } from "../../../common/utils/errors.js";

/** Секунды → «00:00:07.500», как требует формат WebVTT. */
function метка(секунды) {
  const всего = Math.max(0, секунды);
  const ч = String(Math.floor(всего / 3600)).padStart(2, "0");
  const м = String(Math.floor((всего % 3600) / 60)).padStart(2, "0");
  const с = String(Math.floor(всего % 60)).padStart(2, "0");
  const мс = String(Math.round((всего % 1) * 1000)).padStart(3, "0");
  return `${ч}:${м}:${с}.${мс}`;
}

/**
 * Собрать дорожку WebVTT из реплик сцен.
 *
 * @param {Array<{narration: string, seconds: number}>} scenes
 * @param {Array<string>} [тексты] переведённые реплики в том же порядке
 */
export function buildVtt(scenes, тексты = null) {
  if (!Array.isArray(scenes) || !scenes.length) {
    throw new ValidationError("Нет сцен, из которых собирать субтитры");
  }
  if (тексты && тексты.length !== scenes.length) {
    // Молча подставить что есть — значит подписать кадры чужими репликами.
    throw new ValidationError("Число переведённых реплик не совпало со сценами");
  }

  const строки = ["WEBVTT", ""];
  let позиция = 0;

  scenes.forEach((сцена, i) => {
    const длительность = Math.max(1, Number(сцена.seconds) || 1);
    const текст = String((тексты ? тексты[i] : сцена.narration) || "").trim();
    if (текст) {
      строки.push(String(i + 1));
      строки.push(`${метка(позиция)} --> ${метка(позиция + длительность)}`);
      строки.push(текст);
      строки.push("");
    }
    позиция += длительность;
  });

  return строки.join("\n");
}

/**
 * Перевести реплики сценария на остальные языки.
 *
 * Возвращает по дорожке на язык. Сбой одного языка не отменяет остальных:
 * четыре готовых перевода лучше, чем ни одного из-за таймаута на пятом.
 *
 * @returns {Promise<Array<{lang: string, vtt: string}>>}
 */
export async function translateScript({ script, targets = null }) {
  const scenes = script?.scenes || [];
  if (!scenes.length) throw new ValidationError("Пустой сценарий");

  const исходный = script.lang || "ru";
  const языки = (targets || VIDEO_LOCALES).filter((л) => л !== исходный);

  const { translateWithAI } = await import(
    "../../translation/translateWithAI.js"
  );

  const дорожки = [];
  for (const язык of языки) {
    try {
      // Реплики уходят одним текстом с разделителем, но обратно
      // раскладываются по строгому счёту строк — см. проверку ниже.
      const исходник = scenes.map((с) => String(с.narration || "").trim()).join("\n---\n");
      const { content } = await translateWithAI({
        title: script.title || "",
        content: исходник,
        fromLanguage: исходный,
        toLanguage: язык,
      });

      const части = String(content || "")
        .split(/\n-{3,}\n/)
        .map((ч) => ч.trim());

      if (части.length !== scenes.length) {
        // Разделители не пережили перевод — язык пропускаем, а не
        // раскладываем реплики наугад.
        console.warn(
          `[video] перевод на ${язык}: получено ${части.length} реплик вместо ${scenes.length}`,
        );
        continue;
      }

      дорожки.push({ lang: язык, vtt: buildVtt(scenes, части) });
    } catch (err) {
      console.warn(`[video] перевод субтитров на ${язык} не удался:`, err?.message);
    }
  }

  return дорожки;
}


/* ═══════════ загрузка дорожек и привязка к ролику ═══════════ */

/**
 * Положить дорожку в R2 и вернуть её ключ.
 *
 * Ключ, а не публичный URL: субтитры к ролику с пациентом — такая же
 * медицинская запись, как сам ролик, и раздаваться должны подписанной
 * ссылкой. Общий uploadFile из common/middlewares кладёт в uploads/ и
 * отдаёт вечный публичный адрес — здесь это не подходит.
 */
async function загрузитьДорожку(videoId, lang, vtt) {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = (await import("../../../common/services/r2Client.js")).default;
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new ValidationError("Хранилище не настроено");

  const key = `videos/${videoId}/subs/${lang}.vtt`;
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(vtt, "utf8"),
      ContentType: "text/vtt; charset=utf-8",
    }),
  );
  return key;
}

/**
 * Собрать субтитры готовому ролику: язык оригинала плюс переводы.
 *
 * Зовётся после того, как студия вернула файл. Дорожка исходного языка
 * собирается всегда и без обращения к модели — она уже написана в сценарии;
 * переводы идут отдельно и по одному, чтобы сбой на пятом языке не отменил
 * четыре готовых.
 *
 * @returns {Promise<{added: string[]}>} языки, которые удалось добавить
 */
export async function attachSubtitles(video) {
  const script = video?.generation?.script;
  if (!script?.scenes?.length) return { added: [] };

  const исходный = script.lang || video.lang || "ru";
  const добавлено = [];
  const дорожки = [{ lang: исходный, vtt: buildVtt(script.scenes) }];

  try {
    дорожки.push(...(await translateScript({ script })));
  } catch (err) {
    // Переводы не вышли целиком — язык оригинала всё равно приложим:
    // ролик с субтитрами на одном языке лучше ролика без них.
    console.warn("[video] перевод субтитров не удался:", err?.message);
  }

  for (const { lang, vtt } of дорожки) {
    try {
      const key = await загрузитьДорожку(video._id, lang, vtt);
      const уже = video.locales.find((л) => л.lang === lang);
      if (уже) уже.subtitleKey = key;
      else video.locales.push({ lang, subtitleKey: key });
      добавлено.push(lang);
    } catch (err) {
      console.warn(`[video] дорожка ${lang} не загрузилась:`, err?.message);
    }
  }

  if (добавлено.length) await video.save();
  return { added: добавлено };
}

export default { buildVtt, translateScript, attachSubtitles };
