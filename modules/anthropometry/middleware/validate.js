import { ValidationError } from "../utils/errors.js";

/* ============================================================
   ZOD VALIDATION MIDDLEWARE
   ============================================================
   Универсальная фабрика middleware для валидации запросов.

   Использование:
     import { z } from "zod";
     import { validate } from "../middleware/validate.js";

     const schema = z.object({
       patientType: z.enum(["registered", "private"]),
       patientId: z.string().min(1),
     });

     router.post("/cases", validate(schema, "body"), createCaseController);

   После успешной валидации заменяет req[target] на нормализованные данные
   (zod может coerce типы — например, "123" → 123 если в схеме z.number()).
   ============================================================ */

export const validate = (schema, target = "body") => {
  if (!["body", "query", "params"].includes(target)) {
    throw new Error(`validate: invalid target "${target}"`);
  }

  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      // Zod issue → структурированные детали
      const fields = {};
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join(".") : "_root";
        fields[path] = issue.message;
      }

      return next(new ValidationError(`Invalid ${target}`, { fields }));
    }

    // Заменяем нормализованными данными
    req[target] = result.data;
    next();
  };
};

export default validate;
