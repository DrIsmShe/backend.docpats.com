// common/models/Seo/seoSubmission.js
//
// Память о том, какие URL уже отправлены в IndexNow и с какой датой
// изменения. Нужна, чтобы каждый прогон слал ТОЛЬКО новое и изменившееся.
//
// Почему память, а не «отправлять всё подряд каждый раз»: поисковики
// считают повторную отправку неизменившихся страниц злоупотреблением и
// понижают доверие к источнику. Sitemap отдаёт полный список — без этой
// коллекции job отправлял бы его целиком каждый час.
//
// Плагин tenantScoped здесь НЕ нужен: данные общие для всей платформы и
// к клинике не относятся. Job работает вне запроса, контекста тенанта у
// него нет, и попытка скоупить такую коллекцию только мешала бы.

import mongoose from "mongoose";

const seoSubmissionSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, unique: true },
    // lastmod из sitemap, формат YYYY-MM-DD. Строкой, а не датой:
    // сравниваем на равенство с тем, что отдаёт sitemap, и приведение
    // типов туда-сюда только добавило бы способов разойтись.
    lastmod: { type: String, default: "" },
    submittedAt: { type: Date, default: Date.now },
  },
  { collection: "seo_indexnow_submissions" },
);

export default mongoose.models.SeoSubmission ||
  mongoose.model("SeoSubmission", seoSubmissionSchema);
