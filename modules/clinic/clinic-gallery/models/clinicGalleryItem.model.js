// server/modules/clinic/clinic-gallery/models/clinicGalleryItem.model.js
//
// ВИТРИНА 2.0 (Часть 4) — ГАЛЕРЕЯ категории. Фото с подписью и описанием,
// привязанные к странице-категории (ClinicCustomPage), как статьи.
// Показываются блоком «Галерея категории» (сетка + лайтбокс).
//
// Проще статей: без status/moderation — видимость фото = видимость категории.

import mongoose from "mongoose";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";

const clinicGalleryItemSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    pageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicCustomPage",
      required: true,
      index: true,
    },
    image: { type: String, required: true, trim: true }, // R2 URL
    caption: { type: String, trim: true, maxlength: 200, default: "" },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

clinicGalleryItemSchema.plugin(tenantScopedPlugin);
clinicGalleryItemSchema.plugin(softDeletePlugin);

clinicGalleryItemSchema.index({ clinicId: 1, pageId: 1, order: 1 });

const ClinicGalleryItem =
  mongoose.models.ClinicGalleryItem ||
  mongoose.model("ClinicGalleryItem", clinicGalleryItemSchema);

export default ClinicGalleryItem;
