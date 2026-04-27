import { Router } from "express";
import * as photoController from "../controllers/photo.controller.js";
import extractActor from "../middleware/extractActor.js";
import validate from "../middleware/validate.js";
import { uploadPhoto, handleMulterError } from "../middleware/photoUpload.js";
import {
  uploadPhotoBodySchema,
  signedUrlQuerySchema,
  deletePhotoSchema,
} from "../validators/photo.validator.js";
import {
  StudyIdParamsSchema,
  PhotoIdParamsSchema,
} from "../validators/_shared.js";

import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

/* ============================================================
   POST /studies/:studyId/photos (multipart/form-data)
   ============================================================
   Порядок middleware важен:
   1. auth — проверка сессии
   2. extractActor — req.actor
   3. uploadPhoto — multer парсит multipart, заполняет req.file и req.body
   4. handleMulterError — multer-специфичные ошибки → ValidationError
   5. validate(params) — проверка studyId
   6. validate(body) — проверка viewType (после multer заполнил body)
   7. controller */
router.post(
  "/studies/:studyId/photos",
  authMiddleware,
  extractActor,
  uploadPhoto,
  handleMulterError,
  validate(StudyIdParamsSchema, "params"),
  validate(uploadPhotoBodySchema, "body"),
  photoController.uploadPhoto,
);

/* GET /studies/:studyId/photos */
router.get(
  "/studies/:studyId/photos",
  authMiddleware,
  extractActor,
  validate(StudyIdParamsSchema, "params"),
  photoController.listPhotosByStudy,
);

/* GET /photos/:photoId */
router.get(
  "/photos/:photoId",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  photoController.getPhoto,
);

/* GET /photos/:photoId/url */
router.get(
  "/photos/:photoId/url",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(signedUrlQuerySchema, "query"),
  photoController.getPhotoSignedUrl,
);

/* GET /photos/:photoId/thumbnail */
router.get(
  "/photos/:photoId/thumbnail",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(signedUrlQuerySchema, "query"),
  photoController.getThumbnailSignedUrl,
);

/* DELETE /photos/:photoId */
router.delete(
  "/photos/:photoId",
  authMiddleware,
  extractActor,
  validate(PhotoIdParamsSchema, "params"),
  validate(deletePhotoSchema, "body"),
  photoController.softDeletePhoto,
);

export default router;
