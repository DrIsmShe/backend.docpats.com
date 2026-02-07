import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getUSMFilesDetailController from "../controllers/getUSMFilesDetailController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getUSMFilesDetailController);
export default router;
