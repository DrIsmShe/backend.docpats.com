// server/__tests__/communication/callConference.test.js

/* ============================================================
   Сигнализация звонка на нескольких участников.

   Тестов на звонки в проекте не было, а именно эта часть только
   что перестала быть парной: сессия хранит participants, комната
   принадлежит звонку, третьего можно позвать в идущий разговор.
   Логика чувствительная — обрыв разговора на ровном месте врач
   заметит немедленно, поэтому она закрывается тестами.

   Сокет и namespace подставные: настоящий Socket.IO здесь не
   нужен, шлюзу от него требуются только on/emit и адресация
   в комнату user:<id>.
   ============================================================ */

import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getCallRoom,
  initCallGateway,
  isCallParticipant,
} from "../../modules/communication/calls/call.gateway.js";
import DialogParticipant from "../../modules/communication/dialogs/dialogParticipant.model.js";

/* ------------------------------------------------------------
   Подставной namespace: копит всё, что улетело в комнаты.
   ------------------------------------------------------------ */
function makeNsp() {
  const sent = []; // { room, event, payload }
  const connections = [];

  const nsp = {
    on(event, handler) {
      if (event === "connection") connections.push(handler);
    },
    to(room) {
      return {
        emit(event, payload) {
          sent.push({ room, event, payload });
        },
      };
    },
    _connect(userId) {
      const handlers = new Map();
      const own = [];
      const socket = {
        user: { id: userId },
        on(event, handler) {
          handlers.set(event, handler);
        },
        emit(event, payload) {
          own.push({ event, payload });
        },
        // вызвать обработчик так, как это сделал бы Socket.IO
        async fire(event, payload) {
          const handler = handlers.get(event);
          if (!handler) return;
          await handler(payload);
        },
        own,
      };
      for (const handler of connections) handler(socket);
      return socket;
    },
    sent,
    // всё, что пришло конкретному пользователю
    toUser(userId, event = null) {
      return sent.filter(
        (m) => m.room === `user:${userId}` && (!event || m.event === event),
      );
    },
    reset() {
      sent.length = 0;
    },
  };

  initCallGateway(nsp);
  return nsp;
}

const oid = () => new mongoose.Types.ObjectId().toString();

// Участники диалога — по ним шлюз проверяет право звонить и звать.
async function joinDialog(dialogId, ...userIds) {
  await DialogParticipant.insertMany(
    userIds.map((userId) => ({
      dialogId: new mongoose.Types.ObjectId(dialogId),
      userId: new mongoose.Types.ObjectId(userId),
      roleInDialog: "doctor",
    })),
  );
}

// Дождаться, пока асинхронные обработчики шлюза добегут до конца.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("сигнализация звонка — пара", () => {
  let nsp, dialogId, alice, bob, aliceSocket, bobSocket;

  beforeEach(async () => {
    nsp = makeNsp();
    dialogId = oid();
    alice = oid();
    bob = oid();
    await joinDialog(dialogId, alice, bob);
    aliceSocket = nsp._connect(alice);
    bobSocket = nsp._connect(bob);
  });

  it("вызов доходит до собеседника, ответ — до звонящего", async () => {
    await aliceSocket.fire("call:initiate", {
      dialogId,
      calleeId: bob,
      type: "video",
    });
    await settle();

    const incoming = nsp.toUser(bob, "call:incoming");
    expect(incoming).toHaveLength(1);

    const callId = aliceSocket.own.find((m) => m.event === "call:initiated")
      ?.payload.callId;
    expect(callId).toBeTruthy();

    await bobSocket.fire("call:accept", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:accepted")).toHaveLength(1);
  });

  it("комната принадлежит звонку, и посторонний в неё не допущен", async () => {
    await aliceSocket.fire("call:initiate", { dialogId, calleeId: bob });
    await settle();
    const callId = aliceSocket.own.find((m) => m.event === "call:initiated")
      .payload.callId;

    // Именно этого не хватало для конференции: пропуск выдаётся по
    // участию в ЗВОНКЕ, а не в переписке.
    expect(getCallRoom(callId)).toBe(`call-${callId}`);
    expect(isCallParticipant(callId, alice)).toBe(true);
    expect(isCallParticipant(callId, bob)).toBe(true);
    expect(isCallParticipant(callId, oid())).toBe(false);
  });

  it("отказ на дозвоне кладёт звонок целиком", async () => {
    await aliceSocket.fire("call:initiate", { dialogId, calleeId: bob });
    await settle();
    const callId = aliceSocket.own.find((m) => m.event === "call:initiated")
      .payload.callId;

    await bobSocket.fire("call:decline", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:declined")).toHaveLength(1);
    expect(isCallParticipant(callId, alice)).toBe(false);
  });

  it("уход собеседника завершает разговор вдвоём — как и раньше", async () => {
    await aliceSocket.fire("call:initiate", { dialogId, calleeId: bob });
    await settle();
    const callId = aliceSocket.own.find((m) => m.event === "call:initiated")
      .payload.callId;
    await bobSocket.fire("call:accept", { callId });
    await settle();
    nsp.reset();

    await bobSocket.fire("call:end", { callId });
    await settle();

    // Оставшийся один — это уже не разговор.
    expect(nsp.toUser(alice, "call:ended")).toHaveLength(1);
    expect(isCallParticipant(callId, alice)).toBe(false);
  });

  it("звонок тому, кто уже в другом разговоре, отбивается как занято", async () => {
    await aliceSocket.fire("call:initiate", { dialogId, calleeId: bob });
    await settle();

    const carol = oid();
    const otherDialog = oid();
    await joinDialog(otherDialog, carol, bob);
    const carolSocket = nsp._connect(carol);

    await carolSocket.fire("call:initiate", {
      dialogId: otherDialog,
      calleeId: bob,
    });
    await settle();

    expect(carolSocket.own.some((m) => m.event === "call:busy")).toBe(true);
  });
});

