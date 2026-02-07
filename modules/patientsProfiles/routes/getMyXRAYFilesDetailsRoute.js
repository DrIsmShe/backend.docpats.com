import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getXRAYFilesDetailController from "../controllers/getXRAYFilesDetailController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getXRAYFilesDetailController);
export default router;
