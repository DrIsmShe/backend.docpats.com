import { Router } from "express";
import articlesAllController from "../controllers/articlesAllController.js";
const router = Router();

router.get("/", articlesAllController);

export default router;
