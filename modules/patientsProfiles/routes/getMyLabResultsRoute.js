// server/modules/patientsProfiles/routes/getMyLabResultsRoute.js
//
// Patient-side unified lab results (clinic LabResult + legacy LabTest) + PDF.
// Mount in patientsProfiles/index.js:
//   import getMyLabResultsRoute, { labResultPdfRouter } from "./routes/getMyLabResultsRoute.js";
//   router.use("/get-my-lab-results", getMyLabResultsRoute);
//   router.use("/get-my-lab-result-pdf", labResultPdfRouter);
// Final URLs:
//   GET /api/v1/patient-profile/get-my-lab-results
//   GET /api/v1/patient-profile/get-my-lab-result-pdf/:id

import express from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyLabResultsController from "../controllers/getMyLabResultsController.js";
import getMyLabResultPdfController from "../controllers/getMyLabResultPdfController.js";

const router = express.Router();
router.get("/", authMiddleware, getMyLabResultsController);

export const labResultPdfRouter = express.Router();
labResultPdfRouter.get("/:id", authMiddleware, getMyLabResultPdfController);

export default router;
