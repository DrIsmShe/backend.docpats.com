// server/modules/clinic/clinic-articles/models/clinicArticle.model.js
//
// ВИТРИНА 2.0 (Часть 3) — СТАТЬИ клиники (рекламный контент витрины).
//
// Статья привязана к странице-категории (ClinicCustomPage). На категории
// блок «Статьи категории» выводит карточки; клик по заголовку открывает детейл:
//   /clinics/:slug/dp/:pageSlug/:articleSlug
//
// ВАЖНО про модерацию (режим «отдельная + флаг статуса, проект может выключить»):
//   - status     управляет КЛИНИКА  (draft|published)
//   - moderation управляет ПРОЕКТ   (ok|disabled) — принудительный рубильник
//   Статья видна публично только если status==="published" И moderation!=="disabled".
//
// Это рекламный контент клиники — он НЕ смешивается со статьями проекта
// (synthesis/научные). Отдельная сущность, отдельная коллекция, своя модерация.

import mongoose from "mongoose";
import { tenantScopedPlugin } from "../../../../common/plugins/tenantScoped.plugin.js";
import { softDeletePlugin } from "../../../../common/plugins/softDelete.plugin.js";
import slugify from "slugify";

const clinicArticleSchema = new mongoose.Schema(
  {
    // tenant
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // страница-категория, к которой привязана статья (одна статья — одна категория)
    pageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicCustomPage",
      required: true,
      index: true,
    },

    // URL детейла: /dp/:pageSlug/:slug — уникален в пределах страницы
    slug: { type: String, required: true, trim: true, lowercase: true },

    // ── контент (структура как в редакторе научных статей) ──
    title: { type: String, required: true, trim: true, maxlength: 300 },
    authors: { type: String, trim: true, maxlength: 300, default: "" },
    excerpt: { type: String, trim: true, maxlength: 600, default: "" }, // аннотация (карточка)
    cover: { type: String, trim: true, default: "" }, // изображение превью (R2 URL)
    body: { type: String, default: "" }, // rich-text HTML (полный текст детейла)
    links: { type: String, trim: true, default: "" }, // ссылки/источники
    // галерея статьи: фото с подписью и описанием (показывается под текстом)
    gallery: {
      type: [
        new mongoose.Schema(
          {
            image: { type: String, trim: true, required: true },
            caption: { type: String, trim: true, maxlength: 200, default: "" },
            description: {
              type: String,
              trim: true,
              maxlength: 2000,
              default: "",
            },
          },
          { _id: false },
        ),
      ],
      default: () => [],
    },
    tags: { type: [String], default: () => [] },
    metaDescription: { type: String, trim: true, maxlength: 400, default: "" },
    metaKeywords: { type: [String], default: () => [] },

    // ── флаги видимости ──
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    // рубильник проекта: disabled принудительно скрывает статью на витрине
    moderation: {
      type: String,
      enum: ["ok", "disabled"],
      default: "ok",
      index: true,
    },
    // причина блокировки (для админки проекта)
    moderationNote: { type: String, trim: true, maxlength: 500, default: "" },

    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

clinicArticleSchema.plugin(tenantScopedPlugin);
clinicArticleSchema.plugin(softDeletePlugin);

// slug уникален в пределах страницы-категории (не глобально)
clinicArticleSchema.index(
  { pageId: 1, slug: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
);
clinicArticleSchema.index({ clinicId: 1, status: 1, order: 1 });

// нормализация slug из title
clinicArticleSchema.pre("validate", function normalizeSlug(next) {
  if (this.slug) {
    this.slug = slugify(this.slug, { lower: true, strict: true });
  } else if (this.title) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  next();
});

const ClinicArticle =
  mongoose.models.ClinicArticle ||
  mongoose.model("ClinicArticle", clinicArticleSchema);

export default ClinicArticle;
