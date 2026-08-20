import mongoose from "mongoose";
import User from "../models/Auth/users.js";
import DoctorPrivatePatient from "../models/Polyclinic/DoctorPrivatePatient.js";
import DoctorProfile from "../models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../models/Polyclinic/newPatientPolyclinic.js";
import { resolveEffectivePlan, getLimit } from "../config/aiPlanLimits.js";

/**
 * Сколько уникальных пациентов у врача.
 *
 * Вынесено из middleware, чтобы тем же счётом мог пользоваться код, который
 * заводит пациента не через отдельный маршрут, — например запись врачом
 * нового человека прямо из календаря приёма.
 *
 * @param {ObjectId|string} doctorUserId
 * @returns {Promise<number>}
 */
export async function countDoctorPatients(doctorUserId) {
  const id = new mongoose.Types.ObjectId(String(doctorUserId));

  const [registeredUsers, privatePatients, polyclinicPatients] =
    await Promise.all([
      User.find({
        myDoctors: { $in: [id] },
        role: "patient",
        isDeleted: { $ne: true },
      })
        .select("_id")
        .lean(),

      DoctorPrivatePatient.find({
        doctorUserId: id,
        isDeleted: { $ne: true },
        isArchived: { $ne: true },
      })
        .select("_id")
        .lean(),

      NewPatientPolyclinic.find({
        doctorId: { $in: [id] },
        isDeleted: { $ne: true },
        isArchived: { $ne: true },
      })
        .select("linkedUserId privatePatient")
        .lean(),
    ]);

  const uniquePatients = new Set();
  registeredUsers.forEach((u) => uniquePatients.add(`user_${u._id}`));
  privatePatients.forEach((p) => uniquePatients.add(`private_${p._id}`));
  polyclinicPatients.forEach((p) => {
    if (p.linkedUserId) uniquePatients.add(`user_${p.linkedUserId}`);
    else if (p.privatePatient) uniquePatients.add(`private_${p.privatePatient}`);
  });

  return uniquePatients.size;
}

/**
 * Предел пациентов для врача: -1 — без ограничений.
 * Неверифицированный врач всегда ограничен пятью, каким бы ни был тариф.
 */
export async function resolvePatientLimit(doctorUserId) {
  const id = new mongoose.Types.ObjectId(String(doctorUserId));

  const doctorProfile = await DoctorProfile.findOne({ userId: id })
    .select("verificationStatus")
    .lean();

  // Профиля нет — ограничивать нечего, лимит не применяется.
  if (!doctorProfile) return -1;
  if (doctorProfile.verificationStatus !== "approved") return 5;

  const doctor = await User.findById(id)
    .select(
      "role subscriptionPlan subscriptionEndsAt trialEndsAt features.maxPatients",
    )
    .lean();

  const planLimit = doctor
    ? getLimit(resolveEffectivePlan(doctor), "patientsInOffice")
    : 0;
  return planLimit !== 0 ? planLimit : (doctor?.features?.maxPatients ?? 5);
}

