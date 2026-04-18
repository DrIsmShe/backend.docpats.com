import express from "express";
import {
  generate,
  getLimit,
  getMy,
  getMyOne,
} from "./userSynthesis.controller.js";

const router = express.Router();

router.post("/generate", generate); // открытый — гости тоже могут
router.get("/limit", getLimit); // проверить свой лимит
router.get("/my", getMy); // история (только авториз.)
router.get("/my/:id", getMyOne); // одна статья

export default router;
