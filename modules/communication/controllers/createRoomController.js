export const createRoomController = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const result = await communicationService.createRoom({
      userId,
      userRole,
      ...req.body,
    });

    if (result.existing) {
      return res.status(200).json({
        success: true,
        message: "Комната уже существует",
        room: result.room,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Комната создана",
      room: result.room,
    });
  } catch (err) {
    console.error("❌ Ошибка createRoomController:", err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Ошибка при создании комнаты",
    });
  }
};
