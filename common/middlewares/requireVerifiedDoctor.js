// common/middlewares/requireVerifiedDoctor.js
//
// Врач без подтверждённых документов не выписывает рецепты, не пишет в
// медкарту и не публикует от имени платформы.
//
// ЗАЧЕМ. До этого верификация запрещала ровно четыре вещи: публикацию
// сетки расписания, больше пяти пациентов и два ИИ-эндпоинта. Всё
// остальное открывалось одной ролью doctor — приём, диагнозы, рецепты,
// статьи. Рецепт при этом печатается с номером лицензии, который врач
// вписал сам и который никто не проверяет
// (clinic-medical/pdf/prescriptionPayload.js). Запись диагноза в карту и
// рецепт — то, где цена ошибки не в деньгах.
//
// ЧТО СЧИТАЕТСЯ ПОДТВЕРЖДЕНИЕМ. DoctorProfile.verificationStatus ===
// "approved". Это же поле читают прежние ограничители, и второй истины
// заводить не нужно. Отсутствие карточки — САМОЕ непроверенное
// состояние, а не исключение из правил: раньше «нет карточки» означало
// «нет ограничений», и на проде четверо из шести врачей не имели
// карточки вовсе.
//
// СОТРУДНИКИ КЛИНИКИ — ОСОБЫЙ СЛУЧАЙ. У ClinicEmployee нет и не может
// быть DoctorProfile: это внутренняя учётная запись, заведённая самой
// клиникой, и отвечает за неё клиника. Такие запросы пропускаем — их
// ограничивает RBAC клиники, а не платформенная верификация. Отличаем по
// actorType === "employee": когда в сессии есть и userId, и employeeId,
// побеждает userId (см. tenantMiddleware), и врач-пользователь
// проверяется как обычно.

import mongoose from "mongoose";
import DoctorProfile from "../models/DoctorProfile/profileDoctor.js";
import VerificationPolicy from "../models/DoctorVerification/VerificationPolicy.js";
import { getCurrentActorType } from "../context/tenantContext.js";

/* Что именно закрываем. Имена совпадают с полями trustMatrix в
   VerificationPolicy: политика юрисдикции может ослабить правило, но не
   ужесточить его молча. */
export const ДЕЙСТВИЯ = {
  РЕЦЕПТЫ: "allowPrescriptions",
  МЕДКАРТА: "allowMedicalRecords",
  ПУБЛИКАЦИИ: "allowPublishing",
  ТЕЛЕМЕДИЦИНА: "allowTelemedicine",
  ПЛАТЕЖИ: "allowPayments",
  ИИ: "allowAI",
};

/* Что можно непроверенному врачу, если политики для его страны нет.
   Совпадает с уровнем basic в VerificationPolicy. */
const ПО_УМОЛЧАНИЮ = {
  allowPrescriptions: false,
  allowMedicalRecords: false,
  allowPublishing: false,
  allowTelemedicine: false,
  allowPayments: false,
  allowAI: true,
};

/* Политика меняется раз в год, а читается на каждом запросе. Пять минут
   кэша убирают обращение к базе с горячего пути; пустая коллекция (а она
   пустая) кэшируется так же, как заполненная. */
const КЭШ_МС = 5 * 60 * 1000;
const кэш = new Map(); // страна → { матрица, время }

async function матрицаДоверия(страна) {
  const ключ = String(страна || "").trim().toLowerCase() || "—";
  const сейчас = Date.now();
  const было = кэш.get(ключ);
  if (было && сейчас - было.время < КЭШ_МС) return было.матрица;

  let матрица = ПО_УМОЛЧАНИЮ;
  try {
    if (ключ !== "—") {
      const политика = await VerificationPolicy.findOne({
        $or: [
          { jurisdictionCode: new RegExp(`^${ключ}$`, "i") },
          { country: new RegExp(`^${ключ}$`, "i") },
        ],
      })
        .select("trustMatrix")
        .lean();
      if (политика?.trustMatrix?.basic) {
        матрица = { ...ПО_УМОЛЧАНИЮ, ...политика.trustMatrix.basic };
      }
    }
  } catch (err) {
    // База недоступна — правило по умолчанию, то есть более строгое.
    console.error("[верификация] политика не прочитана:", err.message);
  }

  кэш.set(ключ, { матрица, время: сейчас });
  return матрица;
}

/** Сбросить кэш политик — для тестов и для админки, меняющей политику. */
export function сброситьКэшПолитик() {
  кэш.clear();
}

/**
 * @param {string} действие  Одно из ДЕЙСТВИЯ.
 * @param {string} [пояснение]  Что именно нельзя — уходит в текст ответа.
 */
export function требуетВерификации(действие, пояснение = "") {
  return async function проверка(req, res, next) {
    try {
      // Сотрудник клиники: за него отвечает клиника, у него нет карточки.
      if (getCurrentActorType() === "employee" && !req.userId) return next();

      if (!req.userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const профиль = await DoctorProfile.findOne({
        userId: new mongoose.Types.ObjectId(String(req.userId)),
      })
        .select("verificationStatus country")
        .lean();

      if (профиль?.verificationStatus === "approved") return next();

      const матрица = await матрицаДоверия(профиль?.country);
      if (матрица[действие] === true) return next();

      return res.status(403).json({
        success: false,
        code: "DOCTOR_VERIFICATION_REQUIRED",
        // Статус нужен интерфейсу: «документы на проверке» и «документы не
        // поданы» — разные сообщения для человека.
        verificationStatus: профиль?.verificationStatus || "not_submitted",
        message:
          пояснение ||
          "Действие доступно после подтверждения документов врача.",
      });
    } catch (error) {
      console.error("❌ требуетВерификации:", error);
      return res
        .status(500)
        .json({ success: false, message: "Verification check failed" });
    }
  };
}

export default требуетВерификации;
