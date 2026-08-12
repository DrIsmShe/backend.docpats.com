// server/modules/ebm/middlewares/ebmAuth.js
//
// Доступ к поиску доказательств.
//
// Устроено как codesAuth/radiologyAuth: модуль глобальный, не привязан к
// клинике, поэтому common/auth/can.js (он завязан на ClinicMembership) здесь
// неприменим — роль берём из сессии.
//
// ПОЧЕМУ ТОЛЬКО ВРАЧАМ, хотя сам PubMed открыт всему миру. Прячем не данные, а
// интерфейс. PubMed отдаёт список исследований, и прочитать его — отдельный
// навык: мета-анализ по препарату не означает, что препарат показан
// конкретному человеку, а «рекомендации» — это рекомендации для системы
// здравоохранения, а не назначение. Пациенту такая страница читается как
// «назначь себе лечение сам, вот же доказательства». Кто хочет — идёт на
// pubmed.ncbi.nlm.nih.gov напрямую, мы ничего не закрываем.
//
// Есть и вторая причина, техническая: каждый поиск — до шести обращений к
// NCBI, а лимит там на IP сервера, общий на весь проект. Открытый доступ
// означает, что первый же обход роботом отнимет PubMed у врачей.
//
// Список ролей — ровно enum поля User.role: doctor, patient, admin,
// clinic_admin, clinic_staff. Пациента не пускаем, остальных пускаем. Роли
// `nurse` среди них нет: медсёстры в проекте — это ClinicEmployee со своей
// ролью внутри клиники, а не User, и сюда попадут как clinic_staff.

import User from "../../../common/models/Auth/users.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";

const MEDICAL_ROLES = ["doctor", "admin", "clinic_admin", "clinic_staff"];

export const requireMedicalStaff = asyncHandler(async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedError("Требуется авторизация");

  const user = await User.findById(userId).select("_id role isBlocked").lean();
  if (!user) throw new UnauthorizedError("Пользователь не найден");
  if (user.isBlocked) throw new ForbiddenError("Аккаунт заблокирован");
  if (!MEDICAL_ROLES.includes(user.role)) {
    throw new ForbiddenError(
      "Поиск доказательств доступен медицинскому персоналу",
    );
  }

  req.ebmActor = { userId: user._id, role: user.role };
  next();
});

export default requireMedicalStaff;
