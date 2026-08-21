// __tests__/audit/nonObjectIdRef.test.js
//
// Идентификатор, не помещающийся в ObjectId, не должен уносить с собой
// всю запись аудита.
//
// Как это выглядело в бою. Клиент просит пропуск в видеокомнату:
// POST /communication/video/token { kind: "call", id: "call_<ts>_<rnd>" }.
// Маршрут отдавал этот id в resourceId, поле объявлено ObjectId,
// приведение падало — и Mongoose не сохранял ДОКУМЕНТ ЦЕЛИКОМ.
// recordActionAsync ошибку глотает по замыслу (он fire-and-forget), в
// консоль печаталась строка, и всё. Снаружи система выглядела исправной,
// а канонический HIPAA-журнал звонков не пополнялся ни разу.
//
// Потерять идентификатор плохо. Потерять из-за него весь след обращения
// к PHI — несравнимо хуже: именно этот след и есть предмет аудита.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import auditService from "../../modules/audit/services/audit.service.js";
import HIPAAAuditLog from "../../modules/audit/models/AuditLog.model.js";
import { asObjectId, splitRefs } from "../../modules/audit/utils/objectIdRef.js";

const oid = () => new mongoose.Types.ObjectId();
const actor = () => ({ userId: oid(), email: "doc@clinic.example", role: "doctor" });

describe("идентификатор не в форме ObjectId", () => {
  it("запись пишется, а строковый идентификатор уходит в metadata", async () => {
    const callId = "call_1787301883312_qdrdj3";

    const rec = await auditService.recordAction({
      actor: actor(),
      action: "communication.video.token",
      resourceType: "video-room",
      resourceId: callId,
    });

    expect(rec).toBeTruthy();
    expect(rec.resourceId).toBeNull();
    expect(rec.metadata?.resourceRef).toBe(callId);

    // И запись действительно легла в коллекцию, а не только вернулась.
    const found = await HIPAAAuditLog.findById(rec._id).lean();
    expect(found?.metadata?.resourceRef).toBe(callId);
  });

  it("настоящий ObjectId по-прежнему ложится в поле, а не в metadata", async () => {
    const dialogId = oid();

    const rec = await auditService.recordAction({
      actor: actor(),
      action: "communication.video.token",
      resourceType: "video-room",
      resourceId: dialogId,
    });

    expect(String(rec.resourceId)).toBe(String(dialogId));
    expect(rec.metadata?.resourceRef).toBeUndefined();
  });

  it("свои метаданные маршрута не затираются ссылками", async () => {
    const rec = await auditService.recordAction({
      actor: actor(),
      action: "communication.video.token",
      resourceType: "video-room",
      resourceId: "call_1_x",
      metadata: { kind: "call" },
    });

    expect(rec.metadata.kind).toBe("call");
    expect(rec.metadata.resourceRef).toBe("call_1_x");
  });

  it("ObjectId-подобным считается только 24-значный hex", () => {
    // Проверка своя, а не mongoose.isValidObjectId: сегодня они
    // совпадают, но в Mongoose до 6-й версии isValidObjectId принимал
    // ещё и любую 12-символьную строку. Правило аудита не должно менять
    // смысл при обновлении зависимости.
    expect(asObjectId("abcdefghijkl")).toBeNull();
    expect(asObjectId("123456789012")).toBeNull();
    expect(asObjectId("room-42")).toBeNull();
    expect(asObjectId("6a880871407acbffb08ac67f")).toBe(
      "6a880871407acbffb08ac67f",
    );
    // ObjectId приходит объектом чаще, чем строкой.
    const id = oid();
    expect(asObjectId(id)).toBe(String(id));
  });

  it("splitRefs раскладывает все три поля", () => {
    const good = String(oid());
    const { ids, refs } = splitRefs({
      resourceId: "room-42",
      resourceOwnerId: good,
      caseId: null,
    });
    expect(ids).toEqual({ resourceId: null, resourceOwnerId: good, caseId: null });
    expect(refs).toEqual({ resourceRef: "room-42" });
  });
});
