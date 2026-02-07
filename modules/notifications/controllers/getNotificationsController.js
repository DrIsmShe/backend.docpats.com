// server/modules/notifications/controllers/getNotificationsController.js
import mongoose from "mongoose";
import Notification from "../../../common/models/Notification/notification.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

/**
 * Универсальный контроллер уведомлений
 * Работает для doctor / patient / admin
 * Корректно разделяет прочитанные и непрочитанные уведомления
 */
export const getNotificationsController = async (req, res) => {
  try {
    const userId = req.userId?.toString();
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Неавторизованный доступ.",
      });
    }

    const { type = "all" } = req.query;

    // 1️⃣ Проверяем, есть ли профиль врача
    let doctorProfileId = null;
    try {
      const profile = await ProfileDoctor.findOne({ userId })
        .select("_id")
        .lean();
      doctorProfileId = profile?._id?.toString() || null;
    } catch (e) {
      console.warn("⚠️ Ошибка поиска doctorProfile:", e.message);
    }

    // 2️⃣ Приводим ID к ObjectId
    const userObjectId = new mongoose.Types.ObjectId(userId);
    let doctorObjectId = null;
    if (doctorProfileId && mongoose.Types.ObjectId.isValid(doctorProfileId)) {
      doctorObjectId = new mongoose.Types.ObjectId(doctorProfileId);
    }

    // 3️⃣ Условия получателя
    const recipientOr = [
      { userId: userObjectId },
      { targetUser: userObjectId },
      { recipientUserId: userObjectId },
    ];

    if (doctorObjectId) {
      recipientOr.push(
        { doctorProfileId: doctorObjectId },
        { targetDoctorId: doctorObjectId },
        { recipientDoctorProfileId: doctorObjectId }
      );
    }

    // 4️⃣ Строим фильтр по типу уведомлений
    const andConditions = [];
    switch (type) {
      case "unread":
        // ❗ строгий фильтр — только isRead === false
        andConditions.push({ isRead: false });
        andConditions.push({ senderId: { $ne: userObjectId } });
        break;

      case "read":
        // ❗ только isRead === true
        andConditions.push({ isRead: true });
        andConditions.push({ senderId: { $ne: userObjectId } });
        break;

      case "sent":
        // отправленные пользователем
        andConditions.push({ senderId: userObjectId });
        break;

      default:
        // все входящие
        andConditions.push({ senderId: { $ne: userObjectId } });
        break;
    }

    const filter =
      andConditions.length > 0
        ? { $and: [{ $or: recipientOr }, ...andConditions] }
        : { $or: recipientOr };

    // 5️⃣ Aggregation с подсчётом
    const pipeline = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      {
        $group: {
          _id: null,
          all: { $push: "$$ROOT" },
          unreadCount: {
            $sum: { $cond: [{ $eq: ["$isRead", false] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          notifications: "$all",
          unreadCount: 1,
        },
      },
    ];

    const [result] = await Notification.aggregate(pipeline);
    const notifications = result?.notifications || [];
    const unreadCount = result?.unreadCount || 0;

    // 6️⃣ Логи для отладки
    console.log("👤 userId:", userId);
    console.log("👨‍⚕️ doctorProfileId:", doctorProfileId || "нет профиля");
    console.log("📥 filter:", JSON.stringify(filter, null, 2));
    console.log(
      "📦 найдено:",
      notifications.length,
      "непрочитанных:",
      unreadCount
    );

    // 7️⃣ Ответ
    return res.status(200).json({
      success: true,
      message: "✅ Уведомления успешно получены",
      type,
      total: notifications.length,
      unreadCount,
      notifications,
    });
  } catch (err) {
    console.error("❌ Ошибка при получении уведомлений:", err);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при загрузке уведомлений",
      error: err.message,
    });
  }
};
