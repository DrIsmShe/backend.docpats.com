// server/modules/anthropometry/services/calibration.service.js

import Study from "../models/Study.model.js";
import Photo from "../models/Photo.model.js";
import auditService from "./audit.service.js";
import { withTransaction } from "../../../common/utils/db.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../utils/errors.js";
import {
  computePixelsPerMmFromRuler,
  computePixelsPerMmFromInterpupillary,
  assertReasonablePixelsPerMm,
  DEFAULT_IPD_BY_GENDER,
} from "../utils/calibrationMath.js";
import measurementService from "./measurement.service.js";

/* ============================================================
   PRIVATE HELPERS
   ============================================================ */

/**
 * Получает study с проверкой доступа.
 */
const getStudyWithAccess = async (studyId, actor, session) => {
  const query = Study.findOneActive({ _id: studyId });
  if (session) query.session(session);
  const study = await query.exec();

  if (!study) {
    throw new NotFoundError("Study", studyId);
  }
  if (String(study.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError(
      "study calibration",
      "study belongs to another doctor",
    );
  }
  if (study.isArchived) {
    throw new ConflictError("Cannot calibrate archived study");
  }
  if (study.status === "completed") {
    throw new ConflictError("Cannot calibrate completed study");
  }
  return study;
};

/**
 * Получает reference photo и проверяет что оно из этого study.
 */
const getReferencePhoto = async (photoId, studyId, session) => {
  const query = Photo.findOneActive({ _id: photoId });
  if (session) query.session(session);
  const photo = await query.exec();

  if (!photo) {
    throw new NotFoundError("Photo", photoId);
  }
  if (String(photo.studyId) !== String(studyId)) {
    throw new ValidationError("Reference photo does not belong to this study", {
      expectedStudyId: studyId,
      actualStudyId: photo.studyId,
    });
  }
  if (!photo.isReady()) {
    throw new ConflictError("Photo is not ready for calibration", {
      status: photo.status,
    });
  }
  return photo;
};

/**
 * Валидация формата точки.
 */
const assertValidNormalizedPoint = (point, fieldName) => {
  if (!point || typeof point !== "object") {
    throw new ValidationError(`${fieldName} must be an object`);
  }
  if (typeof point.x !== "number" || typeof point.y !== "number") {
    throw new ValidationError(`${fieldName} must have numeric x and y`);
  }
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new ValidationError(
      `${fieldName} coordinates must be normalized (0..1)`,
      { received: point },
    );
  }
};

/* ============================================================
   CALIBRATE WITH RULER
   ============================================================ */

/**
 * Калибровка через эталон в кадре.
 *
 * @param {Object} params
 * @param {String} params.studyId
 * @param {Object} params.actor
 * @param {Object} params.context
 * @param {Object} params.data
 * @param {String} params.data.referencePhotoId
 * @param {Object} params.data.point1            — { x, y } нормализованные
 * @param {Object} params.data.point2            — { x, y } нормализованные
 * @param {Number} params.data.knownDistanceMm   — известное расстояние
 */
export const calibrateWithRuler = async (params) => {
  const { studyId, actor, context, data } = params;

  // Валидация входов
  if (!data?.referencePhotoId) {
    throw new ValidationError("referencePhotoId is required");
  }
  assertValidNormalizedPoint(data.point1, "point1");
  assertValidNormalizedPoint(data.point2, "point2");
  if (typeof data.knownDistanceMm !== "number" || data.knownDistanceMm <= 0) {
    throw new ValidationError("knownDistanceMm must be a positive number");
  }

  const study = await getStudyWithAccess(studyId, actor);

  // Если уже есть калибровка — это перекалибровка, должна идти через recalibrate
  if (study.calibration?.isCalibrated) {
    throw new ConflictError(
      "Study already calibrated. Use recalibrate() to replace.",
      { currentMethod: study.calibration.method },
    );
  }

  // Получаем reference photo для размеров
  const photo = await getReferencePhoto(data.referencePhotoId, study._id);

  // Вычисляем pixelsPerMm
  let pixelsPerMm;
  try {
    pixelsPerMm = computePixelsPerMmFromRuler({
      point1: data.point1,
      point2: data.point2,
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
      knownDistanceMm: data.knownDistanceMm,
    });
    assertReasonablePixelsPerMm(pixelsPerMm);
  } catch (err) {
    throw new ValidationError(`Calibration failed: ${err.message}`);
  }

  // Сохраняем
  study.calibration = {
    method: "ruler",
    pixelsPerMm,
    ruler: {
      referencePhotoId: photo._id,
      point1: data.point1,
      point2: data.point2,
      knownDistanceMm: data.knownDistanceMm,
    },
    interpupillary: undefined,
    isCalibrated: true,
    calibratedAt: new Date(),
    calibratedBy: actor.userId,
  };
  study.updatedBy = actor.userId;
  // status авто-обновится через pre-save хук модели (draft → calibrated)

  await study.save();

  // Calibration — критическое событие, синхронный audit
  await auditService.recordAction({
    actor,
    context,
    action: "study.calibrate",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: {
      method: "ruler",
      pixelsPerMm,
      knownDistanceMm: data.knownDistanceMm,
      referencePhotoId: String(photo._id),
    },
  });

  return study;
};

