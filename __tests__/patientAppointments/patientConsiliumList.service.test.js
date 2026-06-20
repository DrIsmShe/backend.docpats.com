// server/__tests__/patientAppointments/patientConsiliumList.service.test.js
//
// Service-level tests for getMyJoinableConsilia (contour 3, patient list).
//
// The list is the read-side mirror of the patientCanJoin gate: a patient sees
// a consilium ONLY when invited (patientCanJoin) AND it concerns one of their
// ClinicPatient cards AND it isn't archived. We verify that filter, tenant /
// ownership isolation, the empty cases, and name resolution (doctor name via
// decrypt, clinic name) including the null fallbacks.
//
// Mongo + cleanup from __tests__/setup.js. The service resolves all models
// from the mongoose registry, so we import each model file here to register
// it. ClinicPatient is seeded via raw insert (plugin-independent); Clinic via
// raw insert (unknown required fields); Consilium + ClinicMembership via the
// model. createTestDoctor gives a User whose encrypted name round-trips.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import { getMyJoinableConsilia } from "../../modules/patientAppointments/services/patientConsiliumList.service.js";
// Register the models the service pulls from mongoose.model(...).
import Consilium from "../../modules/clinic/clinic-consilium/models/consilium.model.js";
import ClinicPatient from "../../modules/clinic/clinic-patients/models/clinicPatient.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import { createTestDoctor } from "../helpers/createTestUser.js";

const CLINIC_A = new mongoose.Types.ObjectId();

// Raw insert: plugin-independent; deletedAt/isDeleted set so any soft-delete
// filter still finds the card. Service reads only _id from this.
async function seedCard(clinicId, linkedUserId) {
  const _id = new mongoose.Types.ObjectId();
  await ClinicPatient.collection.insertOne({
    _id,
    clinicId,
    linkedUserId,
    createdBy: new mongoose.Types.ObjectId(),
    createdByType: "user",
    deletedAt: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return _id;
}

async function seedClinic(_id, name) {
  await Clinic.collection.insertOne({
    _id,
    name,
    deletedAt: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeConsilium(clinicId, fields = {}) {
  return Consilium.create({
    clinicId,
    title: "Case",
    status: "open",
    ...fields,
  });
}

// ─── invited filter ───
describe("getMyJoinableConsilia — invited filter", () => {
  it("returns only invited, non-archived consilia of the patient", async () => {
    const userId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC_A, userId);

    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: true,
      title: "Invited open",
    });
    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: false,
      title: "Not invited",
    });
    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: true,
      status: "archived",
      title: "Invited archived",
    });
    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: true,
      status: "resolved",
      title: "Invited resolved",
    });

    const res = await getMyJoinableConsilia(String(userId));
    expect(res.map((r) => r.title).sort()).toEqual([
      "Invited open",
      "Invited resolved",
    ]);
    for (const r of res) {
      expect(r.joinSource).toBe("consilium-patient");
      expect(r.joinable).toBe(true);
    }
  });
});

// ─── isolation ───
describe("getMyJoinableConsilia — isolation", () => {
  it("does not leak consilia tied to another patient's card", async () => {
    const me = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const myCardId = await seedCard(CLINIC_A, me);
    const otherCardId = await seedCard(CLINIC_A, other);

    await makeConsilium(CLINIC_A, {
      patientId: otherCardId,
      patientCanJoin: true,
      title: "Other's",
    });
    await makeConsilium(CLINIC_A, {
      patientId: myCardId,
      patientCanJoin: true,
      title: "Mine",
    });

    const res = await getMyJoinableConsilia(String(me));
    expect(res.map((r) => r.title)).toEqual(["Mine"]);
  });
});

// ─── empty cases ───
describe("getMyJoinableConsilia — empty", () => {
  it("returns [] when the user has no patient cards", async () => {
    const res = await getMyJoinableConsilia(
      String(new mongoose.Types.ObjectId()),
    );
    expect(res).toEqual([]);
  });

  it("returns [] when the card exists but nothing is invited", async () => {
    const userId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC_A, userId);
    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: false,
    });
    const res = await getMyJoinableConsilia(String(userId));
    expect(res).toEqual([]);
  });

  it("returns [] for a falsy userId", async () => {
    expect(await getMyJoinableConsilia(null)).toEqual([]);
    expect(await getMyJoinableConsilia(undefined)).toEqual([]);
  });
});

// ─── name resolution ───
describe("getMyJoinableConsilia — name resolution", () => {
  it("resolves initiator doctorName (decrypt) and clinicName", async () => {
    const { userId: docUserId } = await createTestDoctor();
    const membership = await ClinicMembership.create({
      userId: docUserId,
      clinicId: CLINIC_A,
      role: "doctor",
    });
    await seedClinic(CLINIC_A, "Клиника Тест");

    const patientUserId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC_A, patientUserId);
    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: true,
      initiatorMembershipId: membership._id,
    });

    const res = await getMyJoinableConsilia(String(patientUserId));
    expect(res).toHaveLength(1);
    const suffix = docUserId.toString().slice(-8);
    expect(res[0].doctorName).toBe(`Test Doctor${suffix}`);
    expect(res[0].clinicName).toBe("Клиника Тест");
  });

  it("falls back to null doctorName/clinicName when unresolvable", async () => {
    const userId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC_A, userId);
    await makeConsilium(CLINIC_A, {
      patientId: cardId,
      patientCanJoin: true,
      // membership id that has no ClinicMembership row → no user → null name
      initiatorMembershipId: new mongoose.Types.ObjectId(),
      // no Clinic seeded for CLINIC_A → clinicName null
    });

    const res = await getMyJoinableConsilia(String(userId));
    expect(res).toHaveLength(1);
    expect(res[0].doctorName).toBeNull();
    expect(res[0].clinicName).toBeNull();
  });
});
