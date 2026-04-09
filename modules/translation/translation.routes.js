import express from "express";
import {
  getTranslationForEdit,
  saveTranslationReview,
} from "./translation.controller.js";

const router = express.Router();

router.get("/:entityType/:entityId/:language", getTranslationForEdit);
router.put("/:entityType/:entityId/:language", saveTranslationReview);

export default router;
