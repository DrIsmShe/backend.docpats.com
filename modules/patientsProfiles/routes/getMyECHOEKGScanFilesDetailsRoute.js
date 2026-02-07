import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyECHOEKGScanFilesDetailsController from "../controllers/getMyECHOEKGScanFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get(
  "/files/:id",
  authMiddleware,
  getMyECHOEKGScanFilesDetailsController
);
export default router;
