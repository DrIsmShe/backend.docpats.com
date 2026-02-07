import { Router } from "express";
import requireAdmin from "../middlewares/authvalidateMiddleware/requireAdmin.js";
import exportCollectionController from "../controllers/exportCollectionController.js";
import getCollectionsController from "../controllers/getCollectionsController.js";
import exportDatabaseController from "../controllers/exportDatabaseController.js";
import importCollectionController from "../controllers/adminImportCollection.controller.js";
import multer from "multer";
const upload = multer();
const router = Router();

router.get("/collections", requireAdmin, getCollectionsController);
router.get("/export/:collection", requireAdmin, exportCollectionController);
router.get("/export-all", requireAdmin, exportDatabaseController);

router.post(
  "/import-collection",
  requireAdmin,
  upload.single("file"),
  importCollectionController,
);

export default router;
