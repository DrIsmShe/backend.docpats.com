import { Router } from "express";
import countSCIENTIFICArticlesTodayController from "../controllers/countSCIENTIFICArticlesTodayController.js";
const router = Router();

router.get(
  "/count-scientific-articles-today",
  countSCIENTIFICArticlesTodayController,
);

export default router;
