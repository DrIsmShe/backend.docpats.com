// server/modules/communication/calls/call.gateway.js
//
// Сигнализация звонков поверх Socket.IO.
//
// ── ЗВОНОК БОЛЬШЕ НЕ ПАРА ────────────────────────────────────────────────
// Раньше сессия хранила callerId и calleeId, и всё — от проверки прав до
// завершения — строилось на «второй стороне». Втроём это не работало в
// принципе: не было места, где держать третьего.
//
// Теперь в сессии живёт participants: Map<userId, "ringing" | "joined">.
// Пара — частный случай с двумя записями, поэтому поведение звонка один на
// один не меняется: собеседник ушёл → в комнате остался один → звонок
// завершён, как и прежде.
//
// ── КОМНАТА ─────────────────────────────────────────────────────────────
// Комната звонка теперь call-<callId>, а не dialog-<dialogId>. Это не
// косметика: пропуск в dialog-комнату сервер выдаёт любому участнику
// диалога, и приглашённый в разговор третий человек такого пропуска
// получить не мог — он не участник чужой личной переписки. Комната,
// привязанная к звонку, живёт ровно столько, сколько звонок, и список
// допущенных берётся отсюда же (см. isCallParticipant — им пользуется
// video.controller при выдаче JWT).
//
// Групповые диалоги ходят другим путём (useVideoRoom → kind:"dialog") и
// этих изменений не касаются: там комната постоянная и общая.

import mongoose from "mongoose";

import User from "../../../common/models/Auth/users.js";
import DialogParticipant from "../dialogs/dialogParticipant.model.js";
import CallLogModel from "./callLog.model.js";

// Map<callId, CallSession>
const activeCalls = new Map();

// Сколько ждём ответа, прежде чем считать вызов пропущенным.
const RING_TIMEOUT_MS = 45_000;

function generateCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ============================================================
   ПУБЛИЧНОЕ API МОДУЛЯ (для выдачи JWT на комнату)
   ============================================================
   video.controller спрашивает отсюда, пускать ли человека в
   комнату звонка. Состояние в памяти процесса — и это осознанно:
   звонок и так живёт только пока жив процесс, а после перезапуска
   сервера сессия всё равно потеряна.
   ============================================================ */

export function getCallRoom(callId) {
  return `call-${callId}`;
}

export function isCallParticipant(callId, userId) {
  const session = activeCalls.get(callId);
  if (!session) return false;
  return session.participants.has(String(userId));
}

export function isCallInitiator(callId, userId) {
  const session = activeCalls.get(callId);
  if (!session) return false;
  return String(session.callerId) === String(userId);
}

/* ============================================================
   ХЕЛПЕРЫ ПО СЕССИИ
   ============================================================ */

const idsWithState = (session, state) =>
  [...session.participants.entries()]
    .filter(([, value]) => value === state)
    .map(([id]) => id);

const joinedIds = (session) => idsWithState(session, "joined");
const ringingIds = (session) => idsWithState(session, "ringing");

function emitToParticipants(nsp, session, event, payload, exceptUserId = null) {
  for (const id of session.participants.keys()) {
    if (exceptUserId && id === String(exceptUserId)) continue;
    nsp.to(`user:${id}`).emit(event, payload);
  }
}

// Состав разговора рассылаем с сервера, а не считаем на клиентах.
// Клиентский счётчик «пришёл/ушёл» врёт как минимум в одном случае:
// приглашённый не получает событие о собственном входе и остался бы с
// цифрой 1, сидя втроём. Источник истины один — сессия.
function broadcastRoster(nsp, session) {
  const joined = joinedIds(session);
  for (const id of session.participants.keys()) {
    nsp.to(`user:${id}`).emit("call:participants", {
      callId: session.callId,
      count: joined.length,
      joined,
    });
  }
}

function clearRingTimer(session, userId) {
  const timer = session.ringTimers.get(String(userId));
  if (timer) {
    clearTimeout(timer);
    session.ringTimers.delete(String(userId));
  }
}

