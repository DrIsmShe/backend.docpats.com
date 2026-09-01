import cron from "node-cron";
import { prefetchTranslations } from "../modules/translation/translation.prefetch.js";
import { isLocalEnabled } from "../modules/admin/services/localJobSwitches.service.js";

cron.schedule("*/10 * * * *", async () => {
  // Переключатель спрашивается перед каждым проходом, а не при старте:
  // выключать надо уметь на ходу, без перезапуска процесса. Перевод идёт
  // каждые десять минут по всему корпусу и тратит деньги постоянно —
  // именно его чаще всего и нужно остановить срочно.
  if (!(await isLocalEnabled("doctorArticlesTranslation"))) {
    console.log("⏸  Перевод статей врачей выключен в панели — пропускаем");
    return;
  }
  console.log("⏳ Running prefetch...");
  await prefetchTranslations();
});
