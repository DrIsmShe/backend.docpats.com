// routes/getMyLablFilesDetailsRoute.js
import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyLablFilesDetailsController from "../controllers/getMyLablFilesDetailsController.js";

const router = Router();
router.get("/files/:id", authMiddleware, getMyLablFilesDetailsController);
export default router;
