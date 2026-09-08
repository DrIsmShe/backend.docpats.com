// server/modules/video/services/videoSubscriberNotify.service.js
//
// «У канала, на который вы подписаны, вышел новый ролик».
//
// ЗАЧЕМ. Подписка до сих пор ничего не приносила: человек нажимал кнопку
// и узнавал о новом ролике, только если сам заходил в ленту подписок. То
// есть кнопка обещала больше, чем делала.
//
// ТОЛЬКО КОЛОКОЛЬЧИК, НЕ ЧАТ. Личное сообщение уместно, когда врач
// обращается к конкретному пациенту (см. patientDelivery.service.js).
// Здесь адресат — толпа подписчиков, и письмо в личку от каждого нового
// ролика превратило бы переписку в рассылку.
//
// РАССЫЛКА НЕ ДОЛЖНА СРЫВАТЬ ПУБЛИКАЦИЮ. Ролик уже опубликован, когда мы
// сюда попадаем; неудача рассылки — это неполученное уведомление, а не
// неопубликованный ролик. Поэтому все ошибки гасятся здесь.
//
// ОДНО УВЕДОМЛЕНИЕ НА РОЛИК. Повторная публикация того же ролика (сняли с
// витрины и вернули) не должна звонить второй раз — отметка стоит на
// самом ролике.

import Notification from "../../../common/models/Notification/notification.js";
import VideoSubscription from "../models/videoSubscription.model.js";

/** Сколько подписчиков извещаем за раз. */
const ПАЧКА = 500;

/**
 * Известить подписчиков канала о новом ролике.
 *
 * @param {object} video   опубликованный ролик (документ mongoose)
 * @returns {Promise<{sent: number}>}
 */
export async function известитьПодписчиков(video) {
  try {
    // Ролик, который уже звонил, молчит: иначе снятие с витрины и
    // возврат обратно рассылали бы уведомление заново.
    if (video.subscribersNotifiedAt) return { sent: 0 };
    if (video.visibility !== "public" || video.phi) return { sent: 0 };

    const канал = video.clinicId
      ? { channelType: "clinic", channelId: video.clinicId }
      : { channelType: "user", channelId: video.ownerId };

    const подписки = await VideoSubscription.find(канал)
      .select("subscriberId")
      .limit(ПАЧКА)
      .lean();

    if (!подписки.length) {
      video.subscribersNotifiedAt = new Date();
      await video.save();
      return { sent: 0 };
    }

    const имя = await имяКанала(канал);

    // insertMany одним запросом: тысяча отдельных сохранений на публикации
    // ролика — это тысяча обращений к базе там, где хватает одного.
    await Notification.insertMany(
      подписки.map((п) => ({
        userId: п.subscriberId,
        senderId: video.clinicId ? null : video.ownerId,
        type: "video_published",
        title: "Новый ролик",
        message: `${имя}: «${video.title}»`,
        i18n: {
          title: "app.notification.videoPublished.title",
          message: "app.notification.videoPublished.message",
          params: { author: имя, title: video.title },
        },
        link: `/videos/${video._id}`,
        meta: { videoId: String(video._id) },
      })),
      // Одно неудачное уведомление не должно отменять остальные.
      { ordered: false },
    );

    video.subscribersNotifiedAt = new Date();
    await video.save();

    return { sent: подписки.length };
  } catch (err) {
    console.warn("[video] подписчики не извещены:", err?.message);
    return { sent: 0 };
  }
}

/** Имя канала для текста уведомления. */
async function имяКанала({ channelType, channelId }) {
  try {
    if (channelType === "clinic") {
      const Clinic = (await import("../../clinic/clinic-core/models/clinic.model.js"))
        .default;
      const клиника = await Clinic.findById(channelId).select("name").lean();
      return клиника?.name || "Клиника";
    }

    const User = (await import("../../../common/models/Auth/users.js")).default;
    const { decryptPHI } = await import("../../../common/utils/phiCrypto.js");
    const автор = await User.findById(channelId)
      .select("firstNameEncrypted lastNameEncrypted")
      .lean();

    const имя = [decryptPHI(автор?.firstNameEncrypted), decryptPHI(автор?.lastNameEncrypted)]
      .filter((ч) => ч && String(ч).trim())
      .join(" ")
      .trim();

    return имя || "DocPats";
  } catch {
    return "DocPats";
  }
}

export default { известитьПодписчиков };
