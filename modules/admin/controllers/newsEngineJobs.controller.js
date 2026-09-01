// server/modules/admin/controllers/newsEngineJobs.controller.js
//
// Управление фоновыми задачами движка новостей из админки DocPats.
//
// ЗАЧЕМ ПОСРЕДНИК, А НЕ ПРЯМОЙ ЗАПРОС ИЗ БРАУЗЕРА. Статьи на
// docpats.com/articles делает отдельная служба — backend.docpats-ai-news.com,
// и её управление закрыто внутренним токеном. Пойди браузер туда напрямую,
// токен пришлось бы отдать странице, а значит и любому, кто откроет её
// исходники: остановить генерацию смог бы кто угодно.
//
// Поэтому браузер разговаривает со своим сервером, где уже проверена роль
// администратора, а токен подставляется здесь и наружу не выходит.
//
// ЧТО БУДЕТ, ЕСЛИ ДВИЖОК НЕДОСТУПЕН. Ответ говорит об этом прямо, а не
// делает вид, что всё в порядке. Молчаливое «сохранено» при недоступной
// службе — худшее, что может сделать панель управления: владелец решит,
// что генерация остановлена, а она продолжит тратить деньги.

import {
  getLocalSwitches,
  setLocalSwitches,
  LOCAL_JOBS,
  LOCAL_JOB_TITLES,
} from "../services/localJobSwitches.service.js";

const ENGINE_TIMEOUT_MS = 15000;

function engineBase() {
  const base = process.env.NEWS_ENGINE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

async function callEngine(path, { method = "GET", body } = {}) {
  const base = engineBase();
  const token = process.env.NEWS_ENGINE_TOKEN;

  if (!base || !token) {
    const err = new Error(
      "Управление движком не настроено: нужны NEWS_ENGINE_URL и NEWS_ENGINE_TOKEN",
    );
    err.status = 503;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "x-internal-token": token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.message || `Движок ответил ${res.status}`);
      err.status = res.status === 401 ? 502 : res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("Движок не ответил вовремя");
      e.status = 504;
      throw e;
    }
    if (!err.status) {
      const e = new Error(`Движок недоступен: ${err.message}`);
      e.status = 502;
      throw e;
    }
    throw err;
  }
}

/** Задачи самого DocPats — в том же виде, что и задачи движка. */
function localJobList(state) {
  return LOCAL_JOBS.map((id) => ({
    id,
    title: LOCAL_JOB_TITLES[id],
    enabled: state[id] !== false,
    where: "docpats",
  }));
}

/**
 * Состояние всех переключателей: и движка, и своих.
 *
 * Свои читаются ВСЕГДА, даже если движок недоступен: иначе недоступность
 * чужой службы лишала бы владельца управления собственным переводом —
 * ровно тогда, когда остановить его нужнее всего.
 */
export async function getEngineJobs(req, res) {
  const local = await getLocalSwitches({ fresh: true });
  const localJobs = localJobList(local);

  try {
    const data = await callEngine("/api/job-switches");
    return res.json({
      ...data,
      jobs: [
        ...(data.jobs || []).map((j) => ({ ...j, where: "engine" })),
        ...localJobs,
      ],
    });
  } catch (err) {
    // Движок молчит — отдаём хотя бы своё, и честно говорим почему.
    return res.status(200).json({
      success: true,
      jobs: localJobs,
      engineError: err.message,
      updatedBy: local.updatedBy,
      lastChange: local.lastChange,
      updatedAt: local.updatedAt,
    });
  }
}

/**
 * Переключить задачи. Тело: { synthesis: false, ... }
 *
 * Каждый ключ уходит туда, где эта задача живёт. Разделение здесь, а не в
 * браузере: панель не должна знать, что часть задач в другой службе.
 */
export async function setEngineJobs(req, res) {
  const by = req.userId || "admin";
  const body = req.body || {};

  const localPatch = {};
  const enginePatch = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "boolean") continue;
    if (LOCAL_JOBS.includes(key)) localPatch[key] = value;
    else enginePatch[key] = value;
  }

  try {
    const { state: local } = await setLocalSwitches(localPatch, by);
    const localJobs = localJobList(local);

    // В движок идём, только если для него что-то есть: лишний сетевой
    // запрос на каждое переключение своей задачи ни к чему.
    if (!Object.keys(enginePatch).length) {
      return res.json({
        success: true,
        jobs: localJobs,
        updatedBy: local.updatedBy,
        lastChange: local.lastChange,
        updatedAt: local.updatedAt,
      });
    }

    const data = await callEngine("/api/job-switches", {
      method: "PUT",
      // Кто переключил — уходит в движок и остаётся там в истории.
      // Без этого через месяц не понять, почему генерация стоит.
      body: { ...enginePatch, by },
    });

    return res.json({
      ...data,
      jobs: [
        ...(data.jobs || []).map((j) => ({ ...j, where: "engine" })),
        ...localJobs,
      ],
    });
  } catch (err) {
    return res
      .status(err.status || 500)
      .json({ success: false, message: err.message });
  }
}