/* ============================================================
   CALIBRATE WITH INTERPUPILLARY DISTANCE
   ============================================================ */

/**
 * Калибровка через межзрачковое расстояние.
 *
 * @param {Object} params
 * @param {String} params.studyId
 * @param {Object} params.actor
 * @param {Object} params.context
 * @param {Object} params.data
 * @param {String} params.data.referencePhotoId
 * @param {Object} params.data.leftPupil
 * @param {Object} params.data.rightPupil
 * @param {String} [params.data.patientGender]    — для выбора IPD
 * @param {Number} [params.data.assumedDistanceMm] — переопределение default
 */
export const calibrateWithInterpupillary = async (params) => {
  const { studyId, actor, context, data } = params;

  if (!data?.referencePhotoId) {
    throw new ValidationError("referencePhotoId is required");
  }
  assertValidNormalizedPoint(data.leftPupil, "leftPupil");
  assertValidNormalizedPoint(data.rightPupil, "rightPupil");

  const study = await getStudyWithAccess(studyId, actor);

  if (study.calibration?.isCalibrated) {
    throw new ConflictError(
      "Study already calibrated. Use recalibrate() to replace.",
      { currentMethod: study.calibration.method },
    );
  }

  const photo = await getReferencePhoto(data.referencePhotoId, study._id);

  // Если врач не указал assumedDistanceMm — берём по полу
  const patientGender = data.patientGender || "unknown";
  const assumedDistanceMm =
    data.assumedDistanceMm ?? DEFAULT_IPD_BY_GENDER[patientGender];

  let pixelsPerMm;
  try {
    pixelsPerMm = computePixelsPerMmFromInterpupillary({
      leftPupil: data.leftPupil,
      rightPupil: data.rightPupil,
      widthPx: photo.widthPx,
      heightPx: photo.heightPx,
      assumedDistanceMm,
    });
    assertReasonablePixelsPerMm(pixelsPerMm);
  } catch (err) {
    throw new ValidationError(`Calibration failed: ${err.message}`);
  }

  study.calibration = {
    method: "interpupillary",
    pixelsPerMm,
    interpupillary: {
      referencePhotoId: photo._id,
      leftPupil: data.leftPupil,
      rightPupil: data.rightPupil,
      assumedDistanceMm,
      patientGender,
    },
    ruler: undefined,
    isCalibrated: true,
    calibratedAt: new Date(),
    calibratedBy: actor.userId,
  };
  study.updatedBy = actor.userId;

  await study.save();

  await auditService.recordAction({
    actor,
    context,
    action: "study.calibrate",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: {
      method: "interpupillary",
      pixelsPerMm,
      assumedDistanceMm,
      patientGender,
      referencePhotoId: String(photo._id),
    },
  });

  return study;
};

/* ============================================================
   RECALIBRATE (TRANSACTIONAL)
   ============================================================
   Перекалибровка study, когда уже была калибровка.
   Атомарно:
     1. Обновляет калибровку
     2. Пересчитывает все существующие measurements в новой калибровке
     3. Записывает audit log

   Если любой шаг падает — откат. */

