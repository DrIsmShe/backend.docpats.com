import express from "express";
import {
  submitMyReview,
  getMyReview,
} from "../controllers/clinicReview.controller.js";

const router = express.Router();

router.post("/", submitMyReview);
router.get("/:clinicId", getMyReview);

export default router;
