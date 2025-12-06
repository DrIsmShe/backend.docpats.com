import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyEKGScanFilesDetailsController from "../controllers/getMyEKGScanFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getMyEKGScanFilesDetailsController);
export default router;
