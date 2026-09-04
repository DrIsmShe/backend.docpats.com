// server/modules/videra/index.js
//
// Кнопка «Снять фильм»: выдаёт ссылку в студию DP-Videra.
//
// Монтируется в главном index.js как
//   app.use("/api/v1/videra", videraRoutes)
// ПОСЛЕ session-middleware: кто пришёл, берётся из req.session.
//
// МОДУЛЬ ГЛОБАЛЬНЫЙ, БЕЗ tenantMiddleware. Данных пациентов здесь нет ни в
// запросе, ни в ответе, а студией пользуются и вне клиники — врач-одиночка
// и пациент. Клиника, если она есть, только подписывает фильм.
//
// И ВРАЧ, И ПАЦИЕНТ. Студия между ними не различает: объяснительный фильм
// нужен обоим, и права на него одинаковые. Разница только в тарифе, а его
// студия читает из пропуска сама.
//
// ЗАПРАШИВАТЬ В МОМЕНТ НАЖАТИЯ. Пропуск живёт пять минут — заготовленный
// при отрисовке страницы протухнет, пока человек читает.

import express from "express";
import { requireSession } from "../../common/middlewares/requireSession.js";
import { asyncHandler } from "../../common/middlewares/errorHandler.js";
import { decryptPHI } from "../../common/utils/phiCrypto.js";
import { resolveEffectivePlan } from "../../common/config/aiPlanLimits.js";
import User from "../../common/models/Auth/users.js";
import ClinicEmployee from "../clinic/clinic-staff/models/clinicEmployee.model.js";
import Clinic from "../clinic/clinic-core/models/clinic.model.js";
import { ссылкаНаСтудию, студияВключена, студия } from "./pass.js";

const router = express.Router();

/** Имя одной строкой. Пусто — не беда: студия просто не подпишет угол. */
function имя(сущность) {
  const части = [
    decryptPHI(сущность?.firstNameEncrypted),
    decryptPHI(сущность?.lastNameEncrypted),
  ].filter((ч) => ч && String(ч).trim());
  return части.join(" ").trim();
}

/**
 * Название клиники — только для подписи фильма.
 *
 * Ошибку здесь глотаем намеренно: клиника в пропуске необязательна, и
 * из-за неё кнопка падать не должна. Без названия фильм выйдет
 * неподписанным, а не не выйдет вовсе.
 */
async function клиника(clinicId) {
  if (!clinicId) return "";
  try {
    const к = await Clinic.findById(clinicId).select("name").lean();
    return к?.name || "";
  } catch {
    return "";
  }
}

/**
 * Есть ли кнопка вообще.
 *
 * Без ключа студия не настроена, и кнопку показывать нельзя: она вела бы
 * на ошибку. Отдельный лёгкий запрос, чтобы страница не заказывала пропуск
 * ради того, чтобы узнать, что заказывать нечего.
 */
router.get("/state", requireSession, (req, res) => {
  res.json({ enabled: студияВключена(), url: студияВключена() ? студия() : null });
});

/**
 * Ссылка «Снять фильм» для того, кто сейчас вошёл.
 *
 * Ни идентификатора, ни роли в запросе нет и быть не должно: всё берётся
 * из сессии. Иначе врач мог бы заказать пропуск от чужого имени.
 */
router.get(
  "/link",
  requireSession,
  asyncHandler(async (req, res) => {
    if (!студияВключена()) {
      return res.status(503).json({ message: "Студия фильмов не настроена" });
    }

    const { userId, employeeId, clinicId } = req.session;

    // userId старше employeeId — тот же порядок, что в tenantMiddleware.
    const кто = userId
      ? await User.findById(userId)
          .select("firstNameEncrypted lastNameEncrypted role subscriptionPlan subscription")
          .lean()
      : await ClinicEmployee.findById(employeeId)
          .select("firstNameEncrypted lastNameEncrypted")
          .lean();

    if (!кто) return res.status(401).json({ message: "Пользователь не найден" });

    const url = ссылкаНаСтудию({
      id: String(userId || employeeId),
      name: имя(кто),
      clinic: await клиника(clinicId),
      // У сотрудника клиники своего тарифа нет — за него платит клиника,
      // и водяной знак снимает её план, а не его.
      plan: userId ? resolveEffectivePlan(кто) : "clinic",
    });

    // Пропуск не кладём ни в один журнал: он открывает студию, пока жив.
    res.set("Cache-Control", "no-store");
    res.json({ url });
  }),
);

export default router;
