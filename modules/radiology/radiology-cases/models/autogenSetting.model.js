// server/modules/radiology/radiology-cases/models/autogenSetting.model.js
//
// ВЫКЛЮЧАТЕЛЬ НОЧНОЙ АВТОГЕНЕРАЦИИ, КОТОРЫЙ ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК.
//
// До сих пор ночную генерацию можно было выключить только переменной
// RADIOLOGY_AUTOGEN=off в .env, а это значит: зайти по SSH, поправить файл,
// сделать pm2 restart all --update-env. Владелец продукта не должен ходить в
// консоль, чтобы перестать тратить деньги на кейсы, которые он не успевает
// разбирать.
//
// ПОЧЕМУ В БАЗЕ, А НЕ В ПАМЯТИ. Флаг в переменной процесса умирает вместе с
// перезапуском сервера — и генерация, которую владелец выключил вечером,
// сама включилась бы ночью после любого рестарта. Это худший вид сюрприза:
// счёт приходит за то, что считалось отключённым.
//
// ДВА ВЫКЛЮЧАТЕЛЯ, И ЭТО НАМЕРЕННО:
//   • .env RADIOLOGY_AUTOGEN=off — аварийный, жёстче: не даёт даже
//     зарегистрировать cron. Нужен, когда что-то пошло не так на сервере.
//   • эта запись — рабочий, из интерфейса: cron остаётся, но при
//     срабатывании ничего не делает. Включается обратно одной кнопкой.
// Выключено, если выключен ХОТЬ ОДИН: разрешать генерацию вопреки явному
// запрету в .env нельзя.

import mongoose from "mongoose";

const { Schema } = mongoose;

const autogenSettingSchema = new Schema(
  {
    // Ключ на случай, если у арены появятся другие переключатели: запись
    // одна на область, а не одна на всю базу.
    key: { type: String, required: true, unique: true, default: "radiology" },
    enabled: { type: Boolean, default: true },

    // СКОЛЬКО КЕЙСОВ ЗА НОЧЬ НА КАЖДУЮ СТАНЦИЮ.
    //
    // Раньше количество было зашито: по кейсу на КАЖДУЮ лучевую модальность
    // (их пять) плюс по одному на «Анализы» и «Виртуального пациента» —
    // семь обращений к дорогой модели за ночь, и уменьшить это можно было
    // только выключив генерацию целиком. Владелец оказывался перед выбором
    // «семь или ноль», хотя разбирать он успевает один-два.
    //
    // Ноль — законное значение: станция просто пропускается. Потолок в
    // десять — защита от опечатки, которая стоит денег: набранное случайно
    // «100» превратилось бы в счёт за сотню кейсов к утру.
    perNight: {
      radiology: { type: Number, default: 5, min: 0, max: 10 },
      labs: { type: Number, default: 1, min: 0, max: 10 },
      vp: { type: Number, default: 1, min: 0, max: 10 },
    },

    // ПОТОЛОК АГЕНТА СБОРКИ КЕЙСА — самая дорогая операция арены.
    //
    // Агент крутит цикл «исправь замечания → перепроверь», и каждый круг
    // это два обращения к Opus с рассуждением и снимком в контексте. По
    // умолчанию ему отведено 13 минут: измеренный прогон уложил в них
    // ДВЕНАДЦАТЬ вызовов и всё равно остановился по таймауту, оставив пять
    // замечаний. Владельцу это стоило около доллара за один кейс — и узнать
    // об этом он мог только по счёту.
    //
    // Меняется отсюда, а не переменной окружения: решение о расходе не
    // должно требовать SSH и перезапуска сервера.
    agent: {
      maxRounds: { type: Number, default: 3, min: 1, max: 5 },
      deadlineMin: { type: Number, default: 13, min: 2, max: 20 },
    },
    // Кто и когда переключил — вопрос «почему ночью ничего не сгенерировалось»
    // возникает через неделю, и ответ на него должен быть в базе, а не в
    // памяти того, кто нажал.
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "radiology_autogen_settings" },
);

const AutogenSetting =
  mongoose.models.RadiologyAutogenSetting ||
  mongoose.model("RadiologyAutogenSetting", autogenSettingSchema);

