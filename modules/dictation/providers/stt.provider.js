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
//
// ⚠️ ПОДСКАЗКА ПРИВЯЗАНА К ЯЗЫКУ, И ЭТО НЕ ФОРМАЛЬНОСТЬ.
//
// Whisper относится к prompt как к началу расшифровки. Когда язык подсказки
// и язык речи расходятся, а сам язык распознаётся плохо, модель бросает
// аудио и продолжает подсказку. Русский глоссарий на азербайджанском приёме
// давал ровно это: в черновике оказывались «гемоглобин, амоксициллин,
// метформин, аторвастатин» — слова из этого файла, которых в разговоре не
// звучало. Обе стороны говорили по-азербайджански.
//
// Поэтому глоссарий раздаётся ПО ЯЗЫКУ, а не всем подряд. Нет глоссария для
// языка — подсказки нет вовсе: русские термины будут иногда писаться на слух,
// но расшифровка останется расшифровкой, а не списком препаратов.
export const GLOSSARIES = {
  ru: [
    "анамнез морби, анамнез вите, статус презенс, статус локалис",
    "пальпация, перкуссия, аускультация, гиперемия, отёк, инфильтрат",
    "МКБ-10, ЭКГ, УЗИ, КТ, МРТ, ФГДС, ЭхоКГ, СОЭ, СРБ",
    "гемоглобин, лейкоциты, тромбоциты, креатинин, билирубин, ферритин",
    "гипертония, тахикардия, брадикардия, аритмия, стенокардия",
    "омепразол, амоксициллин, метформин, аторвастатин, ибупрофен",
  ].join(". "),
};

/** Совместимость: часть кода и тестов ссылается на прежнее имя. */
export const MEDICAL_GLOSSARY = GLOSSARIES.ru;

/**
 * Подсказка для языка речи. Пустой или незнакомый язык — без подсказки:
 * чужая подсказка вредит сильнее, чем помогает своя.
 */
export function promptFor(lang) {
  const key = String(lang || "")
    .slice(0, 2)
    .toLowerCase();
  return GLOSSARIES[key] || null;
}

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

// ─── ЭХО ПОДСКАЗКИ ───────────────────────────────────────────────────
//
// Whisper на фрагменте без разборчивой речи возвращает переданный prompt
// ДОСЛОВНО. Из-за этого MEDICAL_GLOSSARY приезжал обратно как расшифровка:
// в черновике приёма стояло «МКБ-10, ЭКГ, УЗИ, КТ, МРТ, ФГДС, ЭхоКГ, СОЭ,
// СРБ», повторённое по куску на каждые 20 секунд записи. Длины хватало,
// чтобы пройти MIN_TRANSCRIPT_CHARS, и подделка уходила дальше по конвейеру
// как настоящая речь — вплоть до карты пациента.
//
// Ловим по составу: эхо целиком состоит из слов самой подсказки, а живая
// речь — нет, в ней есть связки («пациент», «жалуется», «назначено»).
// Порог намеренно строгий: лучше пропустить эхо, чем выбросить приём, где
// врач надиктовал одни аббревиатуры.
const GLOSSARY_WORDS = new Set(
  Object.values(GLOSSARIES)
    .join(". ")
    .toLowerCase()
    .split(/[\s.,]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean),
);

/**
 * Похоже ли, что распознаватель вернул нашу же подсказку вместо речи.
 * Экспортируется отдельно — это чистая функция, её проверяет тест без сети.
 */
export function isPromptEcho(raw) {
  const words = String(raw ?? "")
    .toLowerCase()
    .split(/[\s.,]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean);

  if (!words.length) return false;

  const foreign = words.filter((w) => !GLOSSARY_WORDS.has(w));
  // Одно-два своих слова среди словаря — всё ещё эхо: распознаватель любит
  // приклеить к подсказке обрывок. Дальше уже похоже на настоящую речь.
  return foreign.length <= Math.min(2, Math.floor(words.length * 0.1));
}

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
 * @param {boolean} [args.allowEmpty] для потоковых вызовов: молчание в куске
 *   не ошибка, вернуть пустой текст вместо исключения. Целая надиктовка без
 *   речи — ошибка, и там это остаётся исключением.
 * @returns {Promise<{text: string, model: string, durationSec: number}>}
 */
export async function transcribe({ buffer, filename, lang, allowEmpty = false } = {}) {
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
      // Только своя подсказка, для своего языка. Без языка — без подсказки.
      ...(promptFor(lang) ? { prompt: promptFor(lang) } : {}),
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
  const raw = cleanTranscript(result?.text);

  // Эхо подсказки — это НЕ речь. Отбрасываем до всех проверок длины: иначе
  // словарь на 300 символов проходит их с запасом и едет в карту.
  const echo = isPromptEcho(raw);
  if (echo) {
    logger?.warn?.(
      { model: STT_MODEL, durationSec, chars: raw.length },
      "dictation: распознаватель вернул подсказку вместо речи — считаем тишиной",
    );
  }
  const text = echo ? "" : raw;

  const tooShort = durationSec && durationSec < MIN_DURATION_SEC;
  const noSpeech = text.length < MIN_TRANSCRIPT_CHARS;

  // Потоковому вызову (scribe пишет приём кусками) молчание в отдельном
  // куске — норма: собеседники не говорят непрерывно. Ошибкой оно остаётся
  // только для целой надиктовки.
  if (allowEmpty && (tooShort || noSpeech)) {
    return { text: "", model: STT_MODEL, durationSec };
  }

  if (tooShort) {
    throw new ValidationError(
      `Запись короче ${MIN_DURATION_SEC} секунд — надиктуйте осмотр целиком`,
    );
  }
  if (noSpeech) {
    throw new ValidationError(
      "В записи не распознана речь. Проверьте микрофон и надиктуйте заново.",
    );
  }

  return { text, model: STT_MODEL, durationSec };
}
