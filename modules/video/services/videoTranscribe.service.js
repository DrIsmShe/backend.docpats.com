// server/modules/video/services/videoTranscribe.service.js
//
// Речь из ролика → текст → субтитры → перевод на выбранные языки.
//
// ЗАЧЕМ ЭТО НУЖНО ИМЕННО ЗДЕСЬ. Субтитры у нас умели появляться только у
// машинно собранных роликов: там есть сценарий, и текст известен заранее
// (render/subtitles.js). У снятого в студии или загруженного с компьютера
// ролика сценария нет — и он оставался без единой дорожки. Между тем
// объяснение перед процедурой смотрят с выключенным звуком в коридоре
// поликлиники, а пациент со снижением слуха — только с субтитрами.
//
// РАСПОЗНАЁТ ТОТ ЖЕ ДВИЖОК, ЧТО И НАДИКТОВКА. modules/dictation уже умеет
// говорить с Whisper, знает про медицинский глоссарий и про артефакты
// тишины. Второй провайдер означал бы, что улучшение распознавания
// придётся вносить дважды.
//
// ПРЕДЕЛ 25 МБ — ЧУЖОЙ, НО ТЕПЕРЬ ОН НЕ ПРО РОЛИК. Whisper принимает файл
// до 25 МБ, а ролик на десять минут весит сотни — почти любой снятый фильм
// не проходил. На вход уходит не видео, а его звуковая дорожка: моно, 16
// кГц, 64 кбит/с. Десять минут речи в таком виде — около пяти мегабайт,
// то есть предел перестал быть препятствием, оставшись проверкой.
//
// БЕЗ ffmpeg РАБОТАЕТ ПО-СТАРОМУ. На машине, где его нет, файл уходит
// целиком и мелкие ролики по-прежнему распознаются: отсутствие
// инструмента не должно отключать функцию совсем.
//
// ПЕРЕВОД — ПО ВЫБОРУ, А НЕ ВЕЕРОМ. Каждый язык стоит вызова модели, и
// автор сам решает, куда его ролику. Пустой список = только язык оригинала.

import Video from "../models/video.model.js";
import {
  NotFoundError,
  ValidationError,
  ServiceUnavailableError,
} from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { canEdit } from "./video.service.js";
import { VIDEO_LOCALES } from "../constants.js";

/** Предел распознавателя. Не наш выбор — ограничение стороннего сервиса. */
const ПРЕДЕЛ_БАЙТ = 25 * 1024 * 1024;

/** Максимум символов в строке субтитра — дальше строка не читается на ходу. */
const СИМВОЛОВ_В_СТРОКЕ = 42;

function время(сек) {
  const с = Math.max(0, Number(сек) || 0);
  const ч = String(Math.floor(с / 3600)).padStart(2, "0");
  const м = String(Math.floor((с % 3600) / 60)).padStart(2, "0");
  const сек2 = String(Math.floor(с % 60)).padStart(2, "0");
  const мс = String(Math.round((с % 1) * 1000)).padStart(3, "0");
  return `${ч}:${м}:${сек2}.${мс}`;
}

/** Разбить длинную реплику на две строки — по слову, а не по символу. */
function перенести(текст) {
  const t = String(текст || "").trim();
  if (t.length <= СИМВОЛОВ_В_СТРОКЕ) return t;

  const слова = t.split(/\s+/);
  const строки = [];
  let текущая = "";
  for (const слово of слова) {
    if ((текущая + " " + слово).trim().length > СИМВОЛОВ_В_СТРОКЕ && текущая) {
      строки.push(текущая);
      текущая = слово;
    } else {
      текущая = (текущая + " " + слово).trim();
    }
  }
  if (текущая) строки.push(текущая);
  // Больше двух строк за раз человек не успевает прочитать.
  return строки.slice(0, 2).join("\n");
}

/** VTT из фрагментов распознавателя. */
export function vttИзФрагментов(фрагменты) {
  const тело = (фрагменты || [])
    .filter((ф) => ф.text && ф.end > ф.start)
    .map((ф, i) => `${i + 1}\n${время(ф.start)} --> ${время(ф.end)}\n${перенести(ф.text)}`)
    .join("\n\n");

  return `WEBVTT\n\n${тело}\n`;
}

/** Положить дорожку в хранилище и вернуть ключ. */
async function загрузитьДорожку(videoId, lang, vtt) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new ServiceUnavailableError("Хранилище не настроено");

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = (await import("../../../common/services/r2Client.js")).default;

  const key = `videos/subtitles/${videoId}.${lang}.vtt`;
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

/** Скачать файл ролика из хранилища. */
async function скачатьРолик(storageKey) {
  const bucket = process.env.R2_BUCKET;
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = (await import("../../../common/services/r2Client.js")).default;

  const ответ = await r2.send(
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
  );
  const куски = [];
  for await (const кусок of ответ.Body) куски.push(кусок);
  return Buffer.concat(куски);
}

/**
 * Перевести готовые фрагменты на другой язык.
 *
 * Реплики уходят одним текстом с разделителем и раскладываются обратно по
 * строгому счёту — тот же приём, что в render/subtitles.js, и по той же
 * причине: если разделители не пережили перевод, лучше пропустить язык,
 * чем разложить реплики наугад и сдвинуть весь тайминг.
 */
async function перевестиФрагменты({ фрагменты, from, to, title }) {
  const { translate: translateWithAI } = await import("../../translation/translation.provider.js");

  const исходник = фрагменты.map((ф) => ф.text).join("\n---\n");
  const { content } = await translateWithAI({
    title: title || "",
    content: исходник,
    fromLanguage: from,
    toLanguage: to,
  });

  const части = String(content || "")
    .split(/\n-{3,}\n/)
    .map((ч) => ч.trim());

  if (части.length !== фрагменты.length) {
    throw new ValidationError(
      `перевод на ${to}: получено ${части.length} реплик вместо ${фрагменты.length}`,
    );
  }

  return фрагменты.map((ф, i) => ({ ...ф, text: части[i] }));
}

