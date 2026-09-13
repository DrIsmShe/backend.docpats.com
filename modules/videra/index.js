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
import {
  resolveEffectivePlan,
  videraFilmsAllowed,
  videraBrandingMode,
} from "../../common/config/aiPlanLimits.js";
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
  if (!clinicId) return { name: "", logo: "" };
  try {
    const к = await Clinic.findById(clinicId).select("name logo").lean();
    return { name: к?.name || "", logo: к?.logo || "" };
  } catch {
    return { name: "", logo: "" };
  }
}

/**
 * Логотип клиники абсолютной ссылкой.
 *
 * Студия стоит на другом сервере и относительный путь у себя не найдёт —
 * знак просто не появится, и понять почему будет неоткуда. Если логотип
 * уже полный URL (R2, CDN), отдаём как есть.
 */
function ссылкаНаЛоготип(logo) {
  const v = String(logo || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  const base = String(process.env.PUBLIC_API_URL || process.env.API_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/${v.replace(/^\/+/, "")}`;
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

    // У сотрудника клиники своего тарифа нет — за него платит клиника,
    // и водяной знак (и лимит фильмов) берётся от её плана, а не его.
    const plan = userId ? resolveEffectivePlan(кто) : "clinic";

    const данныеКлиники = await клиника(clinicId);

    // Чей знак на фильме. Свой логотип разрешён только клиническим
    // тарифам — и только если логотип у клиники действительно загружен:
    // обещать «свой знак» и поставить пустоту хуже, чем оставить наш.
    const режимЗнака = videraBrandingMode(plan);
    const логотип =
      режимЗнака === "own" ? ссылкаНаЛоготип(данныеКлиники.logo) : "";
    const знак = режимЗнака === "own" && !логотип ? "none" : режимЗнака;

    const url = ссылкаНаСтудию({
      id: String(userId || employeeId),
      name: имя(кто),
      clinic: данныеКлиники.name,
      badge: знак,
      logo: логотип,
      /* Роль нужна студии, чтобы кнопка «Отправить в DocPats» вела в ЕГО
         кабинет. Раньше роли в пропуске не было, студия открывала
         /doctor/videos всем подряд, и пациент попадал в чужую зону: её
         страж отвечал 403, и человека уводило на страницу входа.
         Сотрудник клиники — не пациент: его кабинет врачебной половины. */
      role: userId ? кто.role || "patient" : "doctor",
      plan,
      // Сколько фильмов разрешено тарифом: -1 = без лимита, 3 = Free.
      // Считает уже снятые и отказывает в лишнем сама студия.
      films: videraFilmsAllowed(plan),
    });

    // Пропуск не кладём ни в один журнал: он открывает студию, пока жив.
    res.set("Cache-Control", "no-store");
    res.json({ url });
  }),
);

export default router;
