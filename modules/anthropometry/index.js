// server/modules/anthropometry/index.js

/* ============================================================
   ANTHROPOMETRY MODULE — PUBLIC API
   ============================================================
   Единственная точка входа в модуль для внешнего кода.
   ============================================================ */

import PatientCase from "./models/PatientCase.model.js";
import Study from "./models/Study.model.js";
import Photo from "./models/Photo.model.js";
import Annotation from "./models/Annotation.model.js";
import AuditLog from "./models/AuditLog.model.js";

import rhinoplastyLateralPreset from "./presets/rhinoplasty.lateral.js";

import routes from "./routes/index.js";

/* ---------------------------------
   MODELS
   --------------------------------- */
export const models = {
  PatientCase,
  Study,
  Photo,
  Annotation,
  AuditLog,
};

/* ---------------------------------
   PRESETS
   --------------------------------- */
export const presets = {
  rhinoplasty_lateral: rhinoplastyLateralPreset,
};

// Хелпер: получить preset по коду
export const getPreset = (code) => presets[code] || null;

/* ---------------------------------
   ROUTES
   --------------------------------- */
export { routes };

/* ---------------------------------
   MODULE METADATA
   --------------------------------- */
export const ANTHROPOMETRY_MODULE_VERSION = "0.3.0-dev";

export default {
  models,
  presets,
  getPreset,
  routes,
  version: ANTHROPOMETRY_MODULE_VERSION,
};
