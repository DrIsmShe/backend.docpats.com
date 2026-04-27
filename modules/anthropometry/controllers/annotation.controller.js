import annotationService from "../services/annotation.service.js";

/* ============================================================
   ANNOTATION CONTROLLERS
   ============================================================ */

/* POST /photos/:photoId/annotations (создание v1) */
export const createAnnotation = async (req, res, next) => {
  try {
    const result = await annotationService.createAnnotation({
      photoId: req.params.photoId,
      actor: req.actor,
      context: req.context,
      presetType: req.body.presetType,
      landmarks: req.body.landmarks,
      description: req.body.description,
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/* GET /annotations/:annotationId */
export const getAnnotation = async (req, res, next) => {
  try {
    const annotation = await annotationService.getAnnotation({
      annotationId: req.params.annotationId,
      actor: req.actor,
      context: req.context,
    });
    res.status(200).json({ data: annotation });
  } catch (err) {
    next(err);
  }
};

/* GET /photos/:photoId/annotations/current?presetType=... */
export const getCurrentForPhoto = async (req, res, next) => {
  try {
    const annotation = await annotationService.getCurrentForPhoto({
      photoId: req.params.photoId,
      presetType: req.query.presetType,
      actor: req.actor,
    });
    res.status(200).json({ data: annotation });
  } catch (err) {
    next(err);
  }
};

/* GET /photos/:photoId/annotations/history?presetType=... */
export const getHistory = async (req, res, next) => {
  try {
    const history = await annotationService.getHistory({
      photoId: req.params.photoId,
      presetType: req.query.presetType,
      actor: req.actor,
    });
    res.status(200).json({ data: history });
  } catch (err) {
    next(err);
  }
};

/* PATCH /annotations/:annotationId */
export const updateLandmarks = async (req, res, next) => {
  try {
    const result = await annotationService.updateLandmarks({
      annotationId: req.params.annotationId,
      actor: req.actor,
      context: req.context,
      landmarks: req.body.landmarks,
    });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/* POST /photos/:photoId/annotations/version */
export const createNewVersion = async (req, res, next) => {
  try {
    const result = await annotationService.createNewVersion({
      photoId: req.params.photoId,
      actor: req.actor,
      context: req.context,
      presetType: req.body.presetType,
      landmarks: req.body.landmarks,
      description: req.body.description,
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/* POST /annotations/:annotationId/lock */
export const lockAnnotation = async (req, res, next) => {
  try {
    const annotation = await annotationService.lockAnnotation({
      annotationId: req.params.annotationId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: annotation });
  } catch (err) {
    next(err);
  }
};

/* POST /annotations/:annotationId/unlock */
export const unlockAnnotation = async (req, res, next) => {
  try {
    const annotation = await annotationService.unlockAnnotation({
      annotationId: req.params.annotationId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: annotation });
  } catch (err) {
    next(err);
  }
};

/* DELETE /annotations/:annotationId */
export const softDeleteAnnotation = async (req, res, next) => {
  try {
    const annotation = await annotationService.softDeleteAnnotation({
      annotationId: req.params.annotationId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: annotation });
  } catch (err) {
    next(err);
  }
};

export default {
  createAnnotation,
  getAnnotation,
  getCurrentForPhoto,
  getHistory,
  updateLandmarks,
  createNewVersion,
  lockAnnotation,
  unlockAnnotation,
  softDeleteAnnotation,
};
