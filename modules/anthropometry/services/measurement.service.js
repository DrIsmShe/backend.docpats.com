import Study from "../models/Study.model.js";
import Photo from "../models/Photo.model.js";
import Annotation from "../models/Annotation.model.js";
import auditService from "./audit.service.js";
import { withTransaction } from "../../../common/utils/db.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  PreconditionError,
} from "../utils/errors.js";
import {
  distance,
  angleAtVertex,
  ratio,
  pixelsToMm,
  roundAngle,
  roundDistance,
  roundRatio,
} from "../utils/geometry.js";
import rhinoplastyLateral from "../presets/rhinoplasty.lateral.js";

/* ============================================================
   PRESET REGISTRY
   ============================================================
   Карта presetType → preset object.
   Когда добавим новый preset — регистрируем здесь. */

const PRESET_REGISTRY = {
  rhinoplasty_lateral: rhinoplastyLateral,
};

const getPresetByType = (presetType) => {
  const preset = PRESET_REGISTRY[presetType];
  if (!preset) {
    throw new ValidationError(`Unknown preset type: ${presetType}`, {
      available: Object.keys(PRESET_REGISTRY),
    });
  }
  return preset;
};

/* ============================================================
   PRIVATE — landmark lookup
   ============================================================ */

const buildLandmarkMap = (landmarks) => {
  const map = new Map();
  for (const lm of landmarks) {
    map.set(lm.id, lm);
  }
  return map;
};

const getLandmarkOrNull = (lmMap, id) => lmMap.get(id) || null;

/**
 * Конвертирует нормализованную точку landmark в пиксели через размеры фото.
 */
const lmToPixels = (lm, photo) => ({
  x: lm.x * photo.widthPx,
  y: lm.y * photo.heightPx,
});

/* ============================================================
   COMPUTE SINGLE MEASUREMENT
   ============================================================
   Чистая функция — получает на вход всё нужное, возвращает
   measurement object или null если не удалось посчитать. */

const computeOneMeasurement = ({
  measurementDef,
  landmarkMap,
  photo,
  pixelsPerMm,
  patientGender,
}) => {
  const { code, type, label, unit, points, numerator, denominator } =
    measurementDef;

  // Получаем норму с учётом пола
  const norm =
    measurementDef.genderSpecific && measurementDef.normByGender
      ? measurementDef.normByGender[patientGender] ||
        measurementDef.normByGender.unknown
      : measurementDef.norm;

  let value;
  let pointIds;

  try {
    if (type === "angle") {
      // angle: 3 точки — vertex в середине
      pointIds = points;
      const [p1Id, vertexId, p2Id] = points;
      const p1 = getLandmarkOrNull(landmarkMap, p1Id);
      const vertex = getLandmarkOrNull(landmarkMap, vertexId);
      const p2 = getLandmarkOrNull(landmarkMap, p2Id);
      if (!p1 || !vertex || !p2) return null;

      const angle = angleAtVertex(
        lmToPixels(p1, photo),
        lmToPixels(vertex, photo),
        lmToPixels(p2, photo),
      );
      value = roundAngle(angle);
    } else if (type === "distance") {
      // distance: 2 точки, требует калибровку для мм
      pointIds = points;
      const [p1Id, p2Id] = points;
      const p1 = getLandmarkOrNull(landmarkMap, p1Id);
      const p2 = getLandmarkOrNull(landmarkMap, p2Id);
      if (!p1 || !p2) return null;

      // Без калибровки distance в мм не имеет смысла
      if (!pixelsPerMm) return null;

      const distancePx = distance(lmToPixels(p1, photo), lmToPixels(p2, photo));
      const distanceMm = pixelsToMm(distancePx, pixelsPerMm);
      value = roundDistance(distanceMm);
    } else if (type === "ratio") {
      // ratio: 4 точки — два отрезка
      pointIds = [...numerator, ...denominator];
      const [n1Id, n2Id] = numerator;
      const [d1Id, d2Id] = denominator;
      const n1 = getLandmarkOrNull(landmarkMap, n1Id);
      const n2 = getLandmarkOrNull(landmarkMap, n2Id);
      const d1 = getLandmarkOrNull(landmarkMap, d1Id);
      const d2 = getLandmarkOrNull(landmarkMap, d2Id);
      if (!n1 || !n2 || !d1 || !d2) return null;

      const ratioValue = ratio(
        lmToPixels(n1, photo),
        lmToPixels(n2, photo),
        lmToPixels(d1, photo),
        lmToPixels(d2, photo),
      );
      value = roundRatio(ratioValue);
    } else {
      throw new ValidationError(`Unknown measurement type: ${type}`);
    }
  } catch (err) {
    // Геометрические ошибки (точки совпадают и т.п.) — пропускаем measurement
    console.warn(`[measurement] failed to compute ${code}: ${err.message}`);
    return null;
  }

  // Интерпретация относительно нормы
  let interpretation = "unknown";
  let normMin = null;
  let normMax = null;
  if (norm && typeof norm.min === "number" && typeof norm.max === "number") {
    normMin = norm.min;
    normMax = norm.max;
    if (value < norm.min) interpretation = "below_norm";
    else if (value > norm.max) interpretation = "above_norm";
    else interpretation = "within_norm";
  }

  return {
    code,
    type,
    pointIds,
    value,
    unit,
    normMin,
    normMax,
    interpretation,
  };
};

