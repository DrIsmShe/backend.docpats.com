import cron from "node-cron";
import { prefetchTranslations } from "../modules/translation/translation.prefetch.js";

cron.schedule("*/10 * * * *", async () => {
  console.log("⏳ Running prefetch...");
  await prefetchTranslations();
});
