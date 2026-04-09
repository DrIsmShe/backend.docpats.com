import { Router } from "express";
import requireAdmin from "../middlewares/authvalidateMiddleware/requireAdmin.js";
import exportCollectionController from "../controllers/exportCollectionController.js";
import getCollectionsController from "../controllers/getCollectionsController.js";
import exportDatabaseController from "../controllers/exportDatabaseController.js";
import importCollectionController from "../controllers/adminImportCollection.controller.js";
import { importAllController } from "../controllers/importAllController.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() }); // ← только одна строка
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

router.post(
  "/import-all",
  requireAdmin,
  upload.single("file"),
  importAllController,
);

export default router;
