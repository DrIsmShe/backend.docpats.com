import { Router } from "express";
import changeUserRole from "../controllers/changeUserController.js";
const router = Router();

router.put("/", changeUserRole);

export default router;
