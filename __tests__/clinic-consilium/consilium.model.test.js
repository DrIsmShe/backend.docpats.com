// server/__tests__/clinic-consilium/consilium.model.test.js
//
// Model-level tests for Consilium + ConsiliumMessage: defaults, validation,
// tenant scoping. Mongo + cleanup from __tests__/setup.js.
//
// Both models are DEFAULT exports; CONSILIUM_STATUSES is a named export.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import Consilium, {
  CONSILIUM_STATUSES,
} from "../../modules/clinic/clinic-consilium/models/consilium.model.js";
import ConsiliumMessage from "../../modules/clinic/clinic-consilium/models/consiliumMessage.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await Consilium.syncIndexes();
  await ConsiliumMessage.syncIndexes();
});

describe("Consilium model — basics", () => {
  it("applies defaults (status=open, counters=0, optional refs null)", async () => {
    const c = await Consilium.create({
      clinicId: CLINIC_A,
      title: "Сложный случай ОНМК",
    });
    expect(c.status).toBe("open");
    expect(c.messageCount).toBe(0);
    expect(c.patientId).toBeNull();
    expect(c.departmentId).toBeNull();
    expect(c.resolvedAt).toBeNull();
    expect(Array.isArray(c.participantMembershipIds)).toBe(true);
  });

  it("exposes the status enum list", () => {
    expect(CONSILIUM_STATUSES).toContain("open");
    expect(CONSILIUM_STATUSES).toContain("resolved");
    expect(CONSILIUM_STATUSES).toContain("archived");
  });
});

describe("Consilium model — validation (errors)", () => {
  it("requires title", async () => {
    await expect(Consilium.create({ clinicId: CLINIC_A })).rejects.toThrow(
      /title/i,
    );
  });

  it("requires clinicId", async () => {
    await expect(Consilium.create({ title: "X" })).rejects.toThrow(/clinicId/i);
  });

  it("rejects an invalid status", async () => {
    await expect(
      Consilium.create({ clinicId: CLINIC_A, title: "X", status: "closed" }),
    ).rejects.toThrow();
  });
});

describe("ConsiliumMessage model", () => {
  it("requires textEncrypted, consiliumId, clinicId", async () => {
    await expect(
      ConsiliumMessage.create({ clinicId: CLINIC_A }),
    ).rejects.toThrow();
  });

  it("stores an encrypted body string", async () => {
    const consilium = await Consilium.create({
      clinicId: CLINIC_A,
      title: "Case",
    });
    const msg = await ConsiliumMessage.create({
      clinicId: CLINIC_A,
      consiliumId: consilium._id,
      textEncrypted: "aa:bb:cc",
    });
    expect(msg.textEncrypted).toBe("aa:bb:cc");
  });
});

describe("Consilium model — tenant isolation (raw queries)", () => {
  it("does not return another clinic's consilia", async () => {
    await Consilium.create({ clinicId: CLINIC_A, title: "A" });
    await Consilium.create({ clinicId: CLINIC_B, title: "B" });

    const aOnly = await Consilium.find({ clinicId: CLINIC_A });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0].title).toBe("A");
  });
});
