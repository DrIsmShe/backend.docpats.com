// server/modules/clinic/clinic-consilium/index.js
//
// Thin aggregator for the clinic-consilium module. Mounted in
// clinic/index.js with `router.use("/", clinicConsiliumRouter)`.

import express from "express";
import consiliumRoutes from "./routes/consilium.routes.js";

const router = express.Router();

router.use("/", consiliumRoutes);

export default router;
