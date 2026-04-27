import crypto from "crypto";
import sharp from "sharp";
import PatientCase from "../models/PatientCase.model.js";
import Study from "../models/Study.model.js";
import Photo from "../models/Photo.model.js";
import Annotation from "../models/Annotation.model.js";
import auditService from "./audit.service.js";
import storage, { keys } from "../utils/storage/index.js";
import { withTransaction } from "../../../common/utils/db.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  PreconditionError,
} from "../utils/errors.js";

/* ============================================================
   CONFIG
   ============================================================ */

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/heic", "image/webp"];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const THUMBNAIL_SIZE = 300; // px on longest side
const THUMBNAIL_QUALITY = 80;

/* ============================================================
   PRIVATE HELPERS
   ============================================================ */

const getStudyWithAccess = async (studyId, actor, session) => {
  const query = Study.findOneActive({ _id: studyId });
  if (session) query.session(session);
  const study = await query.exec();
  if (!study) throw new NotFoundError("Study", studyId);
  if (String(study.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError(
      "study photo access",
      "study belongs to another doctor",
    );
  }
  return study;
};

const getPhotoWithAccess = async (photoId, actor, session) => {
  const query = Photo.findOneActive({ _id: photoId });
  if (session) query.session(session);
  const photo = await query.exec();
  if (!photo) throw new NotFoundError("Photo", photoId);
  if (String(photo.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError("photo access", "photo belongs to another doctor");
  }
  return photo;
};

const getExtensionFromMime = (mimeType) => {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/webp": "webp",
  };
  return map[mimeType] || "bin";
};

const computeFileHash = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * Безопасное удаление Photo и его файлов в R2.
 * Используется как cleanup при ошибке upload.
 * Никогда не throws — только логирует.
 */
const safeCleanupPhoto = async (photoId, storageKey, thumbKey) => {
  try {
    await Photo.deleteOne({ _id: photoId });
  } catch (err) {
    console.error("[photo.service] cleanup Photo failed:", err.message);
  }
  if (storageKey) {
    try {
      await storage.remove(storageKey);
    } catch (err) {
      console.error("[photo.service] cleanup R2 original failed:", err.message);
    }
  }
  if (thumbKey) {
    try {
      await storage.remove(thumbKey);
    } catch (err) {
      console.error(
        "[photo.service] cleanup R2 thumbnail failed:",
        err.message,
      );
    }
  }
};

/* ============================================================
   UPLOAD PHOTO
   ============================================================ */

export const uploadPhoto = async (params) => {
  const { studyId, actor, context, file } = params;

  // Базовая валидация file
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new ValidationError("file.buffer (Buffer) is required");
  }
  if (!file.mimeType) {
    throw new ValidationError("file.mimeType is required");
  }
  if (!ALLOWED_MIME.includes(file.mimeType)) {
    throw new ValidationError("Unsupported MIME type", {
      received: file.mimeType,
      allowed: ALLOWED_MIME,
    });
  }
  if (file.buffer.length > MAX_FILE_SIZE) {
    throw new ValidationError("File too large", {
      sizeBytes: file.buffer.length,
      maxBytes: MAX_FILE_SIZE,
    });
  }
  if (!params.viewType) {
    throw new ValidationError("viewType is required");
  }
  if (!file.originalFilename) {
    throw new ValidationError("file.originalFilename is required");
  }

  // Доступ к study
  const study = await getStudyWithAccess(studyId, actor);
  if (study.isArchived) {
    throw new ConflictError("Cannot upload to archived study");
  }
  if (study.status === "completed") {
    throw new ConflictError("Cannot upload to completed study");
  }

  // Извлечение метаданных через sharp
  let imageMetadata;
  try {
    imageMetadata = await sharp(file.buffer).metadata();
  } catch (err) {
    throw new ValidationError("Cannot read image metadata: " + err.message);
  }

  if (!imageMetadata.width || !imageMetadata.height) {
    throw new ValidationError("Image has no dimensions");
  }

  // Хеш для дедупликации
  const fileHash = computeFileHash(file.buffer);

  // Проверка дубликата
  const duplicate = await Photo.findDuplicate(study.caseId, fileHash);
  if (duplicate) {
    throw new ConflictError("This photo was already uploaded for this case", {
      existingPhotoId: String(duplicate._id),
      existingStudyId: String(duplicate.studyId),
    });
  }

  // Подсчёт sequenceInView (если уже есть фото с этим viewType — увеличить)
  const existingCount = await Photo.countDocuments({
    studyId: study._id,
    viewType: params.viewType,
    isDeleted: false,
  });

  // 1. Создаём Photo с processing статусом
  const photo = new Photo({
    studyId: study._id,
    caseId: study.caseId,
    doctorUserId: actor.userId,
    viewType: params.viewType,
    sequenceInView: existingCount + 1,
    storageKey: "pending", // временный, перезапишем
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    fileSize: file.buffer.length,
    widthPx: imageMetadata.width,
    heightPx: imageMetadata.height,
    fileHash,
    status: "processing",
    uploadedBy: actor.userId,
    uploadedAt: new Date(),
  });

  await photo.save();

  // 2. Строим финальный storageKey используя ID
  const extension = getExtensionFromMime(file.mimeType);
  const storageKey = keys.photoKey({
    caseId: String(study.caseId),
    studyId: String(study._id),
    photoId: String(photo._id),
    extension,
  });
  const thumbKey = keys.thumbnailKey({
    caseId: String(study.caseId),
    studyId: String(study._id),
    photoId: String(photo._id),
  });

  // 3. Загрузка оригинала + thumbnail с cleanup-on-error
  try {
    await storage.upload(file.buffer, {
      storageKey,
      contentType: file.mimeType,
      metadata: {
        photoId: String(photo._id),
        uploaderId: String(actor.userId),
      },
    });

    // Создание thumbnail
    const thumbBuffer = await sharp(file.buffer)
      .rotate() // auto-orient через EXIF
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toBuffer();

    await storage.upload(thumbBuffer, {
      storageKey: thumbKey,
      contentType: "image/jpeg",
    });

    // 4. Финализируем Photo
    photo.storageKey = storageKey;
    photo.thumbnailKey = thumbKey;
    photo.status = "ready";
    await photo.save();
  } catch (err) {
    await safeCleanupPhoto(photo._id, storageKey, thumbKey);
    throw new ValidationError("Photo processing failed: " + err.message);
  }

  // 5. Audit log — fire-and-forget
  auditService.recordActionAsync({
    actor,
    context,
    action: "photo.upload",
    resourceType: "Photo",
    resourceId: photo._id,
    caseId: study.caseId,
    metadata: {
      viewType: photo.viewType,
      sizeBytes: photo.fileSize,
      mimeType: photo.mimeType,
      dimensions: `${photo.widthPx}x${photo.heightPx}`,
    },
  });

  return photo;
};

