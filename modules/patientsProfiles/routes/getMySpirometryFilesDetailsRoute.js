import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMySpirometryFilesDetailsController from "../controllers/getMySpirometryFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getMySpirometryFilesDetailsController);
export default router;
