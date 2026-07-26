// server/modules/radiology/radiology-attempts/services/integrity.service.js
//
// СИГНАЛЫ ДОБРОСОВЕСТНОСТИ зачётной попытки. Собираются, чтобы автор кейса
// и администратор видели, где измерение вызывает сомнения. Ни один из них
// НЕ меняет балл и НЕ блокирует сдачу — это подсказка человеку, а не суд.
//
// Почему именно так, а не «поймать списывающего»: приложение в браузере
// принципиально не может знать, что открыто на телефоне рядом. Всё, что
// присылает клиент, подделывается. Поэтому сигналы здесь — слабые по
// одиночке и осмысленные только в связке (быстрая сдача + вставка текста +
// дословное совпадение), и трактовать их должен человек.
//
// Реальную работу делает не этот модуль, а устройство задания: локализация
// находки мышью, оценка пути обследования, предварительная фиксация
// диагноза и лимит времени (см. attemptPolicy.js). Списывать становится не
// столько опасно, сколько бесполезно.

/** Порог дословного совпадения: доля общих пятисловных цепочек. */
export const VERBATIM_THRESHOLD = 0.18;
/** Доля попытки, проведённая вне вкладки, после которой это стоит заметить. */
export const AWAY_SHARE_THRESHOLD = 0.3;
/** Сдача быстрее этой доли от средней длительности кейса — подозрительно. */
export const FAST_SHARE_THRESHOLD = 0.35;
/** Минимум сданных попыток по кейсу, чтобы средней длительности верить. */
export const FAST_MIN_SAMPLE = 5;
/** Вставка длиннее — уже похоже на перенесённый готовый ответ. */
export const PASTE_CHARS_THRESHOLD = 200;

const SHINGLE = 5;

function int(value, max = 10 ** 9) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), max);
}

/**
 * Приводит в порядок то, что прислал клиент. Данные не доверенные: клиент
 * может занизить их или не прислать вовсе, поэтому отсутствие сигнала
 * никогда не трактуется как «всё чисто» — только как «нет данных».
 */
export function normalizeSignals(raw = {}) {
  return {
    pasteEvents: int(raw.pasteEvents, 1000),
    pastedChars: int(raw.pastedChars, 10 ** 6),
    hiddenMs: int(raw.hiddenMs, 10 ** 8),
    focusLosses: int(raw.focusLosses, 10000),
    reported: Boolean(raw && Object.keys(raw).length),
  };
}

/** Слова текста в нормальном виде: регистр и пунктуация не мешают сравнению. */
function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Множество цепочек по n слов — по ним и ищется дословность. */
export function shingles(text, n = SHINGLE) {
  const w = words(text);
  if (w.length < n) return new Set();
  const out = new Set();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * Доля цепочек ответа, дословно встречающихся в эталонном тексте. Считаем
 * от ответа врача, а не от объединения: длинный эталон не должен размывать
 * короткое, но дословно списанное заключение.
 *
 * Совпадение смысла тут не при чём — правильные ответы естественно похожи.
 * Пятисловные цепочки совпадают у двух независимых авторов редко.
 */
export function verbatimOverlap(answerText, referenceText) {
  const a = shingles(answerText);
  if (a.size === 0) return 0;
  const b = shingles(referenceText);
  if (b.size === 0) return 0;
  let common = 0;
  for (const s of a) if (b.has(s)) common += 1;
  return common / a.size;
}

/**
 * Оценка попытки по сигналам.
 *
 * @param {object} a
 * @param {object} a.signals        сырое от клиента
 * @param {number|null} a.durationMs
 * @param {number|null} a.avgDurationMs   средняя длительность по кейсу
 * @param {number} a.sampleSize          сколько попыток в этой средней
 * @param {string} a.answerText          свободный текст врача
 * @param {string} [a.expertText]        эталонный текст автора (до сдачи не виден)
 * @param {string} [a.aiBaselineText]    типовой ответ чат-бота на этот кейс
 * @param {boolean} [a.firstCountedAttempt] первая ли зачётная попытка по кейсу
 * @returns {object} подпакет для attempt.integrity
 */
export function assessIntegrity({
  signals = {},
  durationMs = null,
  avgDurationMs = null,
  sampleSize = 0,
  answerText = "",
  expertText = "",
  aiBaselineText = "",
  firstCountedAttempt = true,
} = {}) {
  const s = normalizeSignals(signals);
  const flags = [];

  if (s.pastedChars >= PASTE_CHARS_THRESHOLD) flags.push("paste");

  const awayShare =
    durationMs > 0 ? Math.min(1, s.hiddenMs / durationMs) : null;
  if (awayShare != null && awayShare >= AWAY_SHARE_THRESHOLD) flags.push("away");

  const tooFast =
    durationMs > 0 &&
    avgDurationMs > 0 &&
    sampleSize >= FAST_MIN_SAMPLE &&
    durationMs < avgDurationMs * FAST_SHARE_THRESHOLD;
  if (tooFast) flags.push("too_fast");

  // Дословность сверяем только на ПЕРВОЙ зачётной попытке: в повторной врач
  // уже видел эталон в разборе, и совпадение там ожидаемо, а не подозрительно.
  const expertOverlap = firstCountedAttempt ? verbatimOverlap(answerText, expertText) : 0;
  const aiOverlap = verbatimOverlap(answerText, aiBaselineText);
  if (expertOverlap >= VERBATIM_THRESHOLD) flags.push("verbatim_expert");
  if (aiOverlap >= VERBATIM_THRESHOLD) flags.push("verbatim_ai");

  return {
    pasteEvents: s.pasteEvents,
    pastedChars: s.pastedChars,
    hiddenMs: s.hiddenMs,
    focusLosses: s.focusLosses,
    clientReported: s.reported,
    awayShare: awayShare == null ? null : Math.round(awayShare * 100) / 100,
    tooFast,
    expertOverlap: Math.round(expertOverlap * 100) / 100,
    aiOverlap: Math.round(aiOverlap * 100) / 100,
    flags,
    // Связка сигналов весомее одиночного: одна вставка объясняется
    // удобством, вставка вместе с быстрой сдачей и дословностью — уже нет.
    needsAttention: flags.length >= 2,
  };
}