/* ============================================================
   GET PHOTO
   ============================================================ */

export const getPhoto = async (params) => {
  const { photoId, actor, context } = params;
  const photo = await Photo.findOneActive({ _id: photoId });
  if (!photo) throw new NotFoundError("Photo", photoId);

  try {
    if (String(photo.doctorUserId) !== String(actor.userId)) {
      throw new ForbiddenError(
        "photo access",
        "photo belongs to another doctor",
      );
    }
  } catch (err) {
    auditService.recordActionAsync({
      actor,
      context,
      action: "photo.view",
      resourceType: "Photo",
      resourceId: photoId,
      outcome: "denied",
      failureReason: err.message,
    });
    throw err;
  }

  auditService.recordActionAsync({
    actor,
    context,
    action: "photo.view",
    resourceType: "Photo",
    resourceId: photo._id,
    caseId: photo.caseId,
  });

  return photo;
};

/* ============================================================
   GET SIGNED URLS
   ============================================================
   Главный API для отдачи фото клиенту.
   Возвращает временную подписанную ссылку. */

export const getPhotoSignedUrl = async (params) => {
  const { photoId, actor, context, ttlSeconds } = params;

  const photo = await getPhotoWithAccess(photoId, actor);
  if (!photo.isReady()) {
    throw new PreconditionError("Photo is not ready", { status: photo.status });
  }

  const url = await storage.getSignedUrl(photo.storageKey, ttlSeconds);

  // Лог обращения в accessLog (rolling window)
  photo.addAccessLog({
    userId: actor.userId,
    action: "view",
    ipAddress: context?.ipAddress,
  });
  await photo.save();

  // Полный audit (fire-and-forget)
  auditService.recordActionAsync({
    actor,
    context,
    action: "photo.view",
    resourceType: "Photo",
    resourceId: photo._id,
    caseId: photo.caseId,
    metadata: { ttlSeconds },
  });

  return { url, expiresIn: ttlSeconds || 3600 };
};

