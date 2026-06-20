// server/__tests__/clinic-consilium/consilium.service.test.js
//
// Service-level tests: CRUD, participant + department validation, encrypted
// message round-trip + decryption on read, counter sync, resolve/archive
// semantics, post-to-archived guard, and the MANDATORY tenant-isolation suite.
//
// Mongo + cleanup from __tests__/setup.js. The message crypto reads
// SURGERY_ENCRYPTION_KEY lazily, so we set a deterministic test key at module
// load (before any test runs).

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

// 32-byte hex (64 chars) test key — set BEFORE the service encrypts anything.
process.env.SURGERY_ENCRYPTION_KEY =
  process.env.SURGERY_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import Consilium from "../../modules/clinic/clinic-consilium/models/consilium.model.js";
import ConsiliumMessage from "../../modules/clinic/clinic-consilium/models/consiliumMessage.model.js";
import * as svc from "../../modules/clinic/clinic-consilium/services/consilium.service.js";
import * as deptSvc from "../../modules/clinic/clinic-departments/services/department.service.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await Consilium.syncIndexes();
  await ConsiliumMessage.syncIndexes();
});

async function makeDept(clinicId, name = "Неврология") {
  return deptSvc.createDepartment(clinicId, { name });
}
async function makeMembership(clinicId, role = "doctor") {
  return ClinicMembership.create({
    userId: new mongoose.Types.ObjectId(),
    clinicId,
    role,
  });
}

// ─── CREATE ───
describe("createConsilium", () => {
  it("creates an open consilium with defaults", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Case 1" });
    expect(c.title).toBe("Case 1");
    expect(c.status).toBe("open");
    expect(String(c.clinicId)).toBe(String(CLINIC_A));
  });

  it("accepts a department of this clinic and valid participants", async () => {
    const dept = await makeDept(CLINIC_A);
    const m1 = await makeMembership(CLINIC_A);
    const m2 = await makeMembership(CLINIC_A);
    const c = await svc.createConsilium(CLINIC_A, {
      title: "Team case",
      departmentId: dept._id,
      participantMembershipIds: [m1._id, m2._id, m1._id],
    });
    expect(String(c.departmentId)).toBe(String(dept._id));
    expect(c.participantMembershipIds).toHaveLength(2);
  });

  it("rejects a department from another clinic", async () => {
    const foreign = await makeDept(CLINIC_B, "Foreign");
    await expect(
      svc.createConsilium(CLINIC_A, {
        title: "X",
        departmentId: foreign._id,
      }),
    ).rejects.toThrow(/not found in this clinic/i);
  });

  it("rejects a participant from another clinic", async () => {
    const foreign = await makeMembership(CLINIC_B);
    await expect(
      svc.createConsilium(CLINIC_A, {
        title: "X",
        participantMembershipIds: [foreign._id],
      }),
    ).rejects.toThrow(/do not belong to this clinic/i);
  });
});

