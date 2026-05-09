// __tests__/clinic-staff/search-doctors.test.js

import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import { createTestApp } from "../helpers/withSession.js";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import User from "../../common/models/Auth/users.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

let clinicCounter = 0;
let usernameCounter = 0;

async function setupClinicWithOwner() {
  clinicCounter += 1;
  const ownerId = new mongoose.Types.ObjectId();
  const { clinic } = await clinicService.createClinic(
    { name: `Test Clinic ${clinicCounter}` },
    ownerId,
  );
  return { clinic, ownerId };
}

/**
 * Create a doctor User. Pre-save hook in users.js encrypts plain values
 * automatically (it checks isEncrypted() to avoid double-encryption) and
 * computes the hash fields. So we just pass plain strings.
 */
async function createDoctor({ firstName, lastName, email, isBlocked = false }) {
  usernameCounter += 1;
  return User.create({
    firstNameEncrypted: firstName,
    lastNameEncrypted: lastName,
    emailEncrypted: email,
    // hash fields are required by schema; will be overwritten by pre-save hook
    emailHash: `placeholder-${usernameCounter}-email`,
    firstNameHash: `placeholder-${usernameCounter}-first`,
    lastNameHash: `placeholder-${usernameCounter}-last`,
    username: `testdoc${usernameCounter}`,
    password: "fake-hash",
    role: "doctor",
    isDoctor: true,
    isPatient: false,
    isBlocked,
    dateOfBirth: new Date("1990-01-01"),
    bio: "Test doctor bio",
    agreement: true,
  });
}

describe("GET /api/v1/clinic/staff/search-doctors", () => {
  it("returns 401 without auth", async () => {
    const app = createTestApp();
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=Aigul",
    );
    expect(res.status).toBe(401);
  });

  it("rejects too-short query", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=a",
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("finds doctor by first name", async () => {
    const { ownerId } = await setupClinicWithOwner();
    await createDoctor({
      firstName: "Aigul",
      lastName: "Mammadova",
      email: "aigul@example.com",
    });
    await createDoctor({
      firstName: "Murad",
      lastName: "Hasanov",
      email: "murad@example.com",
    });

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=aigul",
    );

    expect(res.status).toBe(200);
    expect(res.body.doctors).toHaveLength(1);
    expect(res.body.doctors[0].firstName).toBe("Aigul");
    expect(res.body.doctors[0].email).toBe("aigul@example.com");
  });

  it("finds doctor by email substring", async () => {
    const { ownerId } = await setupClinicWithOwner();
    await createDoctor({
      firstName: "Test",
      lastName: "User",
      email: "specific@unique-domain.com",
    });

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=unique-domain",
    );

    expect(res.status).toBe(200);
    expect(res.body.doctors).toHaveLength(1);
  });

  it("excludes doctors already in the clinic", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();

    const existingDoctor = await createDoctor({
      firstName: "Already",
      lastName: "Member",
      email: "member@example.com",
    });
    await ClinicMembership.create({
      userId: existingDoctor._id,
      clinicId: clinic._id,
      role: "doctor",
      isActive: true,
      joinedAt: new Date(),
    });

    await createDoctor({
      firstName: "Already",
      lastName: "Available",
      email: "available@example.com",
    });

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=already",
    );

    expect(res.status).toBe(200);
    expect(res.body.doctors).toHaveLength(1);
    expect(res.body.doctors[0].lastName).toBe("Available");
  });

  it("excludes blocked doctors", async () => {
    const { ownerId } = await setupClinicWithOwner();
    await createDoctor({
      firstName: "Active",
      lastName: "Doctor",
      email: "active@example.com",
    });
    await createDoctor({
      firstName: "Banned",
      lastName: "Doctor",
      email: "banned@example.com",
      isBlocked: true,
    });

    const app = createTestApp({ userId: ownerId });
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=doctor",
    );

    expect(res.status).toBe(200);
    expect(res.body.doctors).toHaveLength(1);
    expect(res.body.doctors[0].firstName).toBe("Active");
  });

  it("doctor without staff.write permission gets 403", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();
    const docId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: docId,
      clinicId: clinic._id,
      role: "doctor",
      isActive: true,
      joinedAt: new Date(),
    });

    const app = createTestApp({ userId: docId });
    const res = await request(app).get(
      "/api/v1/clinic/staff/search-doctors?q=test",
    );

    expect(res.status).toBe(403);
  });
});