export default AutogenSetting;

/**
 * Разрешена ли автогенерация хранимой настройкой.
 *
 * Записи нет — считаем разрешённой: так ведёт себя свежая установка, где
 * никто ничего не выключал. Ошибка чтения базы тоже трактуется как «можно»:
 * пропустить ночь из-за мигнувшей сети хуже, чем сгенерировать лишний кейс.
 */
export async function isAutogenAllowedByStore() {
  try {
    const doc = await AutogenSetting.findOne({ key: "radiology" }).lean();
    return doc ? doc.enabled !== false : true;
  } catch {
    return true;
  }
}

/** Потолок агента по умолчанию — прежнее поведение до появления настройки. */
export const DEFAULT_AGENT_LIMITS = { maxRounds: 3, deadlineMin: 13 };

/**
 * Потолок агента сборки кейса: сколько кругов правки и сколько минут.
 *
 * Недоступность базы трактуем как «прежние значения», а не как ноль:
 * оставить владельца без агента из-за мигнувшей сети хуже, чем потратить
 * столько же, сколько тратили вчера.
 */
export async function getAgentLimits() {
  try {
    const doc = await AutogenSetting.findOne({ key: "radiology" }).lean();
    const saved = doc?.agent || {};
    const clamp = (v, fallback, lo, hi) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(lo, Math.min(hi, Math.round(n)));
    };
    return {
      maxRounds: clamp(saved.maxRounds, DEFAULT_AGENT_LIMITS.maxRounds, 1, 5),
      deadlineMin: clamp(saved.deadlineMin, DEFAULT_AGENT_LIMITS.deadlineMin, 2, 20),
    };
  } catch {
    return { ...DEFAULT_AGENT_LIMITS };
  }
}

/** Сохранить потолок агента. Возвращает применённые значения. */
export async function setAgentLimits(limits, actorId = null) {
  const clamp = (v, fallback, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  };
  const current = await getAgentLimits();
  const next = {
    maxRounds: clamp(limits?.maxRounds, current.maxRounds, 1, 5),
    deadlineMin: clamp(limits?.deadlineMin, current.deadlineMin, 2, 20),
  };
  await AutogenSetting.findOneAndUpdate(
    { key: "radiology" },
    { agent: next, updatedBy: actorId },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return next;
}

/** Значения по умолчанию — ровно прежнее поведение до появления настройки. */
export const DEFAULT_PER_NIGHT = { radiology: 5, labs: 1, vp: 1 };

/**
 * Сколько кейсов генерировать за ночь на каждую станцию.
 *
 * Записи нет или база недоступна — возвращаем прежнее поведение, а не ноль:
 * молча перестать генерировать из-за мигнувшей сети хуже, чем сделать
 * лишний кейс. Тот же принцип, что у выключателя выше.
 */
export async function getPerNight() {
  try {
    const doc = await AutogenSetting.findOne({ key: "radiology" }).lean();
    const saved = doc?.perNight || {};
    const clamp = (v, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(10, Math.round(n)));
    };
    return {
      radiology: clamp(saved.radiology, DEFAULT_PER_NIGHT.radiology),
      labs: clamp(saved.labs, DEFAULT_PER_NIGHT.labs),
      vp: clamp(saved.vp, DEFAULT_PER_NIGHT.vp),
    };
  } catch {
    return { ...DEFAULT_PER_NIGHT };
  }
}

/** Сохранить количества. Возвращает применённые значения после ограничений. */
export async function setPerNight(counts, actorId = null) {
  const clamp = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(10, Math.round(n)));
  };
  const current = await getPerNight();
  const next = {
    radiology: clamp(counts?.radiology, current.radiology),
    labs: clamp(counts?.labs, current.labs),
    vp: clamp(counts?.vp, current.vp),
  };
  await AutogenSetting.findOneAndUpdate(
    { key: "radiology" },
    { perNight: next, updatedBy: actorId },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return next;
}

/** Переключить и вернуть новое значение. */
export async function setAutogenAllowed(enabled, actorId = null) {
  const doc = await AutogenSetting.findOneAndUpdate(
    { key: "radiology" },
    { enabled: Boolean(enabled), updatedBy: actorId },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return doc.enabled !== false;
}
