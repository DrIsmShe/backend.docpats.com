import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { upload } from "../../../common/middlewares/uploadMiddleware.js";
import AddVerificationDocumentsController from "../controllers/addVerificationDocumentsController.js";

const router = Router();

router.post(
  "/documents",
  authMiddleware,
  upload.single("file"),
  AddVerificationDocumentsController,
);

export default router;
