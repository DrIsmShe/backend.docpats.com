// server/modules/medicalCodes/middlewares/codesAuth.js
//
// Доступ к справочнику кодов.
//
// Устроено как diagnosticsAuth/radiologyAuth: модуль глобальный, не привязан к
// клинике, поэтому common/auth/can.js (он завязан на ClinicMembership) здесь
// неприменим — роль берём из сессии.
//
// Кому открыт: медицинскому персоналу. Справочник МКБ — публичный документ ВОЗ,
// в нём нет ни PHI, ни коммерческой тайны, и прятать его не от чего. Но и
// делать открытым для всех незачем: это рабочий инструмент, а публичный поиск
// по кодам болезней на медицинском сайте читается как «поставь себе диагноз
// сам».
//
// Список ролей — ровно enum поля User.role: doctor, patient, admin,
// clinic_admin, clinic_staff. Пациента не пускаем, остальных пускаем.
// Роли `nurse` среди них НЕТ: медсёстры в проекте — это ClinicEmployee со
// своей ролью внутри клиники, а не User. Сотрудник клиники, работающий по
// employeeId, сюда попадёт как clinic_staff.

import User from "../../../common/models/Auth/users.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { tReq } from "../../../common/i18n/index.js";

const MEDICAL_ROLES = ["doctor", "admin", "clinic_admin", "clinic_staff"];

export const requireMedicalStaff = asyncHandler(async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedError(tReq(req, "app.auth.required"));

  const user = await User.findById(userId).select("_id role isBlocked").lean();
  if (!user) throw new UnauthorizedError(tReq(req, "app.user.notFound"));
  if (user.isBlocked) throw new ForbiddenError(tReq(req, "app.account.blocked"));
  if (!MEDICAL_ROLES.includes(user.role)) {
    throw new ForbiddenError(tReq(req, "app.codeDirectory.medicalStaffOnly"));
  }

  req.codesActor = { userId: user._id, role: user.role };
  next();
});

export default requireMedicalStaff;
