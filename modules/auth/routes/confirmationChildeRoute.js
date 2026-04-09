import { Router } from "express";
import { confirmationChildeController } from "../controllers/confirmationChildeController.js";
const router = Router();

router.post("/", confirmationChildeController);

export default router;
