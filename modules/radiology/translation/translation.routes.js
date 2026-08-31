// server/modules/radiology/translation/translation.routes.js
//
// Управление переводами кейсов — для редактора. Общий роутер на все три
// станции: caseType идёт первым сегментом, потому что и модель, и логика
// «трогать / не трогать» у станций одна (translateCase.service.js).
//
// ЗАЧЕМ ЭТО НУЖНО, ЕСЛИ ПЕРЕВОД АВТОМАТИЧЕСКИЙ. Автоперевод делает работу, но
// не отчитывается: до этих роутов сервис перевода существовал, был покрыт
// тестами и вызывался при публикации, а наружу не выходил никак. Если модель
// отказывала на арабском, об этом знал только лог — в админке кейс выглядел
// нормально, а врач на арабском читал русский текст. Редактору нужно видеть
// состояние по каждому языку и уметь вмешаться.
//
// Всё под requireAuthor: это редакторский инструмент. Врачу здесь делать
// нечего — у него перевод происходит сам.

import express from "express";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { requireAuthor } from "../middlewares/radiologyAuth.js";
import { ARENA_CASE_TYPES, ARENA_LANGUAGES } from "./arenaCaseTranslation.model.js";
import {
  listCaseTranslations,
  translateCase,
  updateCaseTranslation,
  unreviewCaseTranslation,
} from "./translateCase.service.js";

const router = express.Router();

const BASE = "/translations/:caseType/:caseId";

function caseTypeOf(req) {
  const { caseType } = req.params;
  if (!ARENA_CASE_TYPES.includes(caseType)) {
    throw new ValidationError(
      `Неизвестная станция "${caseType}": ожидается ${ARENA_CASE_TYPES.join(", ")}`,
    );
  }
  return caseType;
}

function langOfParam(req) {
  const { lang } = req.params;
  if (!ARENA_LANGUAGES.includes(lang)) {
    throw new ValidationError(
      `Неизвестный язык "${lang}": ожидается ${ARENA_LANGUAGES.join(", ")}`,
    );
  }
  return lang;
}

/** Список языков из тела запроса. Пусто — значит все, кроме языка оригинала. */
function langsFromBody(body) {
  const raw = body?.langs;
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw new ValidationError("langs: ожидается массив языков", { i18n: "app.validation.langsArrayExpected" });
  const list = raw.map((l) => String(l).trim()).filter(Boolean);
  const bad = list.filter((l) => !ARENA_LANGUAGES.includes(l));
  if (bad.length) throw new ValidationError(`langs: неизвестные языки: ${bad.join(", ")}`);
  return list.length ? list : null;
}

// Состояние переводов кейса: по каждому языку — missing / auto / stale /
// reviewed, тексты и сверочные наборы диагноза.
router.get(
  BASE,
  requireAuthor,
  asyncHandler(async (req, res) => {
    res.json(await listCaseTranslations(caseTypeOf(req), req.params.caseId));
  }),
);

// Перевести заново. force:true заставляет перевести и то, что сервис считает
// свежим (совпал хеш исходника).
//
// Проверенный человеком перевод force НЕ трогает — так решает
// translateCase.service.js, и это правильно: ручная правка дороже машинной, и
// стереть её случайной кнопкой нельзя. Чтобы перевести такой язык заново,
// сначала снимается «проверено» (роут ниже).
router.post(
  `${BASE}/translate`,
  requireAuthor,
  asyncHandler(async (req, res) => {
    const report = await translateCase(caseTypeOf(req), req.params.caseId, {
      langs: langsFromBody(req.body),
      force: Boolean(req.body?.force),
      actorId: req.radiologyActor.userId,
    });
    res.json({ report });
  }),
);

// Ручная правка перевода. Помечает его «проверено» — после этого автоперевод
// его не трогает.
router.put(
  `${BASE}/:lang`,
  requireAuthor,
  asyncHandler(async (req, res) => {
    const translation = await updateCaseTranslation(
      caseTypeOf(req),
      req.params.caseId,
      langOfParam(req),
      {
        fields: req.body?.fields ?? null,
        diagnosisKeys: req.body?.diagnosisKeys ?? null,
        diagnosisSynonyms: req.body?.diagnosisSynonyms ?? null,
        actorId: req.radiologyActor.userId,
      },
    );
    res.json({ translation });
  }),
);

// Снять «проверено», чтобы автоперевод снова мог обновлять текст.
router.post(
  `${BASE}/:lang/unreview`,
  requireAuthor,
  asyncHandler(async (req, res) => {
    const translation = await unreviewCaseTranslation(
      caseTypeOf(req),
      req.params.caseId,
      langOfParam(req),
      { actorId: req.radiologyActor.userId },
    );
    res.json({ translation });
  }),
);

export default router;
