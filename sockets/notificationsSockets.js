import Notification from "../common/models/Notification/notification.js";

export default function registerNotificationSockets(io, socket, onlineUsers) {
  // Получение уведомлений по запросу
  socket.on("notifications:get", async (userId) => {
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    socket.emit("notifications:list", notifications);
  });

  // Пометка как прочитано
  socket.on("notifications:read", async (notifId) => {
    await Notification.findByIdAndUpdate(notifId, { isRead: true });
    socket.emit("notifications:updated", { notifId, isRead: true });
  });

  // Отправка уведомления (глобально)
  socket.on("notifications:send", (data) => {
    const { userId, payload } = data;
    if (onlineUsers.has(userId)) {
      io.to(userId).emit("notification:new", payload);
    }
  });
}
