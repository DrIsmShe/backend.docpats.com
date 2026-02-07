import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyDoplerFilesDetailsController from "../controllers/getMyDoplerFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getMyDoplerFilesDetailsController);
export default router;
