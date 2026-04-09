// server/modules/communication/calls/call.gateway.js
//
// WebRTC Signaling via Socket.IO
// ИСПРАВЛЕНИЯ:
//   1. String() при сравнении userId — защита от ObjectId vs string
//   2. socket.join(`user:${userId}`) — БЕЗ ЭТОГО личные события не доходят!
//      (НО: это нужно добавить в socket_gateway.js, а НЕ здесь)

import CallLogModel from "./callLog.model.js";
import mongoose from "mongoose";
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import User from "../../../common/models/Auth/users.js";
// Active calls: Map<callId, CallSession>
const activeCalls = new Map();

function generateCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function initCallGateway(nsp) {
  nsp.on("connection", (socket) => {
    // String() — защита на случай если userId пришёл как ObjectId
    const userId = String(socket.user.id);

    // ==============================================================
    // INITIATE CALL
    // ==============================================================
    socket.on(
      "call:initiate",
      async ({ dialogId, calleeId, type = "audio" }) => {
        try {
          if (!dialogId || !calleeId) return;

          const calleeIdStr = String(calleeId);

          // Verify caller is participant
          const isParticipant = await DialogParticipant.exists({
            dialogId: new mongoose.Types.ObjectId(dialogId),
            userId: new mongoose.Types.ObjectId(userId),
            isRemoved: { $ne: true },
          });
          if (!isParticipant) {
            console.log(
              `❌ call:initiate — userId ${userId} не участник диалога ${dialogId}`,
            );
            return;
          }

          // Check if callee is already in a call
          for (const [, session] of activeCalls) {
            if (
              (String(session.calleeId) === calleeIdStr ||
                String(session.callerId) === calleeIdStr) &&
              session.status === "ringing"
            ) {
              socket.emit("call:busy", { calleeId: calleeIdStr });
              return;
            }
          }

          const callId = generateCallId();
          activeCalls.set(callId, {
            callId,
            dialogId,
            callerId: userId,
            calleeId: calleeIdStr,
            type,
            status: "ringing",
            startedAt: null,
            logId: null,
          });

          // Save pending log
          try {
            const log = await CallLogModel.create({
              dialogId: new mongoose.Types.ObjectId(dialogId),
              callerId: new mongoose.Types.ObjectId(userId),
              calleeId: new mongoose.Types.ObjectId(calleeIdStr),
              type,
              status: "missed",
            });
            activeCalls.get(callId).logId = log._id.toString();
          } catch (logErr) {
            console.error("call log create error:", logErr.message);
            // не прерываем звонок из-за ошибки лога
          }

          console.log(
            `📞 call:initiate callId=${callId} ${userId} → ${calleeIdStr}`,
          );

          // Notify callee — ВАЖНО: callee должен быть в room user:{calleeId}
          // Это обеспечивает socket_gateway.js: socket.join(`user:${userId}`)
          const caller = await User.findById(userId).select(
            "firstName lastName avatar",
          );
          nsp.to(`user:${calleeIdStr}`).emit("call:incoming", {
            callId,
            dialogId,
            callerId: userId,
            type,
            callerInfo: {
              name: `${caller.firstName} ${caller.lastName}`.trim(),
              avatar: caller.avatar,
            },
          });

          // Confirm to caller
          socket.emit("call:initiated", { callId });

          // Auto-cancel after 45s if no answer
          setTimeout(() => {
            const session = activeCalls.get(callId);
            if (session && session.status === "ringing") {
              session.status = "missed";
              activeCalls.delete(callId);
              nsp.to(`user:${calleeIdStr}`).emit("call:cancelled", { callId });
              socket.emit("call:no_answer", { callId });
              CallLogModel.findByIdAndUpdate(session.logId, {
                status: "missed",
              }).catch(() => {});
              console.log(`📞 call:no_answer callId=${callId}`);
            }
          }, 45_000);
        } catch (err) {
          console.error("call:initiate error:", err);
        }
      },
    );

    // ==============================================================
    // ACCEPT CALL
    // ==============================================================
    socket.on("call:accept", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) {
          console.log(`❌ call:accept — callId ${callId} не найден`);
          return;
        }
        if (session.status !== "ringing") {
          console.log(`❌ call:accept — неверный статус: ${session.status}`);
          return;
        }
        // String() сравнение — главный баг был здесь
        if (String(session.calleeId) !== userId) {
          console.log(
            `❌ call:accept — userId mismatch: session.calleeId=${session.calleeId}, userId=${userId}`,
          );
          return;
        }

        session.status = "active";
        session.startedAt = new Date();

        console.log(`✅ call:accept callId=${callId}`);

        nsp.to(`user:${String(session.callerId)}`).emit("call:accepted", {
          callId,
          calleeId: userId,
        });
      } catch (err) {
        console.error("call:accept error:", err);
      }
    });

    // ==============================================================
    // DECLINE CALL
    // ==============================================================
    socket.on("call:decline", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;
        if (String(session.calleeId) !== userId) return;

        session.status = "declined";
        activeCalls.delete(callId);

        console.log(`❌ call:decline callId=${callId}`);

        nsp
          .to(`user:${String(session.callerId)}`)
          .emit("call:declined", { callId });

        if (session.logId) {
          await CallLogModel.findByIdAndUpdate(session.logId, {
            status: "declined",
          }).catch(() => {});
        }
      } catch (err) {
        console.error("call:decline error:", err);
      }
    });

    // ==============================================================
    // CANCEL CALL
    // ==============================================================
    socket.on("call:cancel", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;
        if (String(session.callerId) !== userId) return;

        activeCalls.delete(callId);

        console.log(`🚫 call:cancel callId=${callId}`);

        nsp
          .to(`user:${String(session.calleeId)}`)
          .emit("call:cancelled", { callId });

        if (session.logId) {
          await CallLogModel.findByIdAndUpdate(session.logId, {
            status: "missed",
          }).catch(() => {});
        }
      } catch (err) {
        console.error("call:cancel error:", err);
      }
    });

    // ==============================================================
    // END CALL
    // ==============================================================
    socket.on("call:end", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;

        const isParticipant =
          String(session.callerId) === userId ||
          String(session.calleeId) === userId;
        if (!isParticipant) return;

        const endedAt = new Date();
        const durationSec = session.startedAt
          ? Math.round((endedAt - session.startedAt) / 1000)
          : null;

        activeCalls.delete(callId);

        console.log(`📵 call:end callId=${callId} duration=${durationSec}s`);

        const peerId =
          String(session.callerId) === userId
            ? String(session.calleeId)
            : String(session.callerId);

        nsp.to(`user:${peerId}`).emit("call:ended", { callId, durationSec });
        socket.emit("call:ended", { callId, durationSec });

        if (session.logId) {
          await CallLogModel.findByIdAndUpdate(session.logId, {
            status: durationSec && durationSec > 0 ? "completed" : "missed",
            startedAt: session.startedAt,
            endedAt,
            durationSec,
          }).catch(() => {});
        }
      } catch (err) {
        console.error("call:end error:", err);
      }
    });

    // ==============================================================
    // WebRTC SIGNALING RELAY
    // ==============================================================
    socket.on("call:offer", ({ callId, offer }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const peerId =
        String(session.callerId) === userId
          ? String(session.calleeId)
          : String(session.callerId);
      nsp.to(`user:${peerId}`).emit("call:offer", { callId, offer });
    });

    socket.on("call:answer", ({ callId, answer }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const peerId =
        String(session.callerId) === userId
          ? String(session.calleeId)
          : String(session.callerId);
      nsp.to(`user:${peerId}`).emit("call:answer", { callId, answer });
    });

    socket.on("call:ice", ({ callId, candidate }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const peerId =
        String(session.callerId) === userId
          ? String(session.calleeId)
          : String(session.callerId);
      nsp.to(`user:${peerId}`).emit("call:ice", { callId, candidate });
    });

    // ==============================================================
    // DISCONNECT
    // ==============================================================
    socket.on("disconnect", async () => {
      for (const [callId, session] of activeCalls) {
        if (
          String(session.callerId) === userId ||
          String(session.calleeId) === userId
        ) {
          const peerId =
            String(session.callerId) === userId
              ? String(session.calleeId)
              : String(session.callerId);

          const endedAt = new Date();
          const durationSec = session.startedAt
            ? Math.round((endedAt - session.startedAt) / 1000)
            : null;

          activeCalls.delete(callId);

          nsp.to(`user:${peerId}`).emit("call:ended", {
            callId,
            durationSec,
            reason: "disconnected",
          });

          if (session.logId) {
            await CallLogModel.findByIdAndUpdate(session.logId, {
              status: session.status === "active" ? "completed" : "missed",
              endedAt,
              durationSec,
            }).catch(() => {});
          }
        }
      }
    });
  });
}
