// common/utils/cleanupOldNotifications.js
import Notification from "../common/models/Notification/notification.js";

/**
 * Удаляет старые уведомления из базы.
 * По умолчанию — старше 90 дней.
 * Для теста можно временно уменьшить срок (например, до 1 минуты).
 */
export const cleanupOldNotifications = async () => {
  try {
    // ⚙️ Настройка времени жизни уведомлений
    const DAYS_TO_KEEP = 90; // ≈ 1 минута // можно временно изменить на 0.001 (≈1.5 минуты)
    const cutoff = new Date(Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000);

    // 🔍 Для отладки — показываем текущие параметры
    const totalBefore = await Notification.countDocuments();
    console.log("📦 Всего уведомлений в базе:", totalBefore);
    console.log("🗓️ Дата отсечения (cutoff):", cutoff.toISOString());

    // 🧹 Удаляем старые уведомления
    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoff },
    });

    const totalAfter = await Notification.countDocuments();

    // 🧾 Логируем результат
    console.log(
      `🧹 Очистка уведомлений завершена: удалено ${result.deletedCount} старых записей.`
    );
    console.log(`📊 Осталось уведомлений: ${totalAfter}`);
    console.log("✅ Очистка завершена успешно.\n");
  } catch (err) {
    console.error("❌ Ошибка при очистке уведомлений:", err);
  }
};
