import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyCoronographyScanFilesDetailsController from "../controllers/getMyCoronographyScanFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get(
  "/files/:id",
  authMiddleware,
  getMyCoronographyScanFilesDetailsController
);
export default router;
