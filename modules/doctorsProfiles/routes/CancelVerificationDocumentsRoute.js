import express from "express";
import CancelVerificationDocumentController from "../controllers/CancelVerificationDocumentController.js";
import ArchiveVerificationDocumentController from "../controllers/archiveVerificationDocumentController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js"; // твой middleware для проверки токена

const router = express.Router();

router.delete("/:documentId/cancel", CancelVerificationDocumentController);

router.put("/:documentId/archive", ArchiveVerificationDocumentController);
export default router;
