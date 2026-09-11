// server/jobs/doctorVerificationExpiry.job.js
//
// Срок допуска врача: предупредить заранее, снять по истечении.
//
// ПОЧЕМУ ПРЕДУПРЕЖДАТЬ, А НЕ ПРОСТО ОТКЛЮЧАТЬ. Врач узнаёт об истёкшей
// лицензии в тот момент, когда не может выписать рецепт сидящему перед
// ним пациенту. Это не защита пациента, а поломка приёма. Лестница
// −30 / −7 / −1 / день X даёт время переподать документ, и последняя
// ступень — уже не предупреждение, а сообщение о снятии допуска.
//
// ПОЧЕМУ УВЕДОМЛЯЕТСЯ И АДМИНИСТРАТОР. Снятие допуска — событие
// платформы, а не личное дело врача: приём, на который записаны
// пациенты, остаётся без права выписки. Администратор должен узнать
// об этом раньше пациента и успеть продлить, если основание есть.
//
// ПОЧЕМУ СТУПЕНЬ ХРАНИТСЯ В ПРОФИЛЕ. Задание ходит каждую ночь, и без
// отметки «за 30 дней уже сказали» письмо о тридцати днях уходило бы
// тридцать ночей подряд. Отметка сбрасывается при любом сдвиге срока —
// подали новый документ, администратор продлил.
//
// ПОЧЕМУ СНЯТИЕ ДУБЛИРУЕТСЯ СТРАЖЕМ. Это задание может не отработать:
// сервер перезапущен посреди прогона, выключен переменной окружения,
// упал на одном враче из сотни. Поэтому просрочку проверяет ещё и
// common/middlewares/requireVerifiedDoctor.js — на каждом запросе, по
// двум датам. Здесь же меняется статус и уходят письма, то есть то,
// что на горячем пути делать нельзя.
//
// Выключатель: DOCTOR_VERIFICATION_EXPIRY=off. Расписание:
// DOCTOR_VERIFICATION_EXPIRY_CRON (по умолчанию 08:00 UTC).

import cron from "node-cron";
import DoctorProfile, {
  действуетДо,
} from "../common/models/DoctorProfile/profileDoctor.js";
import User from "../common/models/Auth/users.js";
import { notify } from "../modules/notifications/services/notification.service.js";
import {
  СОБЫТИЯ,
  записатьРешение,
} from "../modules/admin/services/doctorVerification.service.js";

/* Ступени предупреждения в днях до конца срока. Ноль — день, когда
   допуск снимается: сообщение уходит уже о снятии, а не о приближении. */
const СТУПЕНИ = [30, 7, 1, 0];

const СУТКИ_МС = 24 * 60 * 60 * 1000;

/** Сколько полных суток осталось до даты. Отрицательное — срок вышел. */
function сутокДо(дата, сейчас) {
  return Math.ceil((new Date(дата).getTime() - сейчас.getTime()) / СУТКИ_МС);
}

/**
 * Какая ступень подходит для оставшегося числа суток.
 *
 * БЛИЖАЙШАЯ из подходящих, а не первая в списке. Здесь стоял
 * СТУПЕНИ.find(), и он возвращал 30 для любого числа дней от 30 до 1:
 * список идёт по убыванию, и 5 <= 30 срабатывало раньше, чем 5 <= 7.
 * Следствие было тихим и скверным — врач, предупреждённый за месяц,
 * больше не получал ни «через 7 дней», ни «завтра»: отметка о сказанном
 * оставалась равной 30, и условие «уже говорили про эту или более
 * близкую ступень» глушило всё до самого дня снятия допуска.
 *
 * 25 дней → 30; 5 дней → 7; 1 день → 1; 0 и меньше → 0 (снятие).
 */
function ступеньДля(осталось) {
  if (осталось <= 0) return 0;
  const подходящие = СТУПЕНИ.filter((с) => с > 0 && осталось <= с);
  return подходящие.length ? Math.min(...подходящие) : null;
}

