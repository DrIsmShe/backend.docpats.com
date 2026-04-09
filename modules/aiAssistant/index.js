import express from "express";
const router = express.Router();
// DOCTOR PROFILE ROUTES

import AiAssistentRoute from "./routes/AiAssistentRoute.js";

router.use("/generate-clinical-summary", AiAssistentRoute);

export default router;
