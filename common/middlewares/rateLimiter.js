import rateLimit from "express-rate-limit";

const emailLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 10, // Разрешено 10 запросов в минуту
  message: "Слишком много попыток, попробуйте позже",
});

export default emailLimiter;
