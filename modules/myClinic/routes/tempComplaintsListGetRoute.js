import { Router } from "express";
import tempComplaintsListGetController from "../controllers/TempResultControllers/tempComplaintsListGetController.js";
const router = Router();

router.get("/", tempComplaintsListGetController);
export default router;
