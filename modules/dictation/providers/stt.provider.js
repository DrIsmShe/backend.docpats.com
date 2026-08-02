// server/modules/dictation/providers/stt.provider.js
//
// Распознавание речи. Сменный шаг: движок знает только интерфейс
// { isConfigured, transcribe }, а не то, кто именно слушает аудио.
//
// ПОЧЕМУ ЭТО ВАЖНО ИМЕННО ЗДЕСЬ. Качество распознавания сильно зависит от
// языка: русский и турецкий Whisper знает хорошо, азербайджанский заметно
// хуже. Когда для части языков понадобится другой движок или локальный
// self-hosted — заменится один этот файл, а не модуль.
//
// ⚠️ ЭТО OpenAI, А НЕ ANTHROPIC. temperature: 0 здесь ЛЕГАЛЕН и осмыслен —
// он подавляет «творческое» достраивание расслышанного. Не переносить это
// на вызовы Claude: там сэмплирующие параметры удалены и дают 400.

import OpenAI from "openai";
import { toFile } from "openai";
import { ServiceUnavailableError, ValidationError } from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

export const STT_MODEL = process.env.DICTATION_STT_MODEL || "whisper-1";

// Подсказка распознавателю: термины, которые он иначе слышит как бытовые
// слова. Список плоский и пополняемый — это его нормальный формат.
// Заводить сюда стоит то, что реально ошиблось у ваших врачей, а не всё
// подряд: слишком длинная подсказка съедает контекст и начинает мешать.
export const MEDICAL_GLOSSARY = [
  "анамнез морби, анамнез вите, статус презенс, статус локалис",
  "пальпация, перкуссия, аускультация, гиперемия, отёк, инфильтрат",
  "МКБ-10, ЭКГ, УЗИ, КТ, МРТ, ФГДС, ЭхоКГ, СОЭ, СРБ",
  "гемоглобин, лейкоциты, тромбоциты, креатинин, билирубин, ферритин",
  "гипертония, тахикардия, брадикардия, аритмия, стенокардия",
  "омепразол, амоксициллин, метформин, аторвастатин, ибупрофен",
].join(". ");

// Артефакты тишины: распознаватели на пустом или очень тихом фрагменте
// выдают титры и подписи, на которых обучались. В медицинской записи такая
// строка выглядит как настоящий текст — вырезаем.
const SILENCE_ARTIFACTS = [
  /субтитры\s+(сделал|создавал|подготовил)[^.\n]*/gi,
  /продолжение\s+следует\.{0,3}/gi,
  /редактор\s+субтитров[^.\n]*/gi,
  /корректор[^.\n]*/gi,
  /^\s*спасибо\s+за\s+просмотр[.!]?\s*$/gim,
  /^\s*(thanks?\s+for\s+watching|subtitles?\s+by)[^.\n]*/gim,
  /^\s*ПРОДОЛЖЕНИЕ\s+В\s+СЛЕДУЮЩЕЙ[^.\n]*/gim,
];

/** Короче этого распознавать нечего — почти наверняка случайное нажатие. */
export const MIN_DURATION_SEC = 3;
/** Осмысленная надиктовка не бывает такой короткой даже одним предложением. */
export const MIN_TRANSCRIPT_CHARS = 20;

let client = null;

export function isConfigured() {
  return Boolean((process.env.OPENAI_API_KEY || "").trim());
}

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Убирает известные артефакты тишины и схлопывает пустые строки.
 * Экспортируется отдельно: постфильтр надо уметь проверить тестом без сети.
 */
export function cleanTranscript(raw) {
  let text = String(raw ?? "");
  for (const re of SILENCE_ARTIFACTS) text = text.replace(re, " ");
  return text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Аудио → текст.
 *
 * @param {object} args
 * @param {Buffer} args.buffer   содержимое файла
 * @param {string} args.filename имя (нужно распознавателю для определения формата)
 * @param {string} [args.lang]   ISO-код языка; пусто — автоопределение
 * @returns {Promise<{text: string, model: string, durationSec: number}>}
 */
export async function transcribe({ buffer, filename, lang } = {}) {
  if (!buffer?.length) throw new ValidationError("Пустой аудиофайл");
  if (!isConfigured()) {
    throw new ServiceUnavailableError(
      "Распознавание не настроено: задайте OPENAI_API_KEY в .env сервера",
    );
  }

  let result;
  try {
    result = await getClient().audio.transcriptions.create({
      file: await toFile(buffer, filename || "dictation.webm"),
      model: STT_MODEL,
      // verbose_json нужен ради длительности: по ней отсекаются случайные
      // нажатия и считается статистика.
      response_format: "verbose_json",
      // Подавляет достраивание неразобранного — см. предупреждение вверху файла.
      temperature: 0,
      prompt: MEDICAL_GLOSSARY,
      // Язык НЕ навязываем по умолчанию: у врача в речи смесь языков и
      // латинских терминов, и жёсткая привязка ухудшает результат.
      ...(lang ? { language: lang } : {}),
    });
  } catch (err) {
    logger?.error?.(
      { err, model: STT_MODEL, status: err?.status ?? null },
      "dictation: распознавание не прошло",
    );
    // 4xx кроме 429 — наша вина (формат, размер), повторять бессмысленно.
    const status = err?.status ?? 0;
    const retryable = status === 429 || status >= 500 || status === 0;
    const message = err?.message || "Распознавание речи недоступно";
    throw retryable
      ? new ServiceUnavailableError(message)
      : new ValidationError(message);
  }

  const durationSec = Math.round(Number(result?.duration) || 0);
  const text = cleanTranscript(result?.text);

  if (durationSec && durationSec < MIN_DURATION_SEC) {
    throw new ValidationError(
      `Запись короче ${MIN_DURATION_SEC} секунд — надиктуйте осмотр целиком`,
    );
  }
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    throw new ValidationError(
      "В записи не распознана речь. Проверьте микрофон и надиктуйте заново.",
    );
  }

  return { text, model: STT_MODEL, durationSec };
}
