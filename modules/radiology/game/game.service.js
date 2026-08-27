// server/modules/radiology/game/game.service.js
//
// «Диагностическая арена» — игровой слой поверх попыток. Начисляет XP за
// сданную попытку, ведёт ранг, серию дней и достижения, отдаёт лидерборд и
// «кейс дня».
//
// Очки берём из уже посчитанного детерминированного балла попытки — своей
// оценки арена не изобретает, только переводит её в прогресс.

import RadiologyPlayer from "./radiologyPlayer.model.js";
import { xpFactorFor } from "../radiology-attempts/services/attemptPolicy.js";
import RadiologyCase from "../radiology-cases/models/radiologyCase.model.js";
import { translateCaseList } from "../translation/translatedCase.js";
import User from "../../../common/models/Auth/users.js";

// Ранги по накопленному XP. Пороги растут нелинейно — «Профессором»
// становятся не за пару вечеров.
export const RANKS = [
  { key: "student", title: "Студент", minXp: 0 },
  { key: "intern", title: "Интерн", minXp: 200 },
  { key: "resident", title: "Ординатор", minXp: 600 },
  { key: "doctor", title: "Врач", minXp: 1500 },
  { key: "expert", title: "Эксперт", minXp: 3500 },
  { key: "professor", title: "Профессор", minXp: 8000 },
];

export function computeRank(xp) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k += 1) {
    if (xp >= RANKS[k].minXp) i = k;
  }
  const current = RANKS[i];
  const next = RANKS[i + 1] ?? null;
  return {
    key: current.key,
    title: current.title,
    index: i,
    minXp: current.minXp,
    nextTitle: next?.title ?? null,
    // Ключ следующего ранга — чтобы клиент показал его название на своём
    // языке. title остаётся в ответе как запасной вариант и для тех, кто
    // читает API напрямую, но подпись в интерфейсе строится по ключу:
    // сервер не знает, каким языком пользуется читающий.
    nextKey: next?.key ?? null,
    nextAt: next?.minXp ?? null,
    progress: next ? (xp - current.minXp) / (next.minXp - current.minXp) : 1,
  };
}

// Достижения. check(player, att) — player уже обновлён этой попыткой, att —
// контекст самой попытки. Порядок = порядок показа.
export const ACHIEVEMENTS = [
  { key: "first_case", title: "Первый разбор", icon: "🎬", check: (p) => p.casesCompleted >= 1 },
  { key: "ten_cases", title: "Десятка", icon: "🔟", check: (p) => p.casesCompleted >= 10 },
  { key: "fifty_cases", title: "Полсотни", icon: "🏅", check: (p) => p.casesCompleted >= 50 },
  { key: "streak_3", title: "Три дня подряд", icon: "🔥", check: (p) => p.streak >= 3 },
  { key: "streak_7", title: "Неделя без пропусков", icon: "🔥", check: (p) => p.streak >= 7 },
  { key: "perfect", title: "Идеальное чтение", icon: "💯", check: (p, a) => a.perfect },
  { key: "sharp_eye", title: "Острый глаз", icon: "👁️", check: (p, a) => a.caughtCritical, desc: "Поймал критическую находку" },
  { key: "clean", title: "Без ложных тревог", icon: "🎯", check: (p, a) => a.passed && a.falseAlarms === 0 },
  { key: "rank_doctor", title: "Дослужился до Врача", icon: "🩺", check: (p) => computeRank(p.xp).index >= 3 },
  { key: "rank_professor", title: "Профессор", icon: "🎓", check: (p) => computeRank(p.xp).index >= 5 },
];

const ACH_META = new Map(
  ACHIEVEMENTS.map((a) => [a.key, { key: a.key, title: a.title, icon: a.icon }]),
);

function evaluateAchievements(player, att) {
  const have = new Set(player.achievements ?? []);
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.key)) continue;
    if (a.check(player, att)) {
      have.add(a.key);
      unlocked.push(ACH_META.get(a.key));
    }
  }
  player.achievements = [...have];
  return unlocked;
}

function pointsFor(score, passed) {
  return Math.max(1, Math.round((score ?? 0) * 100) + (passed ? 25 : 0));
}

