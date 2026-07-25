// server/modules/radiology/game/game.service.js
//
// «Диагностическая арена» — игровой слой поверх попыток. Начисляет XP за
// сданную попытку, ведёт ранг, серию дней и достижения, отдаёт лидерборд и
// «кейс дня».
//
// Очки берём из уже посчитанного детерминированного балла попытки — своей
// оценки арена не изобретает, только переводит её в прогресс.

import RadiologyPlayer from "./radiologyPlayer.model.js";
import RadiologyCase from "../radiology-cases/models/radiologyCase.model.js";
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
}) {
  const player =
    (await RadiologyPlayer.findOne({ userId })) ||
    new RadiologyPlayer({ userId });

  const rankBefore = computeRank(player.xp).index;
  const pointsAwarded = pointsFor(score, passed);
  player.xp += pointsAwarded;
  player.casesCompleted += 1;
  if ((score ?? 0) > player.bestScore) player.bestScore = score;

  // Серия дней.
  const today = dayString(new Date());
  const yesterday = dayString(new Date(Date.now() - 86400000));
  if (player.lastPlayedDay !== today) {
    player.streak = player.lastPlayedDay === yesterday ? player.streak + 1 : 1;
    player.lastPlayedDay = today;
    if (player.streak > player.longestStreak) player.longestStreak = player.streak;
  }

  const unlocked = evaluateAchievements(player, {
    score,
    passed,
    falseAlarms,
    caughtCritical,
    perfect: (score ?? 0) >= 0.999,
  });

  const rankAfter = computeRank(player.xp);
  await player.save();

  return {
    pointsAwarded,
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
  }));
}

export async function getDailyCase() {
  return pickFeaturedCase(Math.floor(Date.now() / 86400000));
}

// «Кейс недели» — тот же детерминированный выбор, но по номеру недели: один
// на 7 дней. По нему идёт еженедельная рассылка (jobs/radiologyWeeklyCase).
export async function getWeeklyCase() {
  return pickFeaturedCase(Math.floor(Date.now() / (7 * 86400000)));
}

async function pickFeaturedCase(seed) {
  const published = await RadiologyCase.find({ status: "published" })
    .select("_id title modality difficulty images")
    .sort({ createdAt: 1 })
    .lean();
  if (published.length === 0) return null;
  const c = published[seed % published.length];
  return {
    _id: c._id,
    title: c.title,
    modality: c.modality,
    difficulty: c.difficulty,
    thumb: c.images?.[0]?.url ?? null,
  };
}
