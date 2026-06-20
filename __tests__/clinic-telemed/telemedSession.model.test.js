// server/__tests__/clinic-telemed/telemedSession.model.test.js
//
// Model-level tests: defaults, validation, joinKey uniqueness per clinic,
// tenant scoping. Mongo + cleanup from __tests__/setup.js.
//
// TelemedSession is a DEFAULT export; TELEMED_STATUSES is a named export.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import TelemedSession, {
  TELEMED_STATUSES,
} from "../../modules/clinic/clinic-telemed/models/telemedSession.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await TelemedSession.syncIndexes();
});

describe("TelemedSession model — basics", () => {
  it("applies defaults (status=scheduled, duration=30, optional refs null)", async () => {
    const s = await TelemedSession.create({
      clinicId: CLINIC_A,
      title: "Контрольный приём",
      scheduledAt: new Date(),
      joinKey: "key-1",
    });
    expect(s.status).toBe("scheduled");
    expect(s.durationMinutes).toBe(30);
    expect(s.patientId).toBeNull();
    expect(s.hostMembershipId).toBeNull();
    expect(s.startedAt).toBeNull();
    expect(s.endedAt).toBeNull();
  });

  it("exposes the status enum list", () => {
    expect(TELEMED_STATUSES).toContain("scheduled");
    expect(TELEMED_STATUSES).toContain("live");
    expect(TELEMED_STATUSES).toContain("completed");
    expect(TELEMED_STATUSES).toContain("no_show");
  });
});

describe("TelemedSession model — validation (errors)", () => {
  it("requires title", async () => {
    await expect(
      TelemedSession.create({
        clinicId: CLINIC_A,
        scheduledAt: new Date(),
        joinKey: "k",
      }),
    ).rejects.toThrow(/title/i);
  });

  it("requires scheduledAt", async () => {
    await expect(
      TelemedSession.create({ clinicId: CLINIC_A, title: "X", joinKey: "k" }),
    ).rejects.toThrow(/scheduledAt/i);
  });

  it("requires joinKey", async () => {
    await expect(
      TelemedSession.create({
        clinicId: CLINIC_A,
        title: "X",
        scheduledAt: new Date(),
      }),
    ).rejects.toThrow(/joinKey/i);
  });

  it("rejects an invalid status", async () => {
    await expect(
      TelemedSession.create({
        clinicId: CLINIC_A,
        title: "X",
        scheduledAt: new Date(),
        joinKey: "k",
        status: "ringing",
      }),
    ).rejects.toThrow();
  });

  it("rejects out-of-range duration", async () => {
    await expect(
      TelemedSession.create({
        clinicId: CLINIC_A,
        title: "X",
        scheduledAt: new Date(),
        joinKey: "k",
        durationMinutes: 1,
      }),
    ).rejects.toThrow();
  });
});

describe("TelemedSession model — joinKey uniqueness per clinic", () => {
  it("rejects a duplicate joinKey in the same clinic", async () => {
    await TelemedSession.create({
      clinicId: CLINIC_A,
      title: "A",
      scheduledAt: new Date(),
      joinKey: "dup",
    });
    await expect(
      TelemedSession.create({
        clinicId: CLINIC_A,
        title: "B",
        scheduledAt: new Date(),
        joinKey: "dup",
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same joinKey in different clinics", async () => {
    await TelemedSession.create({
      clinicId: CLINIC_A,
      title: "A",
      scheduledAt: new Date(),
      joinKey: "shared",
    });
    const b = await TelemedSession.create({
      clinicId: CLINIC_B,
      title: "B",
      scheduledAt: new Date(),
      joinKey: "shared",
    });
    expect(b._id).toBeDefined();
  });
});

describe("TelemedSession model — tenant isolation (raw queries)", () => {
  it("does not return another clinic's sessions", async () => {
    await TelemedSession.create({
      clinicId: CLINIC_A,
      title: "A",
      scheduledAt: new Date(),
      joinKey: "ka",
    });
    await TelemedSession.create({
      clinicId: CLINIC_B,
      title: "B",
      scheduledAt: new Date(),
      joinKey: "kb",
    });
    const aOnly = await TelemedSession.find({ clinicId: CLINIC_A });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0].title).toBe("A");
  });
});