function dayString(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/**
 * Начисление за сданную попытку. Вызывается из submitAttempt — тихо, не
 * роняя сдачу. Возвращает «награду» для экрана результата: сколько XP,
 * повысился ли ранг, серия, разблокированные достижения.
 *
 * @param {object} args
 * @param {number} args.score          балл попытки 0..1
 * @param {boolean} args.passed        зачёт
 * @param {number} [args.falseAlarms]  ложные отметки
 * @param {boolean} [args.caughtCritical] поймана ли критическая находка
 */
export async function awardForAttempt({
  userId,
  score,
  passed,
  falseAlarms = 0,
  caughtCritical = false,
  counted = false,
  isFirstCounted = false,
}) {
  const player =
    (await RadiologyPlayer.findOne({ userId })) ||
    new RadiologyPlayer({ userId });

  const rankBefore = computeRank(player.xp).index;

  // Тренировка — ноль XP, повторный зачёт — доля. Правило живёт в
  // attemptPolicy рядом с остальными условиями попытки, здесь только
  // начисление. Без этого один кейс, пройденный десять раз после разбора,
  // накручивал ранг и лидерборд.
  const factor = xpFactorFor({ counted, isFirstCounted });
  const pointsAwarded = factor > 0 ? Math.max(1, Math.round(pointsFor(score, passed) * factor)) : 0;
  player.xp += pointsAwarded;

  // Счётчик уникальных кейсов — только на первой зачётной попытке. Раньше он
  // считал сдачи, и достижение «Полсотни» брали одним кейсом.
  if (isFirstCounted) player.casesCompleted += 1;
  if (counted && (score ?? 0) > player.bestScore) player.bestScore = score;

  // Серия дней держится на любой сдаче, включая тренировочную: она про
  // регулярность занятий, а накрутить ею ранг нельзя.
  const today = dayString(new Date());
  const yesterday = dayString(new Date(Date.now() - 86400000));
  if (player.lastPlayedDay !== today) {
    player.streak = player.lastPlayedDay === yesterday ? player.streak + 1 : 1;
    player.lastPlayedDay = today;
    if (player.streak > player.longestStreak) player.longestStreak = player.streak;
  }

  // Достижения — только за зачётные попытки; «Идеальное чтение» на тренировке
  // после раскрытого разбора ничего не значит.
  const unlocked = counted
    ? evaluateAchievements(player, {
        score,
        passed,
        falseAlarms,
        caughtCritical,
        perfect: (score ?? 0) >= 0.999,
      })
    : [];

  const rankAfter = computeRank(player.xp);
  await player.save();

  return {
    pointsAwarded,
    counted,
    // Почему столько: клиент печатает это словами на экране результата.
    xpReason: counted ? (isFirstCounted ? "first_counted" : "repeat_counted") : "training",
    xp: player.xp,
    rank: rankAfter,
    rankedUp: rankAfter.index > rankBefore,
    streak: player.streak,
    casesCompleted: player.casesCompleted,
    unlocked,
  };
}

// Разовое начисление XP вне попытки (бонус за победу в дуэли и т.п.). Ранг
// пересчитается сам при следующем чтении профиля; серию/достижения не трогаем.
export async function addBonusXp(userId, points) {
  const player =
    (await RadiologyPlayer.findOne({ userId })) ||
    new RadiologyPlayer({ userId });
  player.xp += Math.max(0, Math.round(points));
  await player.save();
  return player.xp;
}

export async function getProfile(userId) {
  const player = await RadiologyPlayer.findOne({ userId }).lean();
  const p = player ?? {
    xp: 0,
    casesCompleted: 0,
    bestScore: 0,
    streak: 0,
    longestStreak: 0,
    achievements: [],
  };
  return {
    xp: p.xp,
    casesCompleted: p.casesCompleted,
    bestScore: p.bestScore,
    streak: p.streak,
    longestStreak: p.longestStreak,
    rank: computeRank(p.xp),
    achievements: (p.achievements ?? [])
      .map((k) => ACH_META.get(k))
      .filter(Boolean),
    // Сколько всего достижений есть в игре — чтобы показать «7 из 10».
    achievementsTotal: ACHIEVEMENTS.length,
  };
}

export async function getLeaderboard({ limit = 20 } = {}) {
  const players = await RadiologyPlayer.find({ xp: { $gt: 0 } })
    .sort({ xp: -1 })
    .limit(Math.min(limit, 100))
    .lean();

  const users = await User.find({
    _id: { $in: players.map((p) => p.userId) },
  })
    .select("_id firstName")
    .lean();
  const nameById = new Map(users.map((u) => [String(u._id), u.firstName || "Врач"]));

  return players.map((p, i) => ({
    place: i + 1,
    name: nameById.get(String(p.userId)) ?? "Врач",
    xp: p.xp,
    casesCompleted: p.casesCompleted,
    rank: computeRank(p.xp).title,
    rankKey: computeRank(p.xp).key,
  }));
}

export async function getDailyCase(lang = null) {
  return pickFeaturedCase(Math.floor(Date.now() / 86400000), lang);
}

// «Кейс недели» — тот же детерминированный выбор, но по номеру недели: один
// на 7 дней. По нему идёт еженедельная рассылка (jobs/radiologyWeeklyCase).
export async function getWeeklyCase(lang = null) {
  return pickFeaturedCase(Math.floor(Date.now() / (7 * 86400000)), lang);
}

// lang — язык врача. Витрина станции уже отдаёт кейсы переведёнными
// (case.service → translateCaseList), а «кейс дня» и «кейс недели» шли мимо
// этого слоя и брали title прямо из документа: в азербайджанском интерфейсе
// карточка сверху была русской, а тот же кейс в сетке ниже — переведённым.
//
// Проекция включает lang не для красоты: translateCaseList пропускает кейсы,
// уже написанные на нужном языке, а без поля они все считались бы русскими.
async function pickFeaturedCase(seed, lang = null) {
  const published = await RadiologyCase.find({ status: "published" })
    .select("_id title modality difficulty images lang")
    .sort({ createdAt: 1 })
    .lean();
  if (published.length === 0) return null;
  const picked = published[seed % published.length];
  const [c] = await translateCaseList("radiology", [picked], lang);
  return {
    _id: c._id,
    title: c.title,
    modality: c.modality,
    difficulty: c.difficulty,
    thumb: c.images?.[0]?.url ?? null,
  };
}
