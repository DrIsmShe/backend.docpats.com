// server/modules/admin/services/localJobSwitches.service.js
//
// Переключатели фоновых задач САМОГО DocPats.
//
// Часть задач живёт в движке новостей, часть здесь — и владельцу это
// различие неинтересно: он видит один список в панели. Поэтому устройство
// то же, что в движке, а сводит их вместе контроллер.
//
// Пока задача здесь одна: перевод статей врачей — и статей-мнений, и
// научных. Он идёт каждые десять минут и переводит весь накопленный
// корпус, то есть тратит деньги постоянно, а не разово. Именно его чаще
// всего и нужно уметь остановить.
//
// Значения по умолчанию — «включено»: пустая база не должна тихо
// остановить перевод.

import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    key: { type: String, default: "jobs", unique: true, index: true },
    doctorArticlesTranslation: { type: Boolean, default: true },
    updatedBy: { type: String, default: null },
    lastChange: { type: String, default: null },
  },
  { timestamps: true, collection: "local_job_switches" },
);

const LocalJobSwitch =
  mongoose.models.LocalJobSwitch || mongoose.model("LocalJobSwitch", schema);

export const LOCAL_JOBS = ["doctorArticlesTranslation"];

export const LOCAL_JOB_TITLES = {
  doctorArticlesTranslation: "Перевод статей врачей",
};

const CACHE_MS = 5000;
let cache = null;
let cachedAt = 0;

/** Текущее состояние. */
export async function getLocalSwitches({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < CACHE_MS) return cache;

  try {
    const doc = await LocalJobSwitch.findOneAndUpdate(
      { key: "jobs" },
      { $setOnInsert: { key: "jobs" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    cache = {
      ...Object.fromEntries(LOCAL_JOBS.map((j) => [j, doc[j] !== false])),
      updatedBy: doc.updatedBy || null,
      lastChange: doc.lastChange || null,
      updatedAt: doc.updatedAt || null,
    };
    cachedAt = Date.now();
    return cache;
  } catch (err) {
    console.error("[localJobSwitches] чтение:", err.message);
    // Неизвестное состояние означает «как было», а не «всё стоит»:
    // недоступная на минуту база не должна останавливать перевод.
    return Object.fromEntries(LOCAL_JOBS.map((j) => [j, true]));
  }
}

/** Включена ли задача. Зовётся из крона перед каждым проходом. */
export async function isLocalEnabled(job) {
  const s = await getLocalSwitches();
  return s[job] !== false;
}

/** Переключить. Возвращает новое состояние. */
export async function setLocalSwitches(patch, by = "admin") {
  const update = {};
  const changed = [];

  for (const job of LOCAL_JOBS) {
    if (typeof patch?.[job] !== "boolean") continue;
    update[job] = patch[job];
    changed.push(`${LOCAL_JOB_TITLES[job]}: ${patch[job] ? "вкл" : "выкл"}`);
  }

  if (!changed.length) return { state: await getLocalSwitches(), changed: [] };

  update.updatedBy = by;
  update.lastChange = changed.join(", ");

  await LocalJobSwitch.findOneAndUpdate(
    { key: "jobs" },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  cache = null;
  cachedAt = 0;

  console.log(`[localJobSwitches] ${by}: ${update.lastChange}`);
  return { state: await getLocalSwitches({ fresh: true }), changed };
}
