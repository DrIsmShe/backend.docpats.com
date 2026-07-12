// server/modules/clinic/clinic-pharmacy/routes/requisition.routes.js
//
// Routes for stock requisitions (заявки отделений в аптеку). PRIVATE —
// tenantMiddleware applied upstream in clinic/index.js; permission gates
// (RESOURCES.REQUISITION) live inside the controller. Paths declared here,
// router mounted at "/" in clinic-pharmacy/index.js.

import express from "express";
import {
  listRequisitions,
  getRequisition,
  createRequisition,
  updateRequisitionDraft,
  submitRequisition,
  cancelRequisition,
} from "../controllers/requisition.controller.js";

const router = express.Router();

// Collection
router.get("/pharmacy/requisitions", listRequisitions);
router.post("/pharmacy/requisitions", createRequisition);

// Lifecycle actions (declared before the bare :id patch, defensive ordering)
router.post("/pharmacy/requisitions/:id/submit", submitRequisition);
router.post("/pharmacy/requisitions/:id/cancel", cancelRequisition);

// Item
router.get("/pharmacy/requisitions/:id", getRequisition);
router.patch("/pharmacy/requisitions/:id", updateRequisitionDraft); // draft-only

export default router;
