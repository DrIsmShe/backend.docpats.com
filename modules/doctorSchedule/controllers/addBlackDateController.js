import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

/**
 * @desc Добавить, обновить или снять блокировку дня (исключения)
 * @route GET /schedule/block/add  → просто пример маршрута для теста
 * @route POST /schedule/block/add → добавить блокировку
 * @route DELETE /schedule/block/remove/:date → снять блокировку
 * @access Doctor
 */

export const addBlockDate = async (req, res) => {
  try {
    const userId = req.userId;
    const { date, reason, isDayOff, blockedIntervals, remove } = req.body || {};

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Дата обязательна",
      });
    }

    // 🔹 1. Находим профиль врача
    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });
    }

    const doctorId = profile._id;

    // 🔹 2. Проверяем, есть ли расписание
    let schedule = await DoctorSchedule.findOne({ doctorId });
    if (!schedule) {
      schedule = new DoctorSchedule({
        doctorId,
        weekly: [],
        exceptions: [],
      });
    }

    // 🔹 3. Если remove === true — снимаем блокировку
    if (remove === true) {
      const beforeCount = schedule.exceptions.length;
      schedule.exceptions = schedule.exceptions.filter((e) => e.date !== date);

      if (schedule.exceptions.length < beforeCount) {
        await schedule.save();
        return res.json({
          success: true,
          message: `Блокировка на ${date} успешно снята.`,
          data: schedule,
        });
      } else {
        return res.status(404).json({
          success: false,
          message: "Такой даты не найдено в блокировках.",
        });
      }
    }

    // 🔹 4. Проверяем, не заблокирована ли дата уже
    const existing = schedule.exceptions.find((e) => e.date === date);
    if (existing) {
      // Обновляем существующую запись
      existing.reason = reason || existing.reason;
      existing.isDayOff = isDayOff ?? existing.isDayOff;
      existing.blockedIntervals =
        blockedIntervals && blockedIntervals.length > 0
          ? blockedIntervals
          : existing.blockedIntervals;
    } else {
      // Добавляем новую блокировку
      schedule.exceptions.push({
        date,
        reason: reason || "",
        isDayOff: !!isDayOff,
        blockedIntervals: Array.isArray(blockedIntervals)
          ? blockedIntervals
          : [],
      });
    }

    // 🔹 5. Сохраняем расписание
    await schedule.save();

    res.json({
      success: true,
      message: "✅ Блокировка успешно добавлена или обновлена",
      data: schedule,
    });
  } catch (err) {
    console.error("❌ Ошибка addBlockDate:", err);
    res.status(500).json({
      success: false,
      message: "Ошибка при работе с блокировками",
      error: err.message,
    });
  }
};
export const getBlockedDays = async (req, res) => {
  try {
    const userId = req.userId;

    // 🔹 Находим профиль врача
    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден", data: [] });
    }

    // 🔹 Находим расписание врача
    const schedule = await DoctorSchedule.findOne({
      doctorId: profile._id,
    }).lean();

    if (!schedule) {
      return res.status(200).json({
        success: true,
        message: "У врача нет блокировок",
        data: [],
      });
    }

    // 🔹 Возвращаем массив исключений
    const blocked = schedule.exceptions?.map((ex) => ({
      date: ex.date,
      reason: ex.reason,
      isDayOff: ex.isDayOff,
    }));

    res.json({
      success: true,
      message: "✅ Блокированные дни успешно получены",
      data: blocked || [],
    });
  } catch (err) {
    console.error("❌ Ошибка getBlockedDays:", err);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении блокированных дней",
      error: err.message,
      data: [],
    });
  }
};
