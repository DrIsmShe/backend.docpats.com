import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getCTlFilesDetailController from "../controllers/getMyCTFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getCTlFilesDetailController);
export default router;
