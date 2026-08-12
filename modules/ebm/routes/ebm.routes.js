// server/modules/ebm/routes/ebm.routes.js
//
// HTTP-контур поиска доказательств. Контроллера отдельным файлом нет намеренно
// (как в medicalCodes): здесь нет бизнес-логики, только разбор параметров и
// вызов сервиса.

import express from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import {
  searchEvidence,
  EVIDENCE_LEVELS,
} from "../services/evidence.service.js";

const router = express.Router();

// Лимит жёстче, чем у справочника кодов, и по другой причине.
//
// Один поиск — до шести обращений к NCBI, а лимит NCBI считается на IP
// СЕРВЕРА и общий на весь проект: перебор одним врачом отнимает PubMed у всех
// остальных. Ключ — идентификатор пользователя, а не адрес: врачи одной
// клиники сидят за общим NAT, и лимит по IP наказал бы их за соседа.
//
// Лимитер стоит после авторизации (см. index.js модуля), поэтому userId здесь
// заведомо есть.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.EBM_SEARCH_RPM ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.ebmActor?.userId || "anonymous"),
  skip: () => process.env.NODE_ENV === "test",
  message: {
    error:
      "Слишком много запросов к PubMed. Подождите минуту — лимит общий на весь проект.",
  },
});

const MAX_PER_LEVEL = 20;
const MAX_YEARS_BACK = 50;

/**
 * GET /api/v1/ebm/levels
 *
 * Справочник ступеней доказательности — чтобы фронт не хранил у себя копию
 * названий и порядка. Порядок здесь смысловой, а не алфавитный.
 */
router.get("/levels", (req, res) => {
  res.json({
    levels: EVIDENCE_LEVELS.map(({ key, title, rank, note }) => ({
      key,
      title,
      rank,
      note,
    })),
  });
});

/**
 * GET /api/v1/ebm/search?q=metformin+prediabetes&years=5&perLevel=5
 *
 * Запрос уходит в PubMed как есть — синтаксис PubMed поддерживается целиком
 * (AND/OR/NOT, [tiab], [mh]), и опытный врач может им пользоваться.
 *
 * levels — необязательный список ступеней через запятую. Нужен, чтобы
 * запросить одну ступень отдельно, не вызывая все шесть обращений к NCBI.
 */
router.get(
  "/search",
  searchLimiter,
  asyncHandler(async (req, res) => {
    const term = String(req.query.q || "").trim();
    if (term.length < 3) {
      throw new ValidationError("Запрос слишком короткий — минимум 3 символа");
    }

    const perLevel = clampInt(req.query.perLevel, 5, 1, MAX_PER_LEVEL);
    const yearsBack = clampInt(req.query.years, 0, 0, MAX_YEARS_BACK);

    const levels = String(req.query.levels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const known = new Set(EVIDENCE_LEVELS.map((l) => l.key));
    const unknown = levels.filter((l) => !known.has(l));
    if (unknown.length > 0) {
      throw new ValidationError(`Неизвестные ступени: ${unknown.join(", ")}`);
    }

    const result = await searchEvidence({
      term,
      perLevel,
      yearsBack,
      levels: levels.length > 0 ? levels : null,
    });

    res.json(result);
  }),
);

/**
 * Число из query в разумных границах.
 *
 * Молча зажимаем, а не отвергаем: perLevel=1000 — это не попытка сломать, а
 * желание увидеть побольше, и отвечать на него ошибкой невежливо. А вот
 * пропустить нельзя: perLevel уходит в retmax NCBI.
 */
function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export default router;
