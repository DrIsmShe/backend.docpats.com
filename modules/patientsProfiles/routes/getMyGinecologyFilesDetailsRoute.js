import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyGinecologyFilesDetailsController from "../controllers/getMyGinecologyFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getMyGinecologyFilesDetailsController);
export default router;
