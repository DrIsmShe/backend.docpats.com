// server/modules/clinic/clinic-pages/models/clinicCustomPage.model.js
//
// ВИТРИНА 2.0 (Часть 2) — произвольные («кастомные») страницы сайта клиники.
//
// Каждая клиника может создавать свои страницы (например «Акции», «О враче»,
// «Цены»), наполняя их теми же блоками, что и витрину. URL такой страницы:
//   /clinics/:slug/dp/:pageSlug
//
// Дочерняя сущность клиники → tenant-scoped (clinicId). layout.blocks хранится
// в ТОМ ЖЕ формате, что clinic.layout.blocks (type/visible/order/config), чтобы
// переиспользовать редактор (LayoutEditor) и рендер (VitrinaRenderer).

import mongoose from "mongoose";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";
import slugify from "slugify";

// Блок страницы — идентичен layoutBlockSchema витрины (намеренно), чтобы
// конструктор и рендер работали без адаптеров.
const pageBlockSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    visible: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    config: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: true },
);

const clinicCustomPageSchema = new mongoose.Schema(
  {
    // tenant: к какой клинике принадлежит страница (ставится плагином/сервисом)
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // человекочитаемый идентификатор в URL (.../dp/:slug). Уникален в клинике.
    slug: { type: String, required: true, trim: true, lowercase: true },

    // ВИТРИНА 2.0 (Часть 6) — двухуровневая иерархия категорий.
    // null  → корневая категория (попадает в главное меню как родитель);
    // задан → подкатегория (попадает в подменю своего родителя).
    // Глубже двух уровней не уходим: у подкатегории parentId всегда корневой.
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicCustomPage",
      default: null,
      index: true,
    },

    // заголовок страницы (для меню/таба/H1 по умолчанию)
    title: { type: String, required: true, trim: true, maxlength: 200 },

    // статус публикации: черновик не отдаётся публично
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },

    // порядок в списках (меню/админка)
    order: { type: Number, default: 0 },

    // контент страницы — блоки в формате витрины
    layout: {
      blocks: { type: [pageBlockSchema], default: () => [] },
    },

    // опциональное SEO (как у разделов витрины)
    seo: {
      title: { type: String, trim: true, maxlength: 200, default: "" },
      description: { type: String, trim: true, maxlength: 400, default: "" },
    },
  },
  { timestamps: true },
);

// tenant-scoping (clinicId) + soft-delete — как у прочих дочерних сущностей.
clinicCustomPageSchema.plugin(tenantScopedPlugin);
clinicCustomPageSchema.plugin(softDeletePlugin);

// slug уникален В ПРЕДЕЛАХ клиники (не глобально). partial — только активные.
clinicCustomPageSchema.index(
  { clinicId: 1, slug: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);
clinicCustomPageSchema.index({ clinicId: 1, status: 1, order: 1 });

// Нормализация slug перед валидацией (как в clinic.model).
clinicCustomPageSchema.pre("validate", function normalizeSlug(next) {
  if (this.slug) {
    this.slug = slugify(this.slug, { lower: true, strict: true });
  } else if (this.title) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  next();
});

const ClinicCustomPage =
  mongoose.models.ClinicCustomPage ||
  mongoose.model("ClinicCustomPage", clinicCustomPageSchema);

export default ClinicCustomPage;
