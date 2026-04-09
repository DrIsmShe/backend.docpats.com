import { Router } from "express";
import articlesScientificAllController from "../controllers/articlesScientificAllController.js";
const router = Router();

router.get("/", articlesScientificAllController);

export default router;
