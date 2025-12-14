import { Router } from "express";
import {
  endorseDoctor,
  removeEndorsement,
  getDoctorEndorsements,
  updateEndorseComment,
} from "../controllers/EndorseRecomendationDoctorFromDoctorController.js";

import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import { requireAuthDoctor } from "../../../common/middlewares/requireAuthDoctor.js";

const router = Router();

// теперь здесь нет второй части пути!
router.post(
  "/add/:toDoctorId",
  authMiddleware,
  requireAuthDoctor,
  endorseDoctor
);
router.put(
  "/comment/:toDoctorId",
  authMiddleware,
  requireAuthDoctor,
  updateEndorseComment
);

router.delete(
  "/delete/:toDoctorId",
  authMiddleware,
  requireAuthDoctor,
  removeEndorsement
);

router.get(
  "/get/:doctorId/list",
  authMiddleware,
  requireAuthDoctor,
  getDoctorEndorsements
);

export default router;
