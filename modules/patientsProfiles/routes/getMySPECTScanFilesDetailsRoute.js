import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getSPECTScanFilesDetailController from "../controllers/getSPECTScanFilesDetailController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getSPECTScanFilesDetailController);
export default router;
