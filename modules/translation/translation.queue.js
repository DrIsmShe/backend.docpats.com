import { Queue } from "bullmq";
import { redis } from "../../common/config/redis.js";

export const translationQueue = new Queue("translation", {
  connection: redis,

  // 🔥 ВОТ ЭТО ГЛАВНОЕ
  limiter: {
    max: 5, // максимум 5 задач
    duration: 1000, // в секунду
  },
});