function disposeSession(session) {
  for (const timer of session.ringTimers.values()) clearTimeout(timer);
  session.ringTimers.clear();
  activeCalls.delete(session.callId);
}

// Подпись звонящего. Виртуалы firstName/lastName расшифровывают
// firstNameEncrypted/lastNameEncrypted, поэтому выбирать нужно именно
// зашифрованные поля — выбор «firstName lastName» оставлял бы виртуалу
// пустой источник и в окно входящего уезжало бы «null null».
async function describeUser(userId) {
  try {
    const user = await User.findById(userId).select(
      "firstNameEncrypted lastNameEncrypted username avatar",
    );
    if (!user) return { name: "", avatar: null };
    const full = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    return { name: full || user.username || "", avatar: user.avatar || null };
  } catch (err) {
    console.error("describeUser error:", err.message);
    return { name: "", avatar: null };
  }
}

async function isDialogParticipant(dialogId, userId) {
  if (!mongoose.isValidObjectId(dialogId) || !mongoose.isValidObjectId(userId)) {
    return false;
  }
  return Boolean(
    await DialogParticipant.exists({
      dialogId: new mongoose.Types.ObjectId(dialogId),
      userId: new mongoose.Types.ObjectId(userId),
      isRemoved: { $ne: true },
    }),
  );
}

// Человек уже занят другим звонком?
function isBusyElsewhere(userId, exceptCallId = null) {
  for (const [callId, session] of activeCalls) {
    if (callId === exceptCallId) continue;
    if (session.participants.has(String(userId))) return true;
  }
  return false;
}

async function finishLog(session, status, endedAt = null) {
  if (!session.logId) return;
  const durationSec =
    session.startedAt && endedAt
      ? Math.round((endedAt - session.startedAt) / 1000)
      : null;
  await CallLogModel.findByIdAndUpdate(session.logId, {
    status,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(durationSec != null ? { durationSec } : {}),
  }).catch(() => {});
}

/* ============================================================
   ШЛЮЗ
   ============================================================ */

