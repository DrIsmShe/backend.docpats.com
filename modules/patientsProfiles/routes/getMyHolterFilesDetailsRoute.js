import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyHolterFilesDetailsController from "../controllers/getMyHolterFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get("/files/:id", authMiddleware, getMyHolterFilesDetailsController);
export default router;
