// server/modules/clinic/clinic-pharmacy/index.js
//
// Aggregator for the clinic-pharmacy module. Mounted at "/" in
// server/modules/clinic/index.js, inheriting the tenant context established
// by tenantMiddleware upstream.
//
// Full pharmacy backend:
//   • drug formulary (номенклатура) — drugItem.routes         [п.1]
//   • stock batches (партии/приход/остатки) — drugBatch.routes  [п.2]
//   • requisitions (заявки отделений) — requisition.routes     [п.3]
//   • dispensing (выдача + журнал) — dispense.routes           [п.4]
//   • reports (JSON + PDF за период) — pharmacyReport.routes   [п.5]
//   • suppliers (поставщики) — supplier.routes

import express from "express";
import drugItemRouter from "./routes/drugItem.routes.js";
import drugBatchRouter from "./routes/drugBatch.routes.js";
import requisitionRouter from "./routes/requisition.routes.js";
import dispenseRouter from "./routes/dispense.routes.js";
import pharmacyReportRouter from "./routes/pharmacyReport.routes.js";
import supplierRouter from "./routes/supplier.routes.js";

const router = express.Router();

router.use("/", drugItemRouter);
router.use("/", drugBatchRouter);
router.use("/", requisitionRouter);
router.use("/", dispenseRouter);
router.use("/", pharmacyReportRouter);
router.use("/", supplierRouter);

export default router;
