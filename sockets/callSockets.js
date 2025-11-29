export default function registerCallSockets(io, socket, onlineUsers) {
  // Сигналинг WebRTC
  socket.on("call:offer", (data) => {
    const { roomId, offer } = data;
    socket.to(roomId).emit("call:offer", { userId: socket.userId, offer });
  });

  socket.on("call:answer", (data) => {
    const { roomId, answer } = data;
    socket.to(roomId).emit("call:answer", { userId: socket.userId, answer });
  });

  socket.on("call:iceCandidate", (data) => {
    const { roomId, candidate } = data;
    socket.to(roomId).emit("call:iceCandidate", {
      userId: socket.userId,
      candidate,
    });
  });

  // Завершение
  socket.on("call:end", (roomId) => {
    io.to(roomId).emit("call:ended", { userId: socket.userId });
  });
}
