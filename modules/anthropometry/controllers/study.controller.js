import studyService from "../services/study.service.js";

/* ============================================================
   STUDY CONTROLLERS
   ============================================================ */

/* POST /cases/:caseId/studies */
export const createStudy = async (req, res, next) => {
  try {
    const study = await studyService.createStudy({
      caseId: req.params.caseId,
      actor: req.actor,
      context: req.context,
      data: req.body,
    });
    res.status(201).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* GET /cases/:caseId/studies */
export const listStudiesByCase = async (req, res, next) => {
  try {
    const studies = await studyService.listStudiesByCase({
      caseId: req.params.caseId,
      actor: req.actor,
      options: {
        includeArchived: req.query.includeArchived,
      },
    });
    res.status(200).json({ data: studies });
  } catch (err) {
    next(err);
  }
};

/* GET /studies/:studyId */
export const getStudy = async (req, res, next) => {
  try {
    const study = await studyService.getStudy({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* PATCH /studies/:studyId */
export const updateStudy = async (req, res, next) => {
  try {
    const study = await studyService.updateStudy({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
      updates: req.body,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* POST /studies/:studyId/complete */
export const completeStudy = async (req, res, next) => {
  try {
    const study = await studyService.completeStudy({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* DELETE /studies/:studyId */
export const softDeleteStudy = async (req, res, next) => {
  try {
    const study = await studyService.softDeleteStudy({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

export default {
  createStudy,
  listStudiesByCase,
  getStudy,
  updateStudy,
  completeStudy,
  softDeleteStudy,
};
