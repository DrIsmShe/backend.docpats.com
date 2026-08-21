// __tests__/communication/dialogCallLog.test.js
//
// Журнал парных звонков не должен зависеть от порядка загрузки моделей.
//
// В проекте два разных журнала звонков: этот описывает вызов «кто кому»
// из переписки, а common/models/Communication/callLog.js — видеосессию
// (roomId, callSessionId, качество связи). Оба регистрировались под
// именем "CallLog" через `mongoose.models.CallLog || mongoose.model(...)`.
//
// Такая запись не защищает от столкновения, а маскирует его: побеждает
// модель, загрузившаяся первой, вторая молча получает ЧУЖУЮ схему.
// Первым стартует ModelLoader с common/models/**, поэтому шлюз звонков
// получал схему видеосессии, и каждая попытка записать «кто кому
// позвонил» падала валидацией:
//
//   startedAt required, callSessionId required, roomId required,
//   status `missed` is not a valid enum value
//
// Ошибка печаталась в консоль и проглатывалась — снаружи всё выглядело
// исправно, а журнал парных звонков не пополнялся ни разу.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import DialogCallLog from "../../modules/communication/calls/callLog.model.js";
import VideoSessionLog from "../../common/models/Communication/callLog.js";

const oid = () => new mongoose.Types.ObjectId();

describe("журнал парных звонков", () => {
  it("это отдельная модель, а не чужая схема под тем же именем", () => {
    expect(DialogCallLog.modelName).toBe("DialogCallLog");
    expect(VideoSessionLog.modelName).toBe("CallLog");
    expect(DialogCallLog.collection.name).not.toBe(
      VideoSessionLog.collection.name,
    );
  });

  it("пишется ровно тем набором полей, который шлёт шлюз звонков", async () => {
    // Один в один с call.gateway.js: на входящем вызове известны только
    // диалог, звонящий, вызываемый и тип. Звонок ещё не принят, поэтому
    // статус — missed, а startedAt появится позже.
    const log = await DialogCallLog.create({
      dialogId: oid(),
      callerId: oid(),
      calleeId: oid(),
      type: "video",
      status: "missed",
    });

    expect(log._id).toBeTruthy();
    expect(log.status).toBe("missed");
    expect(log.startedAt).toBeUndefined();
    expect(log.durationSec).toBeNull();
  });

  it("дозаполняется по завершении звонка", async () => {
    const log = await DialogCallLog.create({
      dialogId: oid(),
      callerId: oid(),
      calleeId: oid(),
      type: "audio",
      status: "missed",
    });

    const startedAt = new Date("2026-08-21T10:00:00Z");
    const endedAt = new Date("2026-08-21T10:02:30Z");
    const updated = await DialogCallLog.findByIdAndUpdate(
      log._id,
      { status: "completed", startedAt, endedAt, durationSec: 150 },
      { new: true },
    );

    expect(updated.status).toBe("completed");
    expect(updated.durationSec).toBe(150);
  });

  it("чужой статус не проходит", async () => {
    await expect(
      DialogCallLog.create({
        dialogId: oid(),
        callerId: oid(),
        calleeId: oid(),
        status: "ended", // статус ВИДЕОСЕССИИ, не парного звонка
      }),
    ).rejects.toThrow(/status/i);
  });
});
