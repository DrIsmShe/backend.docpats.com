// __tests__/clinic-staff/staff-endpoints.test.js

import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import { createTestApp } from "../helpers/withSession.js";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

let clinicCounter = 0;
async function setupClinicWithOwner() {
  clinicCounter += 1;
  const ownerId = new mongoose.Types.ObjectId();
  const { clinic, membership: ownerMembership } =
    await clinicService.createClinic(
      { name: `Test Clinic ${clinicCounter}` },
      ownerId,
    );
  return { clinic, ownerId, ownerMembership };
}

async function addMember(clinicId, userId, role) {
  return ClinicMembership.create({
    userId,
    clinicId,
    role,
    isActive: true,
    joinedAt: new Date(),
  });
}

describe("GET /api/v1/clinic/staff", () => {
  it("returns 401 without authentication", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/v1/clinic/staff");
    expect(res.status).toBe(401);
  });

  it("owner sees all members of own clinic", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();
    const docId = new mongoose.Types.ObjectId();
    await addMember(clinic._id, docId, "doctor");

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).get("/api/v1/clinic/staff");

    expect(res.status).toBe(200);
    expect(res.body.staff).toHaveLength(2);
    const roles = res.body.staff.map((s) => s.role).sort();
    expect(roles).toEqual(["doctor", "owner"]);
  });

  it("does not see members of other clinics (cross-tenant)", async () => {
    const { clinic: clinicA, ownerId: ownerA } = await setupClinicWithOwner();
    const { clinic: clinicB } = await setupClinicWithOwner();
    await addMember(clinicB._id, new mongoose.Types.ObjectId(), "doctor");

    const app = createTestApp({ userId: ownerA });
    const res = await request(app).get("/api/v1/clinic/staff");

    expect(res.status).toBe(200);
    expect(res.body.staff).toHaveLength(1);
    expect(res.body.staff[0].clinicId).toBe(String(clinicA._id));
  });
});

describe("POST /api/v1/clinic/staff", () => {
  it("owner can add doctor", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const newDoctorId = new mongoose.Types.ObjectId();

    const app = createTestApp({ userId: ownerId });
    const res = await request(app)
      .post("/api/v1/clinic/staff")
      .send({ userId: String(newDoctorId), role: "doctor" });

    expect(res.status).toBe(201);
    expect(res.body.membership.role).toBe("doctor");
    expect(res.body.membership.userId).toBe(String(newDoctorId));
  });

  it("manager cannot add admin (privilege escalation)", async () => {
    const { clinic } = await setupClinicWithOwner();
    const managerId = new mongoose.Types.ObjectId();
    await addMember(clinic._id, managerId, "manager");

    const app = createTestApp({ userId: managerId });
    const res = await request(app)
      .post("/api/v1/clinic/staff")
      .send({ userId: String(new mongoose.Types.ObjectId()), role: "admin" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rejects 409 if user already an active member", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();
    const existingDocId = new mongoose.Types.ObjectId();
    await addMember(clinic._id, existingDocId, "doctor");

    const app = createTestApp({ userId: ownerId });
    const res = await request(app)
      .post("/api/v1/clinic/staff")
      .send({ userId: String(existingDocId), role: "nurse" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("rejects invalid input (bad role)", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });
    const res = await request(app)
      .post("/api/v1/clinic/staff")
      .send({ userId: String(new mongoose.Types.ObjectId()), role: "ceo" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("doctor cannot add staff (no permission)", async () => {
    const { clinic } = await setupClinicWithOwner();
    const docId = new mongoose.Types.ObjectId();
    await addMember(clinic._id, docId, "doctor");

    const app = createTestApp({ userId: docId });
    const res = await request(app)
      .post("/api/v1/clinic/staff")
      .send({ userId: String(new mongoose.Types.ObjectId()), role: "nurse" });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/clinic/staff/:id/role", () => {
  it("owner can promote doctor → manager", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();
    const docMembership = await addMember(
      clinic._id,
      new mongoose.Types.ObjectId(),
      "doctor",
    );

    const app = createTestApp({ userId: ownerId });
    const res = await request(app)
      .patch(`/api/v1/clinic/staff/${docMembership._id}/role`)
      .send({ role: "manager" });

    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe("manager");
  });

  it("manager cannot promote doctor → admin (privilege escalation)", async () => {
    const { clinic } = await setupClinicWithOwner();
    const managerId = new mongoose.Types.ObjectId();
    await addMember(clinic._id, managerId, "manager");
    const docMembership = await addMember(
      clinic._id,
      new mongoose.Types.ObjectId(),
      "doctor",
    );

    const app = createTestApp({ userId: managerId });
    const res = await request(app)
      .patch(`/api/v1/clinic/staff/${docMembership._id}/role`)
      .send({ role: "admin" });

    expect(res.status).toBe(403);
  });

  it("cannot demote the last owner", async () => {
    const { ownerMembership, ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });
    const res = await request(app)
      .patch(`/api/v1/clinic/staff/${ownerMembership._id}/role`)
      .send({ role: "admin" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/clinic/staff/:id", () => {
  it("owner can remove doctor (soft delete)", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();
    const docMembership = await addMember(
      clinic._id,
      new mongoose.Types.ObjectId(),
      "doctor",
    );

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).delete(
      `/api/v1/clinic/staff/${docMembership._id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.membership.leftAt).toBeDefined();

    const listRes = await request(app).get("/api/v1/clinic/staff");
    expect(listRes.body.staff).toHaveLength(1);
  });

  it("cannot remove yourself", async () => {
    const { ownerMembership, ownerId } = await setupClinicWithOwner();

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).delete(
      `/api/v1/clinic/staff/${ownerMembership._id}`,
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("UNPROCESSABLE");
  });

  it("manager cannot remove admin (privilege escalation)", async () => {
    const { clinic } = await setupClinicWithOwner();
    const managerId = new mongoose.Types.ObjectId();
    await addMember(clinic._id, managerId, "manager");
    const adminMembership = await addMember(
      clinic._id,
      new mongoose.Types.ObjectId(),
      "admin",
    );

    const app = createTestApp({ userId: managerId });
    const res = await request(app).delete(
      `/api/v1/clinic/staff/${adminMembership._id}`,
    );

    expect(res.status).toBe(403);
  });

  it("cannot remove staff from another clinic", async () => {
    const { ownerId: ownerA } = await setupClinicWithOwner();
    const { clinic: clinicB } = await setupClinicWithOwner();
    const memberInB = await addMember(
      clinicB._id,
      new mongoose.Types.ObjectId(),
      "doctor",
    );

    const app = createTestApp({ userId: ownerA });
    const res = await request(app).delete(
      `/api/v1/clinic/staff/${memberInB._id}`,
    );

    expect(res.status).toBe(404);
  });
});
