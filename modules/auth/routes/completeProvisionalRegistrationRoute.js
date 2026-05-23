// server/modules/auth/routes/completeProvisionalRegistrationRoute.js
//
// Mounted at: /auth/complete-provisional-registration
//
//   POST /request    — start activation: validate, send OTP
//   POST /confirm    — verify OTP and apply changes to User
//   POST /resend     — resend OTP (rate-limited)
//
// All endpoints require an authenticated provisional user session.
// blockUnfinishedRegistration middleware lets these through via the
// allowlist in common/middlewares/blockUnfinishedRegistration.middleware.js

import { Router } from "express";
import {
  requestController,
  confirmController,
  resendController,
} from "../controllers/completeProvisional.controller.js";

const router = Router();

router.post("/request", requestController);
router.post("/confirm", confirmController);
router.post("/resend", resendController);

export default router;