/**
 * Распознать речь ролика и приложить субтитры.
 *
 * @param {object} p
 * @param {object} p.actor
 * @param {string} p.id
 * @param {string[]} p.targets   языки перевода; пусто — только оригинал
 * @param {string} p.lang        язык речи; пусто — определит распознаватель
 */
export async function transcribeVideo({ actor, id, targets = [], lang = "" }) {
  const video = await Video.findById(id);
  if (!video) throw new NotFoundError("Ролик не найден");
  if (!canEdit(video, actor)) throw new NotFoundError("Ролик не найден");

  if (!video.media?.storageKey) throw new ValidationError("У ролика нет файла");
  if (video.status !== "ready") throw new ValidationError("Ролик ещё не готов");

  const { transcribe, isConfigured } = await import(
    "../../dictation/providers/stt.provider.js"
  );
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "Распознавание речи не настроено: задайте OPENAI_API_KEY",
    );
  }

  const файл = await скачатьРолик(video.media.storageKey);
  const исходный = lang || video.lang || "ru";

  // Готовим вход распознавателю: звук, если есть чем его вытащить.
  let наВход = файл;
  let имяФайла = `video-${id}.mp4`;
  let убрать = null;

  const { ffmpegДоступен, извлечьЗвук, временныйФайл } = await import(
    "../media/ffmpeg.js"
  );

  if (await ffmpegДоступен()) {
    const видеоФайл = await временныйФайл(".mp4");
    const звукФайл = await временныйФайл(".mp3");
    убрать = async () => {
      await видеоФайл.убрать();
      await звукФайл.убрать();
    };

    try {
      const fs = await import("node:fs/promises");
      await fs.writeFile(видеоФайл.путь, файл);
      await извлечьЗвук(видеоФайл.путь, звукФайл.путь);
      наВход = await fs.readFile(звукФайл.путь);
      имяФайла = `video-${id}.mp3`;
    } catch (err) {
      // Не вышло — идём прежним путём. Ролик мог оказаться без звуковой
      // дорожки или в формате, который сборка не разбирает; отказываться
      // от распознавания целиком из-за этого незачем.
      console.warn("[video] звук не извлечён, отправляем файл целиком:", err?.message);
      await убрать();
      убрать = null;
      наВход = файл;
    }
  }

  // Предел проверяем по тому, ЧТО РЕАЛЬНО УЙДЁТ распознавателю. Раньше
  // сравнивали размер ролика — и отказывали фильмам, звук которых занял
  // бы пять мегабайт.
  if (наВход.length > ПРЕДЕЛ_БАЙТ) {
    if (убрать) await убрать();
    throw new ValidationError(
      `Распознавание принимает до ${Math.floor(ПРЕДЕЛ_БАЙТ / 1024 / 1024)} МБ, ` +
        `а здесь ${Math.round(наВход.length / 1024 / 1024)} МБ. ` +
        "Разделите ролик на части.",
    );
  }

  let итог;
  try {
    итог = await transcribe({
      buffer: наВход,
      filename: имяФайла,
      lang: исходный,
      withSegments: true,
      // Ролик без речи — не ошибка оператора: бывает музыка и анимация.
      allowEmpty: true,
    });
  } finally {
    if (убрать) await убрать();
  }

  if (!итог.segments?.length) {
    throw new ValidationError(
      "В ролике не распознана речь — субтитры собрать не из чего",
    );
  }

  const дорожки = [{ lang: исходный, фрагменты: итог.segments }];

  // Переводим только туда, куда попросили, и пропускаем язык оригинала.
  const куда = (targets || []).filter(
    (л) => VIDEO_LOCALES.includes(л) && л !== исходный,
  );
  const неудачи = [];
  for (const язык of куда) {
    try {
      дорожки.push({
        lang: язык,
        фрагменты: await перевестиФрагменты({
          фрагменты: итог.segments,
          from: исходный,
          to: язык,
          title: video.title,
        }),
      });
    } catch (err) {
      // Один неудавшийся язык не должен отменять остальные: дорожка на
      // языке оригинала уже полезна.
      неудачи.push(язык);
      console.warn(`[video] субтитры ${язык}:`, err?.message);
    }
  }

  const добавлено = [];
  for (const д of дорожки) {
    const key = await загрузитьДорожку(video._id, д.lang, vttИзФрагментов(д.фрагменты));
    const уже = video.locales.find((л) => л.lang === д.lang);
    if (уже) уже.subtitleKey = key;
    else video.locales.push({ lang: д.lang, subtitleKey: key });
    добавлено.push(д.lang);
  }

  // Расшифровка целиком — она пригодится и поиску, и человеку, который
  // хочет прочитать вместо просмотра.
  video.transcript = {
    lang: исходный,
    text: итог.text,
    model: итог.model,
    createdAt: new Date(),
  };
  await video.save();

  await recordAction({
    actor: {
      userId: actor.ownerId,
      email: actor.email || null,
      role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
    },
    action: "video.transcribe",
    resourceType: "video",
    resourceId: video._id,
    // Текста расшифровки в журнале нет: у ролика с пациентом это была бы
    // запись его слов в системный лог.
    metadata: {
      langs: добавлено,
      failed: неудачи,
      chars: итог.text.length,
      model: итог.model,
    },
  });

  return { langs: добавлено, failed: неудачи, chars: итог.text.length };
}

export default { transcribeVideo, vttИзФрагментов };
