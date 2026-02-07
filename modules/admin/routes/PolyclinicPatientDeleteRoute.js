import { Router } from "express";
import { PolyclinicPatientDeleteController } from "../controllers/PolyclinicPatientDeleteController.js";
import { PolyclinicPatientRestoreController } from "../controllers/PolyclinicPatientRestoreController.js";

const router = Router();

router.delete("/:id", PolyclinicPatientDeleteController);
router.patch("/restore/:id", PolyclinicPatientRestoreController);

export default router;