export const getThumbnailSignedUrl = async (params) => {
  const { photoId, actor, ttlSeconds } = params;

  const photo = await getPhotoWithAccess(photoId, actor);
  if (!photo.thumbnailKey) {
    throw new PreconditionError("Photo has no thumbnail");
  }

  const url = await storage.getSignedUrl(photo.thumbnailKey, ttlSeconds);
  // Thumbnail views НЕ логируем в accessLog — они вызываются для каждой плитки
  // в галерее, превратили бы access log в мусор.
  return { url, expiresIn: ttlSeconds || 3600 };
};

/* ============================================================
   LIST PHOTOS BY STUDY
   ============================================================ */

export const listPhotosByStudy = async (params) => {
  const { studyId, actor } = params;
  await getStudyWithAccess(studyId, actor);
  return Photo.findByStudyOrdered(studyId);
};

/* ============================================================
   SOFT DELETE PHOTO
   ============================================================
   Помечает Photo как deleted в БД + удаляет файлы из R2.
   Каскадно помечает связанные Annotation. */

export const softDeletePhoto = async (params) => {
  const { photoId, actor, context, reason, session: outerSession } = params;

  if (outerSession) {
    return _softDeletePhotoInternal({
      photoId,
      actor,
      context,
      reason,
      session: outerSession,
    });
  }

  const result = await withTransaction(async (session) => {
    return _softDeletePhotoInternal({
      photoId,
      actor,
      context,
      reason,
      session,
    });
  });

  // R2 cleanup ВНЕ транзакции
  if (result.storageKey) {
    storage
      .remove(result.storageKey)
      .catch((err) =>
        console.error(
          "[photo.service] R2 original cleanup failed:",
          err.message,
        ),
      );
  }
  if (result.thumbnailKey) {
    storage
      .remove(result.thumbnailKey)
      .catch((err) =>
        console.error(
          "[photo.service] R2 thumbnail cleanup failed:",
          err.message,
        ),
      );
  }

  return result.photo;
};

const _softDeletePhotoInternal = async ({
  photoId,
  actor,
  context,
  reason,
  session,
}) => {
  const photo = await Photo.findOneActive({ _id: photoId }).session(session);
  if (!photo) throw new NotFoundError("Photo", photoId);
  if (String(photo.doctorUserId) !== String(actor.userId)) {
    throw new ForbiddenError(
      "photo deletion",
      "photo belongs to another doctor",
    );
  }
  if (photo.isDeleted) {
    throw new ConflictError("Photo already deleted");
  }

  // Помечаем все annotations этого фото
  await Annotation.updateMany(
    { photoId: photo._id, isDeleted: false },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: actor.userId,
        isCurrent: false, // снимаем флаг актуальности
      },
    },
    { session },
  );

  // Помечаем сам Photo
  photo.isDeleted = true;
  photo.deletedAt = new Date();
  photo.deletedBy = actor.userId;
  photo.deleteReason = reason;
  await photo.save({ session });

  await auditService.recordAction({
    actor,
    context,
    action: "photo.delete",
    resourceType: "Photo",
    resourceId: photo._id,
    caseId: photo.caseId,
    metadata: { reason },
    session,
  });

  return {
    photo,
    storageKey: photo.storageKey,
    thumbnailKey: photo.thumbnailKey,
  };
};

/* ============================================================
   CASCADE DELETE BY STUDY
   ============================================================
   Вызывается из study.service в рамках транзакции удаления study. */

export const cascadeDeleteByStudy = async ({
  studyId,
  actor,
  context,
  session,
}) => {
  if (!session) {
    throw new Error(
      "cascadeDeleteByStudy requires a session — must be called from a transaction",
    );
  }

  const photos = await Photo.find({ studyId, isDeleted: false }).session(
    session,
  );

  // Сохраняем storage keys для cleanup ПОСЛЕ commit
  const storageKeysToCleanup = [];

  for (const photo of photos) {
    const result = await _softDeletePhotoInternal({
      photoId: photo._id,
      actor,
      context,
      reason: "cascade from study deletion",
      session,
    });
    if (result.storageKey) storageKeysToCleanup.push(result.storageKey);
    if (result.thumbnailKey) storageKeysToCleanup.push(result.thumbnailKey);
  }

  return {
    count: photos.length,
    storageKeysToCleanup,
  };
};

/* ============================================================
   DEFAULT EXPORT
   ============================================================ */

export default {
  uploadPhoto,
  getPhoto,
  getPhotoSignedUrl,
  getThumbnailSignedUrl,
  listPhotosByStudy,
  softDeletePhoto,
  cascadeDeleteByStudy,
};