describe("сигнализация звонка — конференция", () => {
  let nsp, dialogId, pairDialog, alice, bob, carol;
  let aliceSocket, bobSocket, carolSocket, callId;

  beforeEach(async () => {
    nsp = makeNsp();
    dialogId = oid();
    pairDialog = oid();
    alice = oid();
    bob = oid();
    carol = oid();

    await joinDialog(dialogId, alice, bob);
    // Личная переписка Алисы с Кэрол — по ней проверяется право позвать.
    await joinDialog(pairDialog, alice, carol);

    aliceSocket = nsp._connect(alice);
    bobSocket = nsp._connect(bob);
    carolSocket = nsp._connect(carol);

    await aliceSocket.fire("call:initiate", {
      dialogId,
      calleeId: bob,
      type: "video",
    });
    await settle();
    callId = aliceSocket.own.find((m) => m.event === "call:initiated").payload
      .callId;
    await bobSocket.fire("call:accept", { callId });
    await settle();
    nsp.reset();
  });

  it("приглашённый получает вызов и попадает в ту же комнату", async () => {
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();

    const incoming = nsp.toUser(carol, "call:incoming");
    expect(incoming).toHaveLength(1);
    expect(incoming[0].payload.callId).toBe(callId);
    // Флаг нужен экрану входящего: это приглашение в идущий разговор.
    expect(incoming[0].payload.isConference).toBe(true);

    // Пропуск в комнату у приглашённого появляется сразу — иначе
    // приняв вызов, он упёрся бы в отказ при выдаче токена.
    expect(isCallParticipant(callId, carol)).toBe(true);

    await carolSocket.fire("call:accept", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:participant_joined")).toHaveLength(1);
    expect(nsp.toUser(bob, "call:participant_joined")).toHaveLength(1);
  });

  it("второй ответ не шлёт повторное call:accepted инициатору", async () => {
    // Иначе сторона звонящего заново перезапускала бы таймер разговора
    // на каждом входящем участнике.
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await carolSocket.fire("call:accept", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:accepted")).toHaveLength(0);
  });

  it("звать может только участник разговора", async () => {
    const dave = oid();
    const daveSocket = nsp._connect(dave);

    await daveSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();

    expect(nsp.toUser(carol, "call:incoming")).toHaveLength(0);
    expect(isCallParticipant(callId, carol)).toBe(false);
  });

  it("позвать можно только того, с кем есть переписка", async () => {
    const stranger = oid();

    await aliceSocket.fire("call:invite", {
      callId,
      userId: stranger,
      dialogId: pairDialog, // чужой человек в этой переписке не состоит
    });
    await settle();

    expect(nsp.toUser(stranger, "call:incoming")).toHaveLength(0);
    expect(
      aliceSocket.own.some((m) => m.event === "call:invite_failed"),
    ).toBe(true);
  });

  it("отказ приглашённого не обрывает идущий разговор", async () => {
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    nsp.reset();

    await carolSocket.fire("call:decline", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:participant_declined")).toHaveLength(1);
    // Двое, которые уже говорят, продолжают говорить.
    expect(nsp.toUser(alice, "call:ended")).toHaveLength(0);
    expect(nsp.toUser(bob, "call:ended")).toHaveLength(0);
    expect(isCallParticipant(callId, alice)).toBe(true);
    expect(isCallParticipant(callId, bob)).toBe(true);
  });

  it("выход одного из троих не кладёт связь у оставшихся", async () => {
    // Ровно то, из-за чего конференция была невозможна: раньше здесь
    // безусловно завершался весь звонок.
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await carolSocket.fire("call:accept", { callId });
    await settle();
    nsp.reset();

    await carolSocket.fire("call:end", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:participant_left")).toHaveLength(1);
    expect(nsp.toUser(bob, "call:participant_left")).toHaveLength(1);
    expect(nsp.toUser(alice, "call:ended")).toHaveLength(0);
    expect(isCallParticipant(callId, alice)).toBe(true);
    expect(isCallParticipant(callId, bob)).toBe(true);
    expect(isCallParticipant(callId, carol)).toBe(false);
  });

  it("когда остаётся один, разговор закрывается для всех", async () => {
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await carolSocket.fire("call:accept", { callId });
    await settle();

    await carolSocket.fire("call:end", { callId });
    await settle();
    nsp.reset();

    await bobSocket.fire("call:end", { callId });
    await settle();

    expect(nsp.toUser(alice, "call:ended")).toHaveLength(1);
    expect(isCallParticipant(callId, alice)).toBe(false);
  });

  it("обрыв соединения приравнивается к уходу", async () => {
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await carolSocket.fire("call:accept", { callId });
    await settle();
    nsp.reset();

    await carolSocket.fire("disconnect");
    await settle();

    expect(nsp.toUser(alice, "call:participant_left")).toHaveLength(1);
    expect(isCallParticipant(callId, carol)).toBe(false);
  });

  it("четвёртый и пятый добавляются так же, как третий", async () => {
    // Ограничения на число участников в сигнализации нет: participants —
    // обычная карта, и приглашать может любой, кто уже в разговоре.
    const dave = oid();
    const erin = oid();
    const daveDialog = oid();
    const erinDialog = oid();
    // Кэрол зовёт Дэйва — значит, звать может не только начавший звонок.
    await joinDialog(daveDialog, carol, dave);
    await joinDialog(erinDialog, alice, erin);
    const daveSocket = nsp._connect(dave);
    const erinSocket = nsp._connect(erin);

    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await carolSocket.fire("call:accept", { callId });
    await settle();

    await carolSocket.fire("call:invite", {
      callId,
      userId: dave,
      dialogId: daveDialog,
    });
    await settle();
    await daveSocket.fire("call:accept", { callId });
    await settle();

    await aliceSocket.fire("call:invite", {
      callId,
      userId: erin,
      dialogId: erinDialog,
    });
    await settle();
    await erinSocket.fire("call:accept", { callId });
    await settle();

    for (const id of [alice, bob, carol, dave, erin]) {
      expect(isCallParticipant(callId, id)).toBe(true);
    }

    // Состав приходит с сервера, и последняя рассылка знает про всех пятерых.
    const roster = nsp.toUser(erin, "call:participants").at(-1);
    expect(roster.payload.count).toBe(5);
  });

  it("состав рассылается всем, включая только что вошедшего", async () => {
    // Клиентский счётчик здесь и врал: своего собственного входа
    // приглашённый не видит, и остался бы с единицей, сидя втроём.
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    nsp.reset();

    await carolSocket.fire("call:accept", { callId });
    await settle();

    for (const id of [alice, bob, carol]) {
      const roster = nsp.toUser(id, "call:participants").at(-1);
      expect(roster?.payload.count).toBe(3);
    }
  });

  it("из пятерых уходят по одному, и разговор живёт до последней пары", async () => {
    const dave = oid();
    const daveDialog = oid();
    await joinDialog(daveDialog, alice, dave);
    const daveSocket = nsp._connect(dave);

    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await carolSocket.fire("call:accept", { callId });
    await settle();
    await aliceSocket.fire("call:invite", {
      callId,
      userId: dave,
      dialogId: daveDialog,
    });
    await settle();
    await daveSocket.fire("call:accept", { callId });
    await settle();
    nsp.reset();

    // Четверо → трое
    await daveSocket.fire("call:end", { callId });
    await settle();
    expect(nsp.toUser(alice, "call:ended")).toHaveLength(0);
    expect(nsp.toUser(alice, "call:participants").at(-1).payload.count).toBe(3);

    // Трое → двое
    await carolSocket.fire("call:end", { callId });
    await settle();
    expect(nsp.toUser(alice, "call:ended")).toHaveLength(0);
    expect(nsp.toUser(alice, "call:participants").at(-1).payload.count).toBe(2);

    // Двое → один: говорить больше не с кем
    await bobSocket.fire("call:end", { callId });
    await settle();
    expect(nsp.toUser(alice, "call:ended")).toHaveLength(1);
    expect(isCallParticipant(callId, alice)).toBe(false);
  });

  it("одного и того же человека дважды не зовут", async () => {
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();
    await aliceSocket.fire("call:invite", {
      callId,
      userId: carol,
      dialogId: pairDialog,
    });
    await settle();

    expect(nsp.toUser(carol, "call:incoming")).toHaveLength(1);
  });
});
