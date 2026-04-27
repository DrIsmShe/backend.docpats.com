import calibrationService from "../services/calibration.service.js";

/* ============================================================
   CALIBRATION CONTROLLERS
   ============================================================ */

/* POST /studies/:studyId/calibrate/ruler */
export const calibrateWithRuler = async (req, res, next) => {
  try {
    const study = await calibrationService.calibrateWithRuler({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
      data: req.body,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* POST /studies/:studyId/calibrate/interpupillary */
export const calibrateWithInterpupillary = async (req, res, next) => {
  try {
    const study = await calibrationService.calibrateWithInterpupillary({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
      data: req.body,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* POST /studies/:studyId/recalibrate */
export const recalibrate = async (req, res, next) => {
  try {
    const study = await calibrationService.recalibrate({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
      method: req.body.method,
      data: req.body.data,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

/* GET /studies/:studyId/calibration */
export const getCalibrationInfo = async (req, res, next) => {
  try {
    const calibration = await calibrationService.getCalibrationInfo({
      studyId: req.params.studyId,
      actor: req.actor,
    });
    res.status(200).json({ data: calibration });
  } catch (err) {
    next(err);
  }
};

/* DELETE /studies/:studyId/calibration */
export const uncalibrate = async (req, res, next) => {
  try {
    const study = await calibrationService.uncalibrate({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
    });
    res.status(200).json({ data: study });
  } catch (err) {
    next(err);
  }
};

export default {
  calibrateWithRuler,
  calibrateWithInterpupillary,
  recalibrate,
  getCalibrationInfo,
  uncalibrate,
};
