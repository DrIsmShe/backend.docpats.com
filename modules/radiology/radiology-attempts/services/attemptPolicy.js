// server/modules/radiology/radiology-attempts/services/attemptPolicy.js
//
// ПРАВИЛА ПОПЫТКИ — единственный источник истины для всех трёх станций
// арены (снимки, «Анализы», «Виртуальный пациент»). Здесь решается, что
// считается зачётом, когда доступна следующая зачётная попытка и сколько
// времени даётся. Станции спрашивают этот модуль, а не решают сами: три
// копии этих правил разъехались бы на первой же правке.
//
// Зачем правила вообще. Раньше повторное прохождение было ничем не
// ограничено, и это ломало две вещи. XP начислялся за каждую сдачу, так что
// один кейс, пройденный десять раз после раскрытия эталона, накручивал ранг.
// Средний балл кейса считался по всем попыткам подряд, включая повторы «уже
// знаю ответ», — и авторам нельзя было верить цифрам сложности.
//
// Модель, которая это лечит:
//
//   Тренировка (learn) — не в зачёт. Без таймера, сколько угодно раз, ИИ
//   разрешён открыто. XP не начисляется, статистика кейса не меняется.
//   Это инструмент разбора, а не измерение.
//
//   Зачёт (exam) — измерение. Таймер, одна зачётная попытка на кейс раз в
//   24 часа, без подсказок. XP, ранг, лидерборд, статистика кейса и очередь
//   повторения — только отсюда.
//
// Отсчёт 24 часов идёт от НАЧАЛА зачётной попытки, а не от сдачи. Иначе
// зачёт можно было бы «отменить»: начал, увидел трудный кейс, не сдал —
// и слот вернулся. Обратная сторона: брошенная зачётная попытка сгорает
// вместе со слотом, и врач должен знать об этом ЗАРАНЕЕ — поэтому политика
// отдаётся клиенту до старта (previewPolicy), а не после.
//
// Незакрытая попытка в пределах лимита времени переиспользуется: закрыл
// вкладку и вернулся — продолжаешь ту же попытку, а не начинаешь новую с
// чистого листа. Это и защита от накрутки, и порядок в базе (раньше каждое
// открытие страницы плодило запись in_progress, и никто их не чистил).

import { ATTEMPT_MODES } from "../../constants.js";

/** Режим, попытки которого идут в зачёт. */
export const COUNTED_MODE = "exam";
export const TRAINING_MODE = "learn";

/** Сколько ждать между зачётными попытками по одному кейсу. */
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Множитель XP за повторную зачётную попытку. Улучшать результат выгодно,
 * но перепройти освоенный кейс ради очков — почти нет.
 */
export const REPEAT_XP_FACTOR = 0.3;

/**
 * Лимит времени зачётной попытки по станциям, если у кейса не задан свой.
 * Смысл лимита не в спешке, а в том, что поход в чат за ответом (скопировать
 * условие, дождаться ответа, перенести обратно) съедает его заметную часть.
 */
export const DEFAULT_TIME_LIMIT_SEC = {
  radiology: 420, // 7 минут на чтение снимка
  labs: 300, // 5 минут на панель анализов
  vp: 900, // 15 минут: здесь ещё и заказ обследований
};

/**
 * Почему попытка в зачёт или не в зачёт. Клиент переводит эти ключи в текст:
 *   first    — первая зачётная по кейсу, полный XP и статистика кейса;
 *   repeat   — повторная зачётная (прошло 24 ч), XP частичный;
 *   training — тренировка, вне зачёта по выбору врача;
 *   cooldown — зачёт по этому кейсу уже был меньше 24 часов назад;
 *   late     — сдано после истечения лимита времени.
 */
export const COUNTED_REASONS = ["first", "repeat", "training", "cooldown", "late"];

/**
 * Лимит времени для попытки. В тренировке лимита нет намеренно: разбирать
 * кейс надо спокойно, а измерения из тренировки всё равно никуда не идут.
 */
export function timeLimitFor({ station, mode, caseTimeLimitSec = null }) {
  if (mode !== COUNTED_MODE) return null;
  if (caseTimeLimitSec > 0) return caseTimeLimitSec;
  return DEFAULT_TIME_LIMIT_SEC[station] ?? 600;
}

export function normalizeMode(mode) {
  return ATTEMPT_MODES.includes(mode) ? mode : TRAINING_MODE;
}

/**
 * Решение о зачётности. Отдельная чистая функция — её удобно проверять
 * тестами без базы.
 *
 * @param {object} a
 * @param {string} a.mode                 learn | exam
 * @param {Date|null} a.lastCountedStart   начало последней зачётной попытки
 * @param {boolean} a.hadCounted           была ли зачётная попытка вообще
 * @param {Date} a.now
 * @returns {{counted: boolean, reason: string, nextCountedAt: Date|null,
 *            isFirstCounted: boolean}}
 */
export function decideCounted({ mode, lastCountedStart = null, hadCounted = false, now = new Date() }) {
  if (mode !== COUNTED_MODE) {
    return { counted: false, reason: "training", nextCountedAt: null, isFirstCounted: false };
  }
  if (!hadCounted) {
    return { counted: true, reason: "first", nextCountedAt: null, isFirstCounted: true };
  }
  const anchor = lastCountedStart ? new Date(lastCountedStart).getTime() : 0;
  const readyAt = anchor + COOLDOWN_MS;
  if (now.getTime() >= readyAt) {
    return { counted: true, reason: "repeat", nextCountedAt: null, isFirstCounted: false };
  }
  return {
    counted: false,
    reason: "cooldown",
    nextCountedAt: new Date(readyAt),
    isFirstCounted: false,
  };
}

