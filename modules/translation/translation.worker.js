import "dotenv/config";
import mongoose from "mongoose";
import { Worker } from "bullmq";
import { redis } from "../../common/config/redis.js";
import { translate } from "./translation.provider.js";
import { upsertTranslation } from "./translation.repository.js";

// ── подключаем MongoDB ──
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI не задан");
  process.exit(1);
}

mongoose.set("strictQuery", true);
await mongoose.connect(MONGODB_URI, {
  dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
});
console.log("✅ Worker: MongoDB подключена");

// ── воркер ──
const worker = new Worker(
  "translation",
  async (job) => {
    const { entity, entityType, targetLanguage } = job.data;
    console.log(
      `🔧 Worker job: ${entityType}:${entity._id} → ${targetLanguage}`,
    );

    try {
      const translated = await translate({
        title: entity.title,
        content: entity.content,
        abstract: entity.abstract || "",
        fromLanguage: entity.originalLanguage,
        toLanguage: targetLanguage,
      });

      await upsertTranslation({
        entityId: entity._id,
        entityType,
        language: targetLanguage,
        data: translated,
        originalLanguage: entity.originalLanguage,
        version: entity.translationVersion,
      });

      console.log(
        `✅ Translated: ${entityType}:${entity._id} → ${targetLanguage}`,
      );
    } catch (err) {
      console.error(
        `❌ Translation failed [${entityType}:${entity._id} → ${targetLanguage}]:`,
        err.message,
      );
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 3,
  },
);

worker.on("ready", () => console.log("🟢 Worker ready, waiting for jobs..."));
worker.on("failed", (job, err) =>
  console.error(`❌ Job ${job?.id} failed:`, err.message),
);
