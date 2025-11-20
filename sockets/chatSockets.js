import Message from "../common/models/Communication/Message.js";
import Participant from "../common/models/Communication/Participant.js";
import Notification from "../common/models/Notification/notification.js";

export default function registerChatSockets(io, socket, onlineUsers) {
  // Вход в комнату чата
  socket.on("chat:join", (roomId) => {
    socket.join(roomId);
    io.to(roomId).emit("chat:userJoined", { userId: socket.userId });
  });

  // Выход
  socket.on("chat:leave", (roomId) => {
    socket.leave(roomId);
    io.to(roomId).emit("chat:userLeft", { userId: socket.userId });
  });

  // Отправка сообщения
  socket.on("chat:message", async (data) => {
    const { roomId, content, type = "text" } = data;

    const message = await Message.create({
      roomId,
      senderId: socket.userId,
      content,
      type,
    });

    io.to(roomId).emit("chat:newMessage", message);

    // Уведомление оффлайн пользователям
    const participants = await Participant.find({ roomId });
    for (const p of participants) {
      if (
        p.userId.toString() !== socket.userId.toString() &&
        !onlineUsers.has(p.userId.toString())
      ) {
        await Notification.create({
          userId: p.userId,
          senderId: socket.userId,
          type: "communication.message.new",
          title: "Новое сообщение",
          message: content.slice(0, 100),
          link: `/communication/room/${roomId}`,
        });
      }
    }
  });

  // typing
  socket.on("chat:typing", ({ roomId, isTyping }) => {
    socket.to(roomId).emit("chat:typing", {
      userId: socket.userId,
      isTyping,
    });
  });

  // read receipts
  socket.on("chat:read", async ({ roomId, messageIds }) => {
    await Message.updateMany(
      { _id: { $in: messageIds } },
      { $addToSet: { readBy: socket.userId } }
    );
    io.to(roomId).emit("chat:readReceipt", {
      userId: socket.userId,
      messageIds,
    });
  });
}
