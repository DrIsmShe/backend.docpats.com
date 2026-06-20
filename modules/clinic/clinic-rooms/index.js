// server/modules/clinic/clinic-rooms/index.js
//
// Aggregator router for the clinic-rooms submodule.
// Exposes room CRUD. Mounted in clinic/index.js at "/".
//
// Routes are defined with the full "/rooms" prefix inside room.routes.js
// (clinic-departments style), so this is mounted at "/" — NOT "/rooms".

import express from "express";
import roomRoutes from "./routes/room.routes.js";

const router = express.Router();

router.use("/", roomRoutes);

export default router;
