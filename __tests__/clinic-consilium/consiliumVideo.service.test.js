// server/__tests__/clinic-consilium/consiliumVideo.service.test.js
//
// Service-level tests for the consilium video-token service (contour 3).
//
// Covers BOTH entry paths through issueConsiliumRoomToken:
//   - DOCTOR (membershipId set): initiator / participant → moderator:true;
//     non-participant → Forbidden.
//   - PATIENT (membershipId null): owns the consilium's ClinicPatient card AND
//     patientCanJoin → moderator:false; not invited / not owner / no patient →
//     Forbidden; archived / unconfigured → error.
//
// jitsiToken.service is MOCKED so we can assert the `moderator` flag from the
// mintRoomToken call args without a real JWT secret or env. Mongo + cleanup
// come from __tests__/setup.js. ClinicPatient is seeded via a raw insert to
// stay independent of the tenantScoped/softDelete plugins.

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Mock the shared token service (hoisted above imports by vitest).
vi.mock("../../common/video/jitsiToken.service.js", () => ({
  isJitsiConfigured: vi.fn(() => true),
  mintRoomToken: vi.fn(async (args) => ({
    token: "test-jwt",
    domain: "localhost:8443",
    room: args.room,
    exp: 9_999_999_999,
  })),
}));

import {
  mintRoomToken,
  isJitsiConfigured,
} from "../../common/video/jitsiToken.service.js";
import { issueConsiliumRoomToken } from "../../modules/clinic/clinic-consilium/services/consiliumVideo.service.js";
import Consilium from "../../modules/clinic/clinic-consilium/models/consilium.model.js";
// Import the model so mongoose.model("ClinicPatient") resolves in the service.
import ClinicPatient from "../../modules/clinic/clinic-patients/models/clinicPatient.model.js";

const CLINIC = new mongoose.Types.ObjectId();
const OTHER_CLINIC = new mongoose.Types.ObjectId();

// Seed a patient card via raw insert — plugin-independent. Service reads only
// _id / linkedUserId; deletedAt/isDeleted set so any soft-delete filter passes.
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

function makeConsilium(clinicId, fields = {}) {
  return Consilium.create({
    clinicId,
    title: "Case",
    status: "open",
    ...fields,
  });
}

beforeEach(() => {
  mintRoomToken.mockClear();
  isJitsiConfigured.mockReturnValue(true);
});

// ─── PATIENT path ───
describe("issueConsiliumRoomToken — patient path", () => {
  it("admits an invited owner as a guest (moderator:false)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC, userId);
    const c = await makeConsilium(CLINIC, {
      patientId: cardId,
      patientCanJoin: true,
    });

    const res = await issueConsiliumRoomToken({
      clinicId: CLINIC,
      consiliumId: c._id,
      userId,
      membershipId: null,
      displayName: "Пациент",
    });

    expect(res.room).toBe(`consilium-${c._id}`);
    expect(mintRoomToken).toHaveBeenCalledOnce();
    expect(mintRoomToken.mock.calls[0][0]).toMatchObject({
      room: `consilium-${c._id}`,
      moderator: false,
    });
  });

  it("rejects an owner who was NOT invited (patientCanJoin:false)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC, userId);
    const c = await makeConsilium(CLINIC, {
      patientId: cardId,
      patientCanJoin: false,
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: CLINIC,
        consiliumId: c._id,
        userId,
        membershipId: null,
      }),
    ).rejects.toThrow(/invited/i);
    expect(mintRoomToken).not.toHaveBeenCalled();
  });

  it("rejects a different user (card linked to someone else)", async () => {
    const owner = new mongoose.Types.ObjectId();
    const intruder = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC, owner);
    const c = await makeConsilium(CLINIC, {
      patientId: cardId,
      patientCanJoin: true,
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: CLINIC,
        consiliumId: c._id,
        userId: intruder,
        membershipId: null,
      }),
    ).rejects.toThrow(/does not concern you/i);
    expect(mintRoomToken).not.toHaveBeenCalled();
  });

  it("rejects when the consilium has no patient at all", async () => {
    const userId = new mongoose.Types.ObjectId();
    const c = await makeConsilium(CLINIC, {
      patientId: null,
      patientCanJoin: true,
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: CLINIC,
        consiliumId: c._id,
        userId,
        membershipId: null,
      }),
    ).rejects.toThrow(/does not concern you/i);
  });

  it("rejects an archived consilium for the patient", async () => {
    const userId = new mongoose.Types.ObjectId();
    const cardId = await seedCard(CLINIC, userId);
    const c = await makeConsilium(CLINIC, {
      patientId: cardId,
      patientCanJoin: true,
      status: "archived",
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: CLINIC,
        consiliumId: c._id,
        userId,
        membershipId: null,
      }),
    ).rejects.toThrow(/archived/i);
  });
});

// ─── DOCTOR path ───
describe("issueConsiliumRoomToken — doctor path", () => {
  it("admits the initiator as moderator:true", async () => {
    const membershipId = new mongoose.Types.ObjectId();
    const c = await makeConsilium(CLINIC, {
      initiatorMembershipId: membershipId,
    });

    await issueConsiliumRoomToken({
      clinicId: CLINIC,
      consiliumId: c._id,
      userId: new mongoose.Types.ObjectId(),
      membershipId,
      displayName: "Dr",
    });

    expect(mintRoomToken.mock.calls[0][0]).toMatchObject({ moderator: true });
  });

  it("admits a listed participant as moderator:true", async () => {
    const membershipId = new mongoose.Types.ObjectId();
    const c = await makeConsilium(CLINIC, {
      participantMembershipIds: [membershipId],
    });

    await issueConsiliumRoomToken({
      clinicId: CLINIC,
      consiliumId: c._id,
      userId: new mongoose.Types.ObjectId(),
      membershipId,
    });

    expect(mintRoomToken.mock.calls[0][0]).toMatchObject({ moderator: true });
  });

  it("rejects a doctor who is neither initiator nor participant", async () => {
    const c = await makeConsilium(CLINIC, {
      initiatorMembershipId: new mongoose.Types.ObjectId(),
      participantMembershipIds: [new mongoose.Types.ObjectId()],
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: CLINIC,
        consiliumId: c._id,
        userId: new mongoose.Types.ObjectId(),
        membershipId: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toThrow(/not a participant/i);
    expect(mintRoomToken).not.toHaveBeenCalled();
  });
});

// ─── errors / guards ───
describe("issueConsiliumRoomToken — guards", () => {
  it("throws NotFound for a consilium in another clinic", async () => {
    const membershipId = new mongoose.Types.ObjectId();
    const c = await makeConsilium(CLINIC, {
      initiatorMembershipId: membershipId,
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: OTHER_CLINIC,
        consiliumId: c._id,
        userId: new mongoose.Types.ObjectId(),
        membershipId,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("surfaces VIDEO_NOT_CONFIGURED when jitsi is off", async () => {
    isJitsiConfigured.mockReturnValueOnce(false);
    const c = await makeConsilium(CLINIC, {
      initiatorMembershipId: new mongoose.Types.ObjectId(),
    });

    await expect(
      issueConsiliumRoomToken({
        clinicId: CLINIC,
        consiliumId: c._id,
        userId: new mongoose.Types.ObjectId(),
        membershipId: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toMatchObject({ code: "VIDEO_NOT_CONFIGURED" });
  });
});