export const recalibrate = async (params) => {
  const { studyId, actor, context, method, data } = params;

  if (!["ruler", "interpupillary"].includes(method)) {
    throw new ValidationError("method must be 'ruler' or 'interpupillary'");
  }

  return withTransaction(async (session) => {
    const study = await getStudyWithAccess(studyId, actor, session);

    if (!study.calibration?.isCalibrated) {
      throw new ConflictError(
        "Study is not calibrated yet. Use calibrate*() instead.",
      );
    }

    const photo = await getReferencePhoto(
      data.referencePhotoId,
      study._id,
      session,
    );

    const previousPpm = study.calibration.pixelsPerMm;
    const previousMethod = study.calibration.method;

    let newPpm;
    if (method === "ruler") {
      assertValidNormalizedPoint(data.point1, "point1");
      assertValidNormalizedPoint(data.point2, "point2");
      if (
        typeof data.knownDistanceMm !== "number" ||
        data.knownDistanceMm <= 0
      ) {
        throw new ValidationError("knownDistanceMm must be a positive number");
      }
      newPpm = computePixelsPerMmFromRuler({
        point1: data.point1,
        point2: data.point2,
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
        knownDistanceMm: data.knownDistanceMm,
      });
      assertReasonablePixelsPerMm(newPpm);

      study.calibration = {
        method: "ruler",
        pixelsPerMm: newPpm,
        ruler: {
          referencePhotoId: photo._id,
          point1: data.point1,
          point2: data.point2,
          knownDistanceMm: data.knownDistanceMm,
        },
        interpupillary: undefined,
        isCalibrated: true,
        calibratedAt: new Date(),
        calibratedBy: actor.userId,
      };
    } else {
      assertValidNormalizedPoint(data.leftPupil, "leftPupil");
      assertValidNormalizedPoint(data.rightPupil, "rightPupil");

      const patientGender = data.patientGender || "unknown";
      const assumedDistanceMm =
        data.assumedDistanceMm ?? DEFAULT_IPD_BY_GENDER[patientGender];

      newPpm = computePixelsPerMmFromInterpupillary({
        leftPupil: data.leftPupil,
        rightPupil: data.rightPupil,
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
        assumedDistanceMm,
      });
      assertReasonablePixelsPerMm(newPpm);

      study.calibration = {
        method: "interpupillary",
        pixelsPerMm: newPpm,
        interpupillary: {
          referencePhotoId: photo._id,
          leftPupil: data.leftPupil,
          rightPupil: data.rightPupil,
          assumedDistanceMm,
          patientGender,
        },
        ruler: undefined,
        isCalibrated: true,
        calibratedAt: new Date(),
        calibratedBy: actor.userId,
      };
    }

    study.updatedBy = actor.userId;
    await study.save({ session });

    // Пересчитываем measurements у всех актуальных аннотаций study
    const recomputeResult = await measurementService.recomputeForStudy({
      studyId: study._id,
      actor,
      context,
      patientGender:
        method === "interpupillary"
          ? data.patientGender || "unknown"
          : "unknown",
      session,
    });
    const recomputedCount = recomputeResult.updatedCount;

    await auditService.recordAction({
      actor,
      context,
      action: "study.recalibrate",
      resourceType: "Study",
      resourceId: study._id,
      caseId: study.caseId,
      metadata: {
        previousMethod,
        previousPpm,
        newMethod: method,
        newPpm,
        recomputedAnnotationsCount: recomputedCount,
      },
      session,
    });

    return study;
  });
};

/* ============================================================
   GET CALIBRATION INFO
   ============================================================ */

export const getCalibrationInfo = async (params) => {
  const { studyId, actor } = params;

  const study = await Study.findOneActive({ _id: studyId });
  if (!study) {
    throw new NotFoundError("Study", studyId);
  }
  if (String(study.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError(
      "calibration info",
      "study belongs to another doctor",
    );
  }

  return study.calibration || { isCalibrated: false };
};

/* ============================================================
   UNCALIBRATE
   ============================================================
   Сброс калибровки — редкий случай (например, врач понял
   что отметил неправильное эталонное расстояние и хочет
   начать заново). После сброса все measurements в мм
   становятся неактуальными — но их мы не удаляем,
   просто помечаем как "не пересчитанные" в Шаге 3.7. */

export const uncalibrate = async (params) => {
  const { studyId, actor, context } = params;

  const study = await getStudyWithAccess(studyId, actor);

  if (!study.calibration?.isCalibrated) {
    throw new ConflictError("Study is not calibrated");
  }

  const previousMethod = study.calibration.method;
  const previousPpm = study.calibration.pixelsPerMm;

  study.calibration = { isCalibrated: false };
  study.status = "draft"; // вернули в исходный статус
  study.updatedBy = actor.userId;
  await study.save();

  await auditService.recordAction({
    actor,
    context,
    action: "study.recalibrate", // используем тот же action
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: {
      operation: "uncalibrate",
      previousMethod,
      previousPpm,
    },
  });

  return study;
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  calibrateWithRuler,
  calibrateWithInterpupillary,
  recalibrate,
  getCalibrationInfo,
  uncalibrate,
};
