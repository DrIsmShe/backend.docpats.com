import { Router } from "express";

const router = Router();

import { updateVideoSessionController } from "../controllers/updateVideoSessionController.js";

router.put("/:appointmentId", updateVideoSessionController);
export default router;
