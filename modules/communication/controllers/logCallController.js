import CallLog from "../../../common/models/Communication/callLog.js";

export const logCallController = async (req, res) => {
  try {
    const { roomId, startedAt, endedAt, durationSec, caller, type } = req.body;

    if (!roomId || !startedAt || !endedAt) {
      return res
        .status(400)
        .json({ success: false, message: "Недостаточно данных" });
    }

    // 🧠 Проверка на дубликат по roomId и времени начала
    const existing = await CallLog.findOne({
      roomId,
      startedAt: { $gte: new Date(new Date(startedAt).getTime() - 2000) }, // ±2 сек
    });

    if (existing) {
      console.log("⚠️ Дубликат звонка обнаружен, запись пропущена:", roomId);
      return res.status(200).json({
        success: true,
        message: "Запись уже существует",
        data: existing,
      });
    }

    // 🆕 Создание новой записи
    const newLog = await CallLog.create({
      roomId,
      startedAt,
      endedAt,
      durationSec,
      caller,
      type,
    });

    return res.status(201).json({ success: true, data: newLog });
  } catch (err) {
    console.error("❌ Ошибка при сохранении звонка:", err);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};
