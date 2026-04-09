import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyAngiographyScanFilesDetailsController from "../controllers/getMyAngiographyScanFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get(
  "/files/:id",
  authMiddleware,
  getMyAngiographyScanFilesDetailsController
);
export default router;