// ─── LIST / GET ───
describe("listConsilia + getConsiliumById", () => {
  it("returns only this clinic's consilia", async () => {
    await svc.createConsilium(CLINIC_A, { title: "A1" });
    await svc.createConsilium(CLINIC_A, { title: "A2" });
    await svc.createConsilium(CLINIC_B, { title: "B1" });

    const list = await svc.listConsilia(CLINIC_A);
    expect(list).toHaveLength(2);
  });

  it("filters by status and participant", async () => {
    const m = await makeMembership(CLINIC_A);
    await svc.createConsilium(CLINIC_A, {
      title: "With member",
      participantMembershipIds: [m._id],
    });
    await svc.createConsilium(CLINIC_A, { title: "Without" });

    const withMember = await svc.listConsilia(CLINIC_A, {
      participantMembershipId: m._id,
    });
    expect(withMember.map((c) => c.title)).toEqual(["With member"]);
  });

  it("search q matches title and is regex-safe", async () => {
    await svc.createConsilium(CLINIC_A, { title: "Кардиокейс" });
    await svc.createConsilium(CLINIC_A, { title: "Неврокейс" });

    const hit = await svc.listConsilia(CLINIC_A, { q: "Кардио" });
    expect(hit).toHaveLength(1);

    const none = await svc.listConsilia(CLINIC_A, { q: ".*" });
    expect(none).toHaveLength(0);
  });

  it("getConsiliumById throws for an id outside the clinic", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "X" });
    await expect(svc.getConsiliumById(CLINIC_B, c._id)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ─── UPDATE ───
describe("updateConsilium", () => {
  it("updates fields", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Old" });
    const u = await svc.updateConsilium(CLINIC_A, c._id, {
      title: "New",
      description: "details",
    });
    expect(u.title).toBe("New");
    expect(u.description).toBe("details");
  });

  it("stamps resolvedAt on first resolve and sets conclusion", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Case" });
    const resolved = await svc.updateConsilium(CLINIC_A, c._id, {
      status: "resolved",
      conclusion: "Оперировать планово",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.conclusion).toBe("Оперировать планово");
  });
});

// ─── MESSAGES (encryption) ───
describe("messages — encryption round-trip", () => {
  it("encrypts at rest and returns decrypted text on read", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Case" });
    const plain = "Пациент стабилен, рекомендую КТ с контрастом.";

    const created = await svc.addMessage(CLINIC_A, c._id, { text: plain });
    expect(created.text).toBe(plain);
    expect(created.textEncrypted).toBeUndefined(); // not leaked in output

    // Raw row in DB must be ciphertext, not plaintext.
    const raw = await ConsiliumMessage.findById(created._id).lean();
    expect(raw.textEncrypted).not.toContain("Пациент");
    expect(raw.textEncrypted.split(":")).toHaveLength(3);

    const list = await svc.listMessages(CLINIC_A, c._id);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe(plain);
  });

  it("bumps messageCount and lastMessageAt on the consilium", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Case" });
    await svc.addMessage(CLINIC_A, c._id, { text: "first" });
    await svc.addMessage(CLINIC_A, c._id, { text: "second" });

    const updated = await svc.getConsiliumById(CLINIC_A, c._id);
    expect(updated.messageCount).toBe(2);
    expect(updated.lastMessageAt).toBeTruthy();
  });

  it("returns messages in chronological order", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Case" });
    await svc.addMessage(CLINIC_A, c._id, { text: "one" });
    await svc.addMessage(CLINIC_A, c._id, { text: "two" });
    await svc.addMessage(CLINIC_A, c._id, { text: "three" });

    const list = await svc.listMessages(CLINIC_A, c._id);
    expect(list.map((m) => m.text)).toEqual(["one", "two", "three"]);
  });

  it("rejects posting to an archived consilium", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "Case" });
    await svc.archiveConsilium(CLINIC_A, c._id);
    await expect(
      svc.addMessage(CLINIC_A, c._id, { text: "late" }),
    ).rejects.toThrow(/archived/i);
  });

  it("rejects posting to a consilium from another clinic", async () => {
    const c = await svc.createConsilium(CLINIC_B, { title: "B-case" });
    await expect(
      svc.addMessage(CLINIC_A, c._id, { text: "intruder" }),
    ).rejects.toThrow(/not found/i);
  });
});

// ─── ARCHIVE ───
describe("archiveConsilium", () => {
  it("soft-archives (record stays)", async () => {
    const c = await svc.createConsilium(CLINIC_A, { title: "X" });
    const archived = await svc.archiveConsilium(CLINIC_A, c._id);
    expect(archived.status).toBe("archived");
    const still = await Consilium.findById(c._id);
    expect(still).not.toBeNull();
  });
});

// ─── MANDATORY TENANT ISOLATION ───
describe("tenant isolation (mandatory)", () => {
  it("clinic A cannot read clinic B's consilium", async () => {
    const b = await svc.createConsilium(CLINIC_B, { title: "B-secret" });
    await expect(svc.getConsiliumById(CLINIC_A, b._id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("clinic A cannot update clinic B's consilium", async () => {
    const b = await svc.createConsilium(CLINIC_B, { title: "B" });
    await expect(
      svc.updateConsilium(CLINIC_A, b._id, { title: "hacked" }),
    ).rejects.toThrow(/not found/i);
    const untouched = await Consilium.findById(b._id);
    expect(untouched.title).toBe("B");
  });

  it("clinic A cannot read clinic B's messages", async () => {
    const b = await svc.createConsilium(CLINIC_B, { title: "B" });
    await svc.addMessage(CLINIC_B, b._id, { text: "secret" });
    await expect(svc.listMessages(CLINIC_A, b._id)).rejects.toThrow(
      /not found/i,
    );
  });
});