function датаДляЧеловека(дата, язык = "ru") {
  const карта = { ru: "ru-RU", en: "en-GB", tr: "tr-TR", az: "az-AZ", ar: "ar-AE" };
  return new Date(дата).toLocaleDateString(карта[язык] || "ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Кому из администраторов сообщать. */
async function администраторы() {
  return User.find({ role: "admin" }).select("_id").lean();
}

/**
 * Один прогон.
 *
 * @param {Date} [сейчас] — точка отсчёта; параметр ради тестов, в кроне
 *   всегда текущее время.
 */
export async function проверитьСрокиДопуска(сейчас = new Date()) {
  /* Берём только тех, у кого срок вообще задан. Допуск без срока —
     нормальное состояние (см. DoctorProfile.verificationExpiresAt), и
     трогать его незачем. */
  const профили = await DoctorProfile.find({
    verificationStatus: "approved",
    verificationExpiresAt: { $ne: null },
  })
    .select(
      "userId verificationStatus verificationExpiresAt verificationExtendedUntil " +
        "verificationExpiryNoticeStage firstName lastName",
    )
    .lean();

  if (!профили.length) return { проверено: 0, предупреждено: 0, снято: 0 };

  const админы = await администраторы();
  let предупреждено = 0;
  let снято = 0;

  for (const краткий of профили) {
    try {
      const до = действуетДо(краткий);
      if (!до) continue;

      const осталось = сутокДо(до, сейчас);
      const ступень = ступеньДля(осталось);
      if (ступень === null) continue; // до тридцати дней ещё далеко

      // Уже говорили про эту или более близкую ступень — молчим.
      const сказано = краткий.verificationExpiryNoticeStage;
      if (сказано !== null && сказано !== undefined && сказано <= ступень) {
        continue;
      }

      const профиль = await DoctorProfile.findById(краткий._id);
      if (!профиль) continue;

      const истёк = ступень === 0;

      if (истёк) {
        /* Снятие допуска. Статус expired, а не rejected: документы не
           признаны негодными, у них просто вышел срок. Врач возвращается
           новым документом или продлением от администратора. */
        профиль.verificationStatus = "expired";
        профиль.isVerified = false;
        снято += 1;
      } else {
        предупреждено += 1;
      }

      профиль.verificationExpiryNoticeStage = ступень;
      await профиль.save();

      const пользователь = await User.findById(профиль.userId)
        .select("preferredLanguage")
        .lean();
      const язык = пользователь?.preferredLanguage || "ru";
      const когда = датаДляЧеловека(до, язык);

      /* Врачу. Текст на русском — запасной вариант; настоящий собирается
         из кодов словаря на языке читателя (см. модель Notification). */
      await notify({
        userId: профиль.userId,
        type: "doctor_verification_expiry",
        priority: "high",
        icon: "shield",
        title: истёк
          ? "Допуск приостановлен: истёк срок документа"
          : "Срок ваших документов подходит к концу",
        message: истёк
          ? `Срок действия документов истёк ${когда}. Выписка рецептов и запись в медкарту недоступны, пока вы не подадите действующий документ.`
          : `До окончания срока документов осталось ${осталось} дн. (${когда}). Подайте действующий документ заранее — иначе выписка рецептов и запись в медкарту закроются.`,
        link: "/doctor/verification",
        i18n: {
          title: истёк
            ? "verification.expired.title"
            : "verification.expiring.title",
          message: истёк
            ? "verification.expired.message"
            : "verification.expiring.message",
          params: { days: Math.max(осталось, 0), date: когда },
        },
        meta: { stage: ступень, expiresAt: до.toISOString() },
      }).catch((err) =>
        console.warn("[допуск] врачу не ушло:", err.message),
      );

      /* Администраторам. На ступенях 7, 1 и 0 — на тридцати днях звать
         человека рано: врач ещё сам всё успеет, а ежемесячный поток
         писем «у кого-то через месяц лицензия» приучает их не читать. */
      if (ступень <= 7) {
        for (const админ of админы) {
          await notify({
            userId: админ._id,
            type: "doctor_verification_expiry",
            priority: истёк ? "high" : "normal",
            icon: "shield",
            title: истёк
              ? "У врача снят допуск: истёк срок документа"
              : "У врача истекает срок документов",
            message: истёк
              ? `Допуск снят автоматически ${когда}. Проверьте основания: если врач подал документы на перевыпуск, допуск можно продлить.`
              : `Срок истекает через ${осталось} дн. (${когда}).`,
            link: `/admin/doctors/${профиль._id}`,
            i18n: {
              title: истёк
                ? "verification.adminExpired.title"
                : "verification.adminExpiring.title",
              message: истёк
                ? "verification.adminExpired.message"
                : "verification.adminExpiring.message",
              params: { days: Math.max(осталось, 0), date: когда },
            },
            meta: { doctorProfileId: String(профиль._id), stage: ступень },
          }).catch(() => {});
        }
      }

      /* Снятие допуска — событие журнала, как и решение администратора.
         Актор — система: человека здесь нет, и приписывать решение
         последнему администратору значило бы врать журналу. */
      if (истёк) {
        await записатьРешение({
          действие: СОБЫТИЯ.ИСТЁК,
          администратор: { userId: null, role: "system" },
          профиль,
          сведения: {
            previousStatus: "approved",
            newStatus: "expired",
            expiresAt: до.toISOString(),
            automatic: true,
          },
        }).catch((err) =>
          console.warn("[допуск] снятие не записано в журнал:", err.message),
        );
      }
    } catch (err) {
      // Один сорвавшийся врач не должен уносить весь прогон.
      console.error("[допуск]", String(краткий._id).slice(-6), err.message);
    }
  }

  console.log(
    `🩺 Сроки допуска: проверено ${профили.length}, предупреждено ${предупреждено}, снято ${снято}`,
  );
  return { проверено: профили.length, предупреждено, снято };
}

export function scheduleDoctorVerificationExpiry() {
  if (process.env.DOCTOR_VERIFICATION_EXPIRY === "off") {
    console.log("⏸  Проверка сроков допуска выключена (DOCTOR_VERIFICATION_EXPIRY=off)");
    return;
  }

  const расписание =
    process.env.DOCTOR_VERIFICATION_EXPIRY_CRON || "0 8 * * *";

  cron.schedule(расписание, async () => {
    try {
      await проверитьСрокиДопуска();
    } catch (err) {
      console.error("❌ Проверка сроков допуска упала:", err.message);
    }
  });

  console.log(`🩺 Проверка сроков допуска врачей: ${расписание} UTC`);
}

export default scheduleDoctorVerificationExpiry;
