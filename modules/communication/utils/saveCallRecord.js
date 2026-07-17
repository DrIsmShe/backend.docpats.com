import CallLog from "../../../common/models/Communication/callLog.js";

// допустимые значения качества связи
const QUALITY_VALUES = ["excellent", "good", "fair", "poor", "unknown"];

/**
 * 💾 Универсальное логирование видеозвонков
 * — создаёт отдельную запись для каждого callSessionId
 * — нормализует качество соединения
 * — обновляет существующую запись только если звонок тот же (по callSessionId)
 */
export const saveCallRecord = async (data = {}) => {
  try {
    // === Вспомогательная функция нормализации ===
    const normalizeQuality = (val) =>
      !val || !QUALITY_VALUES.includes(val) ? "unknown" : val;

    // === Распаковка данных ===
    const {
      callSessionId,
      roomId,
      startedAt,
      endedAt,
      durationSec = 0,
      caller = "unknown",
      callee = "unknown",
      callerUserId = null,
      calleeUserId = null,
      callerName = "",
      calleeName = "",
      callerConnectionQuality,
      calleeConnectionQuality,
      errorReason = null,
      notes = "",
      type = "video",
      status = "ended",
    } = data;

    // === Проверка обязательных данных ===
    if (!roomId || !startedAt || !endedAt) {
      console.warn("⚠️ [saveCallRecord] Недостаточно данных для сохранения:", {
        roomId,
        startedAt,
        endedAt,
      });
      return null;
    }

    // === Нормализация качества связи ===
    const normalizedCallerQuality = normalizeQuality(callerConnectionQuality);
    const normalizedCalleeQuality = normalizeQuality(calleeConnectionQuality);

    // === Проверка существующей записи по callSessionId ===
    let existing = null;
    if (callSessionId) {
      existing = await CallLog.findOne({ callSessionId }).lean();
    }

    if (existing) {

      const updated = await CallLog.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            endedAt,
            durationSec:
              durationSec ||
              Math.round((endedAt - new Date(existing.startedAt)) / 1000),
            status,
            caller,
            callee,
            callerUserId,
            calleeUserId,
            callerName,
            calleeName,
            callerConnectionQuality: normalizedCallerQuality,
            calleeConnectionQuality: normalizedCalleeQuality,
            errorReason,
            notes,
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      return updated;
    }

    // === Если callSessionId не найден — создаём новую запись ===
    const sessionId = callSessionId || `${roomId}-${Date.now()}`;

    const newLog = await CallLog.create({
      callSessionId: sessionId,
      roomId,
      startedAt,
      endedAt,
      durationSec,
      caller,
      callee,
      callerUserId,
      calleeUserId,
      callerName,
      calleeName,
      callerConnectionQuality: normalizedCallerQuality,
      calleeConnectionQuality: normalizedCalleeQuality,
      errorReason,
      notes,
      type,
      status,
    });


    return newLog;
  } catch (err) {
    console.error("❌ [saveCallRecord] Ошибка при сохранении:", err.message);
    return null;
  }
};
