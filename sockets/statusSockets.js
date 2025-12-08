import Participant from "../common/models/Communication/Participant.js";

export default function registerStatusSockets(io, socket, onlineUsers) {
  // обновление статуса врача/пациента
  socket.on("status:update", async (status) => {
    await Participant.findOneAndUpdate(
      { userId: socket.userId },
      { isOnline: true, lastSeen: new Date() }
    );
    io.emit("status:change", { userId: socket.userId, status });
  });

  // запрос списка онлайн
  socket.on("status:listOnline", () => {
    const onlineList = Array.from(onlineUsers.keys());
    socket.emit("status:list", onlineList);
  });
}
