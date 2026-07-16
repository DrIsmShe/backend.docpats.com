// __tests__/clinic-telemed/telemed-encryption.test.js
//
// Проверяет, что PHI-поле notes телемед-сессии хранится в БД зашифрованным,
// а через сервис возвращается расшифрованным (round-trip прозрачен).

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import * as telemed from "../../modules/clinic/clinic-telemed/services/telemed.service.js";
import TelemedSession from "../../modules/clinic/clinic-telemed/models/telemedSession.model.js";
import { isEncrypted } from "../../common/utils/phiCrypto.js";

const clinicId = new mongoose.Types.ObjectId();

describe("telemed notes encryption", () => {
  it("хранит notes в БД зашифрованным, но отдаёт расшифрованным", async () => {
    const secret = "Пациент жалуется на боли — конфиденциально";

    const created = await telemed.createSession(clinicId, {
      title: "Консультация",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      notes: secret,
    });

    // Через сервис — расшифровано.
    expect(created.notes).toBe(secret);

    // В сырой БД — зашифровано (формат iv:ciphertext), plaintext там нет.
    const raw = await TelemedSession.collection.findOne({ _id: created._id });
    expect(isEncrypted(raw.notes)).toBe(true);
    expect(raw.notes).not.toContain("боли");

    // Чтение по id — тоже расшифровано.
    const fetched = await telemed.getSessionById(clinicId, created._id);
    expect(fetched.notes).toBe(secret);

    // Обновление notes — снова шифруется и читается прозрачно.
    const updated = await telemed.updateSession(clinicId, created._id, {
      notes: "Новая заметка",
    });
    expect(updated.notes).toBe("Новая заметка");
    const raw2 = await TelemedSession.collection.findOne({ _id: created._id });
    expect(isEncrypted(raw2.notes)).toBe(true);
  });

  it("пустые notes остаются null, не ломаются", async () => {
    const created = await telemed.createSession(clinicId, {
      title: "Без заметок",
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(created.notes).toBeNull();
  });
});