export default async function requireDoctorPatientLimit(req, res, next) {
  try {
    if (!req.user || req.user.role !== "doctor") {
      return next();
    }

    // req.user — это ДОКУМЕНТ User (authMiddleware кладёт его целиком), а не
    // объект сессии. Поля userId у него нет, и прежний
    // `new ObjectId(req.user.userId)` каждый раз порождал СЛУЧАЙНЫЙ id:
    // пациентов считали у несуществующего врача, получали ноль, и лимит
    // не срабатывал никогда. Берём _id, userId оставляем запасным вариантом
    // для вызовов, где сюда кладут объект сессии.
    const doctorUserId = new mongoose.Types.ObjectId(
      String(req.user._id || req.user.userId),
    );

    // ========================
    // 1️⃣ Проверяем верификацию врача
    // ========================

    const doctorProfile = await DoctorProfile.findOne({
      userId: doctorUserId,
    })
      .select("verificationStatus")
      .lean();

    if (!doctorProfile) return next();

    const isVerified = doctorProfile.verificationStatus === "approved";

    // ========================
    // 2️⃣ Собираем УНИКАЛЬНЫХ пациентов
    // ========================

    const [registeredUsers, privatePatients, polyclinicPatients] =
      await Promise.all([
        User.find({
          myDoctors: { $in: [doctorUserId] },
          role: "patient",
          isDeleted: { $ne: true },
        })
          .select("_id")
          .lean(),

        DoctorPrivatePatient.find({
          doctorUserId,
          isDeleted: { $ne: true },
          isArchived: { $ne: true },
        })
          .select("_id")
          .lean(),

        NewPatientPolyclinic.find({
          doctorId: { $in: [doctorUserId] },
          isDeleted: { $ne: true },
          isArchived: { $ne: true },
        })
          .select("linkedUserId privatePatient")
          .lean(),
      ]);

    // создаём Set уникальных пациентов
    const uniquePatients = new Set();

    // зарегистрированные напрямую
    registeredUsers.forEach((u) =>
      uniquePatients.add(`user_${u._id.toString()}`),
    );

    // приватные
    privatePatients.forEach((p) =>
      uniquePatients.add(`private_${p._id.toString()}`),
    );

    // polyclinic (могут ссылаться либо на user, либо на private)
    polyclinicPatients.forEach((p) => {
      if (p.linkedUserId) {
        uniquePatients.add(`user_${p.linkedUserId.toString()}`);
      } else if (p.privatePatient) {
        uniquePatients.add(`private_${p.privatePatient.toString()}`);
      }
    });

    const totalPatients = uniquePatients.size;

    console.log("TOTAL UNIQUE PATIENTS:", totalPatients);

    // ========================
    // 3️⃣ Лимит для НЕ верифицированных
    // ========================

    if (!isVerified) {
      const limit = 5;

      if (totalPatients >= limit) {
        return res.status(403).json({
          success: false,
          code: "VERIFICATION_REQUIRED",
          message: "Please verify your doctor account to add more patients.",
          limit,
          current: totalPatients,
        });
      }

      return next();
    }

    // ========================
    // 4️⃣ Лимит по подписке
    // ========================

    // Предел берём из ДЕЙСТВУЮЩЕГО плана, а не из features.maxPatients.
    //
    // features.maxPatients — кэш, который пишется хуком модели только при
    // изменении subscriptionPlan или subscription.tier. При регистрации
    // subscriptionPlan = null, а subscription.tier = "doctor_free", и хук
    // записывал туда легаси-значение 5. Дальше во время пробного периода
    // ничего не менялось, save не вызывался — и врач, прошедший
    // верификацию, упирался в 5 пациентов вместо сотни, обещанной пробным
    // периодом. Кэш ещё и не умеет протухать: окончание пробного никем не
    // сохраняется, значит и лимит бы не понизился.
    //
    // resolveEffectivePlan считает план каждый раз заново — из роли,
    // сохранённого тарифа и даты окончания пробного. Кэш остаётся
    // запасным вариантом на случай плана без описанного лимита.
    const doctor = await User.findById(doctorUserId)
      .select("role subscriptionPlan subscriptionEndsAt trialEndsAt features.maxPatients")
      .lean();

    const planLimit = doctor
      ? getLimit(resolveEffectivePlan(doctor), "patientsInOffice")
      : 0;
    const maxPatients =
      planLimit !== 0 ? planLimit : (doctor?.features?.maxPatients ?? 5);

    if (maxPatients === -1) return next();

    if (totalPatients >= maxPatients) {
      return res.status(403).json({
        success: false,
        code: "PLAN_LIMIT_REACHED",
        message:
          "You have reached your plan limit. Please upgrade your subscription.",
        limit: maxPatients,
        current: totalPatients,
      });
    }

    next();
  } catch (error) {
    console.error("❌ requireDoctorPatientLimit error:", error);
    return res.status(500).json({
      message: "Unable to check patient limit",
    });
  }
}