export function initCallGateway(nsp) {
  nsp.on("connection", (socket) => {
    const userId = String(socket.user.id);

    /* ────────────────────────────────────────────────────────
       НАЧАТЬ ЗВОНОК
       ──────────────────────────────────────────────────────── */
    socket.on("call:initiate", async ({ dialogId, calleeId, type = "audio" }) => {
      try {
        if (!dialogId || !calleeId) return;
        const calleeIdStr = String(calleeId);

        if (!(await isDialogParticipant(dialogId, userId))) return;

        if (isBusyElsewhere(calleeIdStr)) {
          socket.emit("call:busy", { calleeId: calleeIdStr });
          return;
        }

        const callId = generateCallId();
        const session = {
          callId,
          dialogId,
          callerId: userId,
          type,
          status: "ringing",
          startedAt: null,
          logId: null,
          // Инициатор сразу joined: комната открывается у него до того,
          // как кто-то ответит, и пропуск в неё нужен немедленно.
          participants: new Map([
            [userId, "joined"],
            [calleeIdStr, "ringing"],
          ]),
          ringTimers: new Map(),
        };
        activeCalls.set(callId, session);

        // Журнал звонка остаётся парным: модель CallLog описывает вызов
        // «кто кому», и конференция в неё не укладывается. Пишем исходную
        // пару — кто позвонил и кому первому.
        try {
          const log = await CallLogModel.create({
            dialogId: new mongoose.Types.ObjectId(dialogId),
            callerId: new mongoose.Types.ObjectId(userId),
            calleeId: new mongoose.Types.ObjectId(calleeIdStr),
            type,
            status: "missed",
          });
          session.logId = log._id.toString();
        } catch (logErr) {
          console.error("call log create error:", logErr.message);
        }

        const callerInfo = await describeUser(userId);

        // Личная комната user:<id> обеспечивается socket.gateway.js
        nsp.to(`user:${calleeIdStr}`).emit("call:incoming", {
          callId,
          dialogId,
          callerId: userId,
          type,
          callerInfo,
        });

        socket.emit("call:initiated", { callId });

        session.ringTimers.set(
          calleeIdStr,
          setTimeout(() => {
            const live = activeCalls.get(callId);
            if (!live || live.participants.get(calleeIdStr) !== "ringing") return;
            live.participants.delete(calleeIdStr);
            nsp.to(`user:${calleeIdStr}`).emit("call:cancelled", { callId });
            nsp.to(`user:${userId}`).emit("call:no_answer", { callId });
            finishLog(live, "missed");
            disposeSession(live);
          }, RING_TIMEOUT_MS),
        );
      } catch (err) {
        console.error("call:initiate error:", err);
      }
    });

    /* ────────────────────────────────────────────────────────
       ПРИГЛАСИТЬ ТРЕТЬЕГО (и далее) В ИДУЩИЙ ЗВОНОК
       ────────────────────────────────────────────────────────
       dialogId здесь — личная переписка приглашающего с
       приглашаемым, а не диалог, из которого начали звонок.
       Через неё и проверяются права: позвать можно того, с кем
       у тебя уже есть переписка. Иначе кнопка «добавить»
       превратилась бы в способ звонить любому по идентификатору.
       ──────────────────────────────────────────────────────── */
    socket.on("call:invite", async ({ callId, userId: inviteeId, dialogId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;

        // Звать может только тот, кто сам в разговоре.
        if (session.participants.get(userId) !== "joined") return;

        const inviteeIdStr = String(inviteeId);
        if (!inviteeIdStr || inviteeIdStr === userId) return;
        if (session.participants.has(inviteeIdStr)) return;

        const bothInDialog =
          (await isDialogParticipant(dialogId, userId)) &&
          (await isDialogParticipant(dialogId, inviteeIdStr));
        if (!bothInDialog) {
          socket.emit("call:invite_failed", {
            callId,
            userId: inviteeIdStr,
            reason: "not_allowed",
          });
          return;
        }

        if (isBusyElsewhere(inviteeIdStr, callId)) {
          socket.emit("call:invite_failed", {
            callId,
            userId: inviteeIdStr,
            reason: "busy",
          });
          return;
        }

        session.participants.set(inviteeIdStr, "ringing");

        const inviterInfo = await describeUser(userId);

        nsp.to(`user:${inviteeIdStr}`).emit("call:incoming", {
          callId,
          dialogId: session.dialogId,
          callerId: userId,
          type: session.type,
          callerInfo: inviterInfo,
          // Флаг для интерфейса: это не личный вызов, а приглашение в
          // идущий разговор. Экран входящего может сказать об этом прямо.
          isConference: true,
        });

        emitToParticipants(
          nsp,
          session,
          "call:participant_invited",
          { callId, userId: inviteeIdStr },
          inviteeIdStr,
        );

        session.ringTimers.set(
          inviteeIdStr,
          setTimeout(() => {
            const live = activeCalls.get(callId);
            if (!live || live.participants.get(inviteeIdStr) !== "ringing") return;
            live.participants.delete(inviteeIdStr);
            nsp.to(`user:${inviteeIdStr}`).emit("call:cancelled", { callId });
            emitToParticipants(nsp, live, "call:participant_no_answer", {
              callId,
              userId: inviteeIdStr,
            });
          }, RING_TIMEOUT_MS),
        );
      } catch (err) {
        console.error("call:invite error:", err);
      }
    });

    /* ────────────────────────────────────────────────────────
       ПРИНЯТЬ
       ──────────────────────────────────────────────────────── */
    socket.on("call:accept", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;
        if (session.participants.get(userId) !== "ringing") return;

        clearRingTimer(session, userId);
        session.participants.set(userId, "joined");

        const firstAnswer = session.status === "ringing";
        if (firstAnswer) {
          session.status = "active";
          session.startedAt = new Date();
        }

        // Инициатору — прежнее событие: его сторона по нему переходит
        // в активное состояние. Ломать этот контракт незачем.
        if (firstAnswer) {
          nsp.to(`user:${String(session.callerId)}`).emit("call:accepted", {
            callId,
            calleeId: userId,
          });
        }

        emitToParticipants(
          nsp,
          session,
          "call:participant_joined",
          { callId, userId },
          userId,
        );

        broadcastRoster(nsp, session);
      } catch (err) {
        console.error("call:accept error:", err);
      }
    });

    /* ────────────────────────────────────────────────────────
       ОТКЛОНИТЬ
       ────────────────────────────────────────────────────────
       Отказ на этапе дозвона кладёт звонок целиком — как раньше.
       Отказ приглашённого в идущий разговор убирает только его:
       двое, которые уже говорят, не должны обрываться из-за того,
       что третий не захотел.
       ──────────────────────────────────────────────────────── */
    socket.on("call:decline", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;
        if (session.participants.get(userId) !== "ringing") return;

        clearRingTimer(session, userId);
        session.participants.delete(userId);

        if (session.status === "ringing") {
          nsp
            .to(`user:${String(session.callerId)}`)
            .emit("call:declined", { callId });
          await finishLog(session, "declined");
          disposeSession(session);
          return;
        }

        emitToParticipants(nsp, session, "call:participant_declined", {
          callId,
          userId,
        });
        broadcastRoster(nsp, session);
      } catch (err) {
        console.error("call:decline error:", err);
      }
    });

    /* ────────────────────────────────────────────────────────
       ОТМЕНИТЬ (инициатором, пока не ответили)
       ──────────────────────────────────────────────────────── */
    socket.on("call:cancel", async ({ callId }) => {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;
        if (String(session.callerId) !== userId) return;
        if (session.status !== "ringing") return;

        for (const id of ringingIds(session)) {
          nsp.to(`user:${id}`).emit("call:cancelled", { callId });
        }
        await finishLog(session, "missed");
        disposeSession(session);
      } catch (err) {
        console.error("call:cancel error:", err);
      }
    });

    /* ────────────────────────────────────────────────────────
       ЗАВЕРШИТЬ
       ────────────────────────────────────────────────────────
       Кладём трубку — выходим сами. Звонок заканчивается, когда
       в комнате не осталось двоих: разговаривать больше не с кем.
       ──────────────────────────────────────────────────────── */
    socket.on("call:end", async ({ callId }) => {
      await leaveCall(callId, userId, "ended");
    });

    /* ────────────────────────────────────────────────────────
       ОБРЫВ СОЕДИНЕНИЯ
       ──────────────────────────────────────────────────────── */
    socket.on("disconnect", async () => {
      for (const [callId, session] of [...activeCalls]) {
        if (session.participants.has(userId)) {
          await leaveCall(callId, userId, "disconnected");
        }
      }
    });

    async function leaveCall(callId, leaverId, reason) {
      try {
        const session = activeCalls.get(callId);
        if (!session) return;
        if (!session.participants.has(leaverId)) return;

        clearRingTimer(session, leaverId);
        session.participants.delete(leaverId);

        const endedAt = new Date();
        const durationSec = session.startedAt
          ? Math.round((endedAt - session.startedAt) / 1000)
          : null;

        // Ушедшему — подтверждение, что звонок для него закрыт.
        nsp
          .to(`user:${leaverId}`)
          .emit("call:ended", { callId, durationSec, reason });

        // Разговор продолжается, пока в нём остаются двое. Один
        // оставшийся — это уже не разговор, закрываем всем.
        if (joinedIds(session).length >= 2) {
          emitToParticipants(nsp, session, "call:participant_left", {
            callId,
            userId: leaverId,
            reason,
          });
          broadcastRoster(nsp, session);
          return;
        }

        emitToParticipants(nsp, session, "call:ended", {
          callId,
          durationSec,
          reason,
        });
        await finishLog(
          session,
          durationSec && durationSec > 0 ? "completed" : "missed",
          endedAt,
        );
        disposeSession(session);
      } catch (err) {
        console.error("call leave error:", err);
      }
    }
  });
}
