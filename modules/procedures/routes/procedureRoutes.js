import express from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import createProcedureController from "../controllers/createProcedureController.js";
import {
  listProceduresController,
  getProcedureDayController,
} from "../controllers/listProceduresController.js";
import {
  updateProcedureStatusController,
  postponeProcedureController,
  archiveProcedureController,
} from "../controllers/updateProcedureController.js";

const router = express.Router();

// Порядок важен: литеральный /day/:date должен стоять ДО любого "/:id",
// иначе "day" будет разобрано как идентификатор записи.
router.get("/day/:date", authMiddleware, getProcedureDayController);

router.get("/", authMiddleware, listProceduresController);
router.post("/", authMiddleware, createProcedureController);

router.patch("/:id/status", authMiddleware, updateProcedureStatusController);
router.post("/:id/postpone", authMiddleware, postponeProcedureController);
router.patch("/:id/archive", authMiddleware, archiveProcedureController);

export default router;
