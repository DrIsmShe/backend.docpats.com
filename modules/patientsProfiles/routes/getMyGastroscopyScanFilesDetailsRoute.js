import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyGastroscopyScanFilesDetailsController from "../controllers/getMyGastroscopyScanFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get(
  "/files/:id",
  authMiddleware,
  getMyGastroscopyScanFilesDetailsController
);
export default router;
