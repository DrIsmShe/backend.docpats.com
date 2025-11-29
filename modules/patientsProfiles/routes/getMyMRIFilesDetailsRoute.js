import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMRIlFilesDetailController from "../controllers/getMRIlFilesDetailController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getMRIlFilesDetailController);
export default router;
