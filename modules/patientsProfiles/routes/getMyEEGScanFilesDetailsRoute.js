import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getEEGScanFilesDetailController from "../controllers/getEEGScanFilesDetailController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getEEGScanFilesDetailController);
export default router;