/**
 * Последняя зачётная попытка и общее число сданных — из модели станции.
 * Модель передаётся аргументом, чтобы модуль не знал про станции (тот же
 * приём, что у canFor в common/auth).
 */
async function countedHistory({ AttemptModel, caseId, userId }) {
  const [lastCounted, submittedCount] = await Promise.all([
    AttemptModel.findOne({ caseId, userId, counted: true })
      .sort({ startedAt: -1 })
      .select("startedAt submittedAt score.total")
      .lean(),
    AttemptModel.countDocuments({ caseId, userId, status: "submitted" }),
  ]);
  return { lastCounted, submittedCount };
}

/**
 * Что показать врачу ДО старта: в зачёт ли пойдёт попытка, сколько времени
 * даётся, когда откроется следующая зачётная. Без побочных эффектов —
 * страница задания зовёт это, чтобы напечатать условия честно и заранее.
 */
export async function previewPolicy({
  AttemptModel,
  station,
  caseId,
  userId,
  mode = TRAINING_MODE,
  caseTimeLimitSec = null,
  // Веса компонентов и проходной балл станции. Отдаются клиенту, чтобы текст
  // правил на странице задания брал цифры отсюда, а не хранил свою копию:
  // разъехавшиеся правила хуже отсутствующих.
  scoring = null,
  now = new Date(),
}) {
  const normalizedMode = normalizeMode(mode);
  const { lastCounted, submittedCount } = await countedHistory({ AttemptModel, caseId, userId });
  const decision = decideCounted({
    mode: normalizedMode,
    lastCountedStart: lastCounted?.startedAt ?? null,
    hadCounted: Boolean(lastCounted),
    now,
  });

  // Незакрытая попытка: её продолжат, а не начнут новую.
  const resumable = await AttemptModel.findOne({ caseId, userId, status: "in_progress" })
    .sort({ startedAt: -1 })
    .select("_id mode counted startedAt deadlineAt timeLimitSec")
    .lean();

  return {
    station,
    mode: normalizedMode,
    attemptNo: submittedCount + 1,
    counted: decision.counted,
    countedReason: decision.reason,
    isFirstCounted: decision.isFirstCounted,
    nextCountedAt: decision.nextCountedAt,
    timeLimitSec: timeLimitFor({ station, mode: normalizedMode, caseTimeLimitSec }),
    cooldownMs: COOLDOWN_MS,
    repeatXpFactor: REPEAT_XP_FACTOR,
    scoring,
    // Лучший зачётный результат по кейсу — чтобы врач видел, что улучшает.
    lastCountedScore: lastCounted?.score?.total ?? null,
    resumable: resumable
      ? {
          attemptId: String(resumable._id),
          mode: resumable.mode ?? TRAINING_MODE,
          counted: Boolean(resumable.counted),
          startedAt: resumable.startedAt,
          deadlineAt: resumable.deadlineAt ?? null,
          expired: isExpired(resumable, now),
        }
      : null,
  };
}

/**
 * Поля попытки при старте: номер, зачётность, дедлайн. Возвращает то, что
 * станция кладёт в create() — сама она правил не считает.
 */
export async function resolveAttemptStart({
  AttemptModel,
  station,
  caseId,
  userId,
  mode = TRAINING_MODE,
  caseTimeLimitSec = null,
  now = new Date(),
}) {
  const normalizedMode = normalizeMode(mode);
  const { lastCounted, submittedCount } = await countedHistory({ AttemptModel, caseId, userId });
  const decision = decideCounted({
    mode: normalizedMode,
    lastCountedStart: lastCounted?.startedAt ?? null,
    hadCounted: Boolean(lastCounted),
    now,
  });
  const timeLimitSec = timeLimitFor({ station, mode: normalizedMode, caseTimeLimitSec });

  return {
    fields: {
      mode: normalizedMode,
      attemptNo: submittedCount + 1,
      counted: decision.counted,
      countedReason: decision.reason,
      isFirstCounted: decision.isFirstCounted,
      timeLimitSec,
      startedAt: now,
      deadlineAt: timeLimitSec ? new Date(now.getTime() + timeLimitSec * 1000) : null,
    },
    nextCountedAt: decision.nextCountedAt,
  };
}

/** Просрочена ли попытка (дедлайн зачётного режима прошёл). */
export function isExpired(attempt, now = new Date()) {
  if (!attempt?.deadlineAt) return false;
  return new Date(attempt.deadlineAt).getTime() < now.getTime();
}

/** Сколько секунд осталось; null — лимита нет. */
export function secondsLeft(attempt, now = new Date()) {
  if (!attempt?.deadlineAt) return null;
  return Math.max(0, Math.round((new Date(attempt.deadlineAt).getTime() - now.getTime()) / 1000));
}

/**
 * Множитель XP: тренировка — ноль, первая зачётная — полный, повторная
 * зачётная — доля. Начисление живёт в game.service, доля — здесь, рядом с
 * остальными правилами.
 */
export function xpFactorFor({ counted, isFirstCounted }) {
  if (!counted) return 0;
  return isFirstCounted ? 1 : REPEAT_XP_FACTOR;
}
