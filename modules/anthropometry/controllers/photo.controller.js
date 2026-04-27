import photoService from "../services/photo.service.js";
import { ValidationError } from "../utils/errors.js";

/* ============================================================
   PHOTO CONTROLLERS
   ============================================================ */

/* POST /studies/:studyId/photos (multipart/form-data) */
export const uploadPhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ValidationError(
        "No file uploaded. Send file in 'photo' field as multipart/form-data.",
      );
    }

    const photo = await photoService.uploadPhoto({
      studyId: req.params.studyId,
      actor: req.actor,
      context: req.context,
      viewType: req.body.viewType,
      file: {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalFilename: req.file.originalname,
      },
    });

    res.status(201).json({ data: photo });
  } catch (err) {
    next(err);
  }
};

/* GET /studies/:studyId/photos */
export const listPhotosByStudy = async (req, res, next) => {
  try {
    const photos = await photoService.listPhotosByStudy({
      studyId: req.params.studyId,
      actor: req.actor,
    });
    res.status(200).json({ data: photos });
  } catch (err) {
    next(err);
  }
};

/* GET /photos/:photoId */
export const getPhoto = async (req, res, next) => {
  try {
    const photo = await photoService.getPhoto({
      photoId: req.params.photoId,
      actor: req.actor,
      context: req.context,
    });
    res.status(200).json({ data: photo });
  } catch (err) {
    next(err);
  }
};

/* GET /photos/:photoId/url */
export const getPhotoSignedUrl = async (req, res, next) => {
  try {
    const result = await photoService.getPhotoSignedUrl({
      photoId: req.params.photoId,
      actor: req.actor,
      context: req.context,
      ttlSeconds: req.query.ttlSeconds,
    });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/* GET /photos/:photoId/thumbnail */
export const getThumbnailSignedUrl = async (req, res, next) => {
  try {
    const result = await photoService.getThumbnailSignedUrl({
      photoId: req.params.photoId,
      actor: req.actor,
      ttlSeconds: req.query.ttlSeconds,
    });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};

/* DELETE /photos/:photoId */
export const softDeletePhoto = async (req, res, next) => {
  try {
    const photo = await photoService.softDeletePhoto({
      photoId: req.params.photoId,
      actor: req.actor,
      context: req.context,
      reason: req.body.reason,
    });
    res.status(200).json({ data: photo });
  } catch (err) {
    next(err);
  }
};

export default {
  uploadPhoto,
  listPhotosByStudy,
  getPhoto,
  getPhotoSignedUrl,
  getThumbnailSignedUrl,
  softDeletePhoto,
};
