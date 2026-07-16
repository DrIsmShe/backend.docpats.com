import { Router } from "express";
import { PolyclinicPatientDeleteController } from "../controllers/PolyclinicPatientDeleteController.js";
import { PolyclinicPatientRestoreController } from "../controllers/PolyclinicPatientRestoreController.js";
import requireAdmin from "./isAdminRoute.js";

const router = Router();

router.delete("/:id", requireAdmin, PolyclinicPatientDeleteController);
router.patch("/restore/:id", requireAdmin, PolyclinicPatientRestoreController);

export default router;
