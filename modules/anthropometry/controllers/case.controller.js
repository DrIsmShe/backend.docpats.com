import caseService from "../services/case.service.js";

/* ============================================================
   CASE CONTROLLERS
   ============================================================
   Тонкие обёртки над case.service.

   Все controllers следуют одному шаблону:
   1. Извлечь данные из req (body / params / query)
   2. Вызвать сервис с actor + context из middleware
   3. Сформировать ответ или передать ошибку в next()
   ============================================================ */

/* ============================================================
   POST /cases
   ============================================================ */
export const createCase = async (req, res, next) => {
  try {
    const newCase = await caseService.createCase({
      actor: req.actor,
      context: req.context,
      data: req.body,
    });
    res.status(201).json({ data: newCase });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   GET /cases
   ============================================================ */
/* ============================================================
   GET /cases
   ============================================================ */
export const listCases = async (req, res, next) => {
  try {
    // Query-параметры приходят как строки — конвертируем явно
    const parseBoolParam = (v) => {
      if (v === "true" || v === true) return true;
      if (v === "false" || v === false) return false;
      return undefined;
    };

    const parseIntParam = (v) => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const result = await caseService.listCasesByDoctor({
      actor: req.actor,
      filter: {
        status: req.query.status,
        procedureType: req.query.procedureType,
        isArchived: parseBoolParam(req.query.isArchived),
      },
      options: {
        limit: parseIntParam(req.query.limit),
        skip: parseIntParam(req.query.skip),
        sortBy: req.query.sortBy,
        sortOrder: parseIntParam(req.query.sortOrder),
      },
    });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   GET /cases/:caseId
   ============================================================ */
export const getCase = async (req, res, next) => {
  try {
    const caseDoc = await caseService.getCase({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
      populate: req.query.populate === "true",
    });
    res.status(200).json({ data: caseDoc });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   PATCH /cases/:caseId
   ============================================================ */
export const updateCase = async (req, res, next) => {
  try {
    const caseDoc = await caseService.updateCase({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
      updates: req.body,
    });
    res.status(200).json({ data: caseDoc });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   POST /cases/:caseId/consent
   ============================================================ */
export const giveConsent = async (req, res, next) => {
  try {
    const caseDoc = await caseService.giveConsent({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
      consentDocumentUrl: req.body.consentDocumentUrl,
    });
    res.status(200).json({ data: caseDoc });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   POST /cases/:caseId/archive
   ============================================================ */
export const archiveCase = async (req, res, next) => {
  try {
    const caseDoc = await caseService.archiveCase({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: caseDoc });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   POST /cases/:caseId/unarchive
   ============================================================ */
export const unarchiveCase = async (req, res, next) => {
  try {
    const caseDoc = await caseService.unarchiveCase({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
    });
    res.status(200).json({ data: caseDoc });
  } catch (err) {
    next(err);
  }
};

/* ============================================================
   DELETE /cases/:caseId
   ============================================================ */
export const softDeleteCase = async (req, res, next) => {
  try {
    const caseDoc = await caseService.softDeleteCase({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: caseDoc });
  } catch (err) {
    next(err);
  }
};

export default {
  createCase,
  listCases,
  getCase,
  updateCase,
  giveConsent,
  archiveCase,
  unarchiveCase,
  softDeleteCase,
};
