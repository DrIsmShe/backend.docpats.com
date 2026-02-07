import { Router } from "express";
import { confirmationRegister } from "../controllers/confirmationController.js";
const router = Router();

router.post("/", confirmationRegister);

export default router;
