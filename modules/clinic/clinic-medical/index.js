// modules/clinic/clinic-medical/index.js
//
// Aggregator router for the clinic-medical (UMR) module.
// Sprint 2 Phase 2B + 2C + 2C.2.
//
// Mounted at /medical from clinic/index.js.
// Combines:
//   - encounter routes (Phase 2B)  — histories of illness / visits
//   - 5 sub-record routers (Phase 2C) — allergies, chronic, operations,
//     family history, immunization
//   - imaging routes (Phase 2C.2) — CT/MRI/USG studies with file uploads
//
// Final URL examples:
//   /api/v1/clinic/medical/patients/:patientId/encounters
//   /api/v1/clinic/medical/encounters/:encounterId/sign
//   /api/v1/clinic/medical/patients/:patientId/allergies
//   /api/v1/clinic/medical/patients/:patientId/chronic-diseases
//   /api/v1/clinic/medical/patients/:patientId/operations
//   /api/v1/clinic/medical/patients/:patientId/family-history
//   /api/v1/clinic/medical/patients/:patientId/immunizations
//   /api/v1/clinic/medical/patients/:patientId/imaging
//   /api/v1/clinic/medical/imaging/:recordId

import express from "express";

import encounterRoutes from "./routes/medicalHistory.routes.js";
import allergyRoutes from "./routes/allergy.routes.js";
import chronicRoutes from "./routes/chronic.routes.js";
import operationRoutes from "./routes/operation.routes.js";
import familyRoutes from "./routes/family.routes.js";
import immunizationRoutes from "./routes/immunization.routes.js";
import imagingRoutes from "./routes/imaging.routes.js";
import prescriptionRoutes from "./routes/prescription.routes.js";
const router = express.Router();
import labResultRoutes from "./routes/labResult.routes.js";
router.use("/", labResultRoutes);
// All mounted at the same root — each sub-router defines its own
// path prefixes (patients/:patientId/<resource> + <resource>/:recordId),
// so there are no collisions between them.
router.use("/", encounterRoutes);
router.use("/", allergyRoutes);
router.use("/", chronicRoutes);
router.use("/", operationRoutes);
router.use("/", familyRoutes);
router.use("/", immunizationRoutes);
router.use("/", imagingRoutes);
router.use("/", prescriptionRoutes);
export default router;
