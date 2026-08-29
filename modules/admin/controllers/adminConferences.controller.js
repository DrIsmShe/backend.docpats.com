// modules/admin/controllers/adminConferences.controller.js
//
// Модерация конференций из админки. Всё под requireAdmin.
//
// ПОЧЕМУ ПРОКСИ, А НЕ ПРЯМОЙ ВЫЗОВ ИЗ БРАУЗЕРА. Сами карточки живут в
// новостном движке, и его admin-эндпоинты закрыты общим секретом
// (INTERNAL_API_TOKEN). Отдать этот секрет в браузер нельзя: он лежал бы в
// исходниках фронта и открывал бы платные эндпоинты движка кому угодно.
// Поэтому браузер разговаривает с backend по сессии, а backend — с движком
// по токену.

import axios from "axios";

const NEWS_ENGINE_URL = process.env.NEWS_ENGINE_URL || "http://localhost:5010";

function engine({ timeoutMs = 15000 } = {}) {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) {
    // Закрываемся, а не открываемся: без токена движок всё равно ответит
    // 401, и понятное сообщение лучше загадочной ошибки на экране.
    const err = new Error("INTERNAL_API_TOKEN не задан на backend");
    err.statusCode = 503;
    throw err;
  }
  return axios.create({
    baseURL: `${NEWS_ENGINE_URL}/api/conferences`,
    timeout: timeoutMs,
    headers: { "x-internal-token": token },
  });
}

function fail(res, err, fallback) {
  const status = err.statusCode || err.response?.status || 502;
  const message =
    err.response?.data?.message ||
    (err.code === "ECONNREFUSED" ? "Новостной движок недоступен" : err.message) ||
    fallback;
  console.error("adminConferences:", status, message);
  return res.status(status).json({ success: false, message });
}

// ─── GET /admin/conferences?status=draft ──────────────────────────────
export async function listConferencesForModeration(req, res) {
  try {
    const { status = "draft", limit = 50 } = req.query;
    const r = await engine().get("/admin/drafts", { params: { status, limit } });
    return res.json({ success: true, items: r.data.items || [], total: r.data.total || 0 });
  } catch (err) {
    return fail(res, err, "Не удалось загрузить конференции");
  }
}

// ─── POST /admin/conferences ──────────────────────────────────────────
// Ручное добавление. Нужно не «на всякий случай»: пока ингестии нет, это
// единственный способ наполнить рубрику, а когда появится — способ добавить
// то, что источники не отдают.
export async function createConference(req, res) {
  try {
    const r = await engine().post("/admin/ingest", req.body || {});
    return res.status(r.status === 201 ? 201 : 200).json({ success: true, ...r.data });
  } catch (err) {
    return fail(res, err, "Не удалось создать карточку");
  }
}

// ─── POST /admin/conferences/run-ingestion ────────────────────────────
// Обход сайтов обществ по кнопке. body: { slug? } — один источник или все.
//
// Запрос синхронный и долгий: двенадцать источников это двенадцать
// загруженных страниц и столько же вызовов модели, несколько минут. Если
// прокси оборвёт соединение раньше, ничего не потеряется — обход идёт в
// движке и доведётся до конца, а карточки просто появятся в очереди:
// достаточно нажать «Обновить». Поэтому таймаут щедрый, а не бесконечный.
export async function runIngestion(req, res) {
  try {
    const body = req.body?.slug ? { slug: req.body.slug } : {};
    const r = await engine({ timeoutMs: 10 * 60 * 1000 }).post("/admin/ingest-run", body);
    return res.json({ success: true, ...r.data });
  } catch (err) {
    if (err.code === "ECONNABORTED") {
      return res.status(504).json({
        success: false,
        message:
          "Обход идёт дольше ожидания. Он продолжается в движке — нажмите «Обновить» через пару минут.",
      });
    }
    return fail(res, err, "Не удалось запустить обход");
  }
}

// ─── PATCH /admin/conferences/:id ─────────────────────────────────────
// body: { status: "published" | "rejected" | "draft", rejectedReason? }
export async function moderateConference(req, res) {
  try {
    const { status, rejectedReason = "" } = req.body || {};
    const r = await engine().patch(`/admin/${req.params.id}/moderate`, {
      status,
      rejectedReason,
    });
    return res.json({ success: true, ...r.data });
  } catch (err) {
    return fail(res, err, "Действие не выполнено");
  }
}
