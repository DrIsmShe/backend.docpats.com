import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyCapsuleEndoscopyFilesDetailsController from "../controllers/getMyCapsuleEndoscopyFilesDetailsController.js";

const router = Router();
// используем :id, но контроллер также понимает :ctId — на случай старых ссылок
router.get(
  "/files/:id",
  authMiddleware,
  getMyCapsuleEndoscopyFilesDetailsController
);
export default router;
