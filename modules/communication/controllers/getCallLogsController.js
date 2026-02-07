import CallLog from "../../../common/models/Communication/callLog.js";

export const getCallLogsController = async (req, res) => {
  try {
    const { role, limit = 50 } = req.query;

    // 🧠 Фильтруем по роли (врач или пациент)
    const filter = role ? { caller: role } : {};

    const logs = await CallLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    res.status(200).json({ success: true, data: logs });
  } catch (err) {
    console.error("❌ Ошибка при получении истории звонков:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};
