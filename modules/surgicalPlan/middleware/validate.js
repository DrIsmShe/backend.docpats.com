// server/modules/surgicalPlan/middleware/validate.js

import { ValidationError } from "../../../common/utils/errors.js";

/* ============================================================
   ZOD-ВАЛИДАЦИЯ ЗАПРОСА
   ============================================================
   Тот же приём, что в anthropometry/middleware/validate.js, но
   поверх общих ошибок проекта (common/utils/errors.js), потому
   что этот модуль отдаёт ошибки через общий errorHandler, а не
   через собственный.

   После успеха req[target] заменяется нормализованными данными:
   zod проставляет значения по умолчанию (patientGender), и
   контроллер должен видеть именно их.
   ============================================================ */
export const validate = (schema, target = "body") => (req, _res, next) => {
  const result = schema.safeParse(req[target]);

  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      fields[issue.path.length ? issue.path.join(".") : "_root"] =
        issue.message;
    }
    return next(new ValidationError(`Некорректный ${target}`, { fields }));
  }

  req[target] = result.data;
  return next();
};

export default validate;
