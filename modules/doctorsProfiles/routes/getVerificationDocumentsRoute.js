import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import getVerificationDocumentsController from "../controllers/getVerificationDocumentsController.js";
import GetMyVerificationDocumentsController from "../controllers/GetMyVerificationDocumentsController.js";
const router = Router();

// Маршрут без параметра userId, защищённый аутентификацией
router.get("/status", authMiddleware, getVerificationDocumentsController);
router.get(
  "/my-verification-documents",
  authMiddleware,
  GetMyVerificationDocumentsController,
);

export default router;