/* ============================================================
   COMPUTE MEASUREMENTS
   ============================================================
   Главная публичная функция.

   @param {Object} params
   @param {Array}  params.landmarks       — массив landmarks
   @param {String} params.presetType
   @param {Object} params.photo           — Photo doc (для widthPx/heightPx)
   @param {Object} params.study           — Study doc (для калибровки)
   @param {String} [params.patientGender] — для gender-specific норм

   @returns {Object} { measurements: [...], skipped: [...], hasCalibration }
   ============================================================ */

export const computeMeasurements = ({
  landmarks,
  presetType,
  photo,
  study,
  patientGender = "unknown",
}) => {
  if (!Array.isArray(landmarks)) {
    throw new ValidationError("landmarks must be an array");
  }
  if (!photo || !photo.widthPx || !photo.heightPx) {
    throw new ValidationError("photo with widthPx/heightPx is required");
  }
  if (!study) {
    throw new ValidationError("study is required");
  }

  const preset = getPresetByType(presetType);
  const landmarkMap = buildLandmarkMap(landmarks);
  const pixelsPerMm = study.calibration?.isCalibrated
    ? study.calibration.pixelsPerMm
    : null;

  const measurements = [];
  const skipped = [];

  for (const measurementDef of preset.measurements) {
    const result = computeOneMeasurement({
      measurementDef,
      landmarkMap,
      photo,
      pixelsPerMm,
      patientGender,
    });

    if (result) {
      measurements.push(result);
    } else {
      skipped.push({
        code: measurementDef.code,
        reason:
          pixelsPerMm === null && measurementDef.type === "distance"
            ? "calibration_required"
            : "missing_landmarks",
      });
    }
  }

  return {
    measurements,
    skipped,
    hasCalibration: pixelsPerMm !== null,
    presetVersion: preset.meta.version,
  };
};

/* ============================================================
   RECOMPUTE FOR ANNOTATION
   ============================================================
   Пересчитать measurements конкретной аннотации.
   Используется когда меняются landmarks или калибровка.

   Сохраняет результат в самой аннотации. */

export const recomputeForAnnotation = async (params) => {
  const {
    annotationId,
    actor,
    context,
    patientGender,
    session: outerSession,
  } = params;

  const work = async (session) => {
    const annotationQuery = Annotation.findOne({ _id: annotationId });
    if (session) annotationQuery.session(session);
    const annotation = await annotationQuery.exec();
    if (!annotation) throw new NotFoundError("Annotation", annotationId);
    if (annotation.isDeleted) {
      throw new PreconditionError("Cannot recompute deleted annotation");
    }

    if (String(annotation.doctorUserId) !== String(actor.userId)) {
      throw new ForbiddenError(
        "annotation recompute",
        "annotation belongs to another doctor",
      );
    }

    // Получаем photo и study для контекста
    const photoQuery = Photo.findOne({ _id: annotation.photoId });
    if (session) photoQuery.session(session);
    const photo = await photoQuery.exec();
    if (!photo) throw new NotFoundError("Photo", annotation.photoId);

    const studyQuery = Study.findOne({ _id: annotation.studyId });
    if (session) studyQuery.session(session);
    const study = await studyQuery.exec();
    if (!study) throw new NotFoundError("Study", annotation.studyId);

    // Считаем
    const result = computeMeasurements({
      landmarks: annotation.landmarks,
      presetType: annotation.presetType,
      photo,
      study,
      patientGender,
    });

    // Сохраняем
    annotation.measurements = result.measurements;
    annotation.updatedBy = actor.userId;
    await annotation.save({ session });

    return { annotation, result };
  };

  if (outerSession) {
    return work(outerSession);
  }
  return withTransaction(work);
};

/* ============================================================
   RECOMPUTE FOR STUDY
   ============================================================
   Пересчёт всех аннотаций study.
   Вызывается из calibration.service после recalibrate.

   Возвращает количество пересчитанных аннотаций. */

export const recomputeForStudy = async (params) => {
  const {
    studyId,
    actor,
    context,
    patientGender = "unknown",
    session,
  } = params;

  if (!session) {
    throw new Error(
      "recomputeForStudy requires a session — must be called from a transaction",
    );
  }

  const study = await Study.findOne({ _id: studyId }).session(session);
  if (!study) throw new NotFoundError("Study", studyId);

  // Все актуальные аннотации этого study (только isCurrent: true)
  const annotations = await Annotation.find({
    studyId: study._id,
    isCurrent: true,
    isDeleted: false,
  }).session(session);

  // Для каждой получаем photo и пересчитываем
  let updatedCount = 0;
  let skippedCount = 0;

  for (const annotation of annotations) {
    const photo = await Photo.findOne({ _id: annotation.photoId }).session(
      session,
    );
    if (!photo) {
      skippedCount += 1;
      continue;
    }

    const result = computeMeasurements({
      landmarks: annotation.landmarks,
      presetType: annotation.presetType,
      photo,
      study,
      patientGender,
    });

    annotation.measurements = result.measurements;
    annotation.updatedBy = actor.userId;
    await annotation.save({ session });
    updatedCount += 1;
  }

  // Audit log
  await auditService.recordAction({
    actor,
    context,
    action: "study.recalibrate",
    resourceType: "Study",
    resourceId: study._id,
    caseId: study.caseId,
    metadata: {
      operation: "measurements_recomputed",
      updatedAnnotations: updatedCount,
      skippedAnnotations: skippedCount,
    },
    session,
  });

  return { updatedCount, skippedCount };
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  computeMeasurements,
  recomputeForAnnotation,
  recomputeForStudy,
};
