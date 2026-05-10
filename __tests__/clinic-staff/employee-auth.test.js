// __tests__/clinic-staff/employee-auth.test.js
//
// Tests for ClinicEmployee authentication: login, logout, /me.

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import argon2 from "argon2";

// Mock the email sender — invitation flow sends emails, we don't want
// real network calls during these tests.
vi.mock(
  "../../modules/clinic/clinic-staff/email/sendInvitationEmail.js",
  () => ({
    sendRichEmail: vi.fn().mockResolvedValue(true),
  }),
);

import { createTestApp } from "../helpers/withSession.js";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import ClinicEmployee from "../../modules/clinic/clinic-staff/models/clinicEmployee.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

let clinicCounter = 0;

/**
 * Helper: create a clinic + a confirmed ClinicEmployee with a known password.
 * Bypasses the full invitation flow for speed — we have separate tests for that.
 */
async function setupClinicWithEmployee({
  password = "SuperSecret123!",
  role = "receptionist",
  email = null,
  isActive = true,
} = {}) {
  clinicCounter += 1;
  const ownerId = new mongoose.Types.ObjectId();
  const { clinic } = await clinicService.createClinic(
    { name: `Test Clinic ${clinicCounter}` },
    ownerId,
  );

  const employeeEmail =
    email || `staff-${clinicCounter}-${Date.now()}@example.com`;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const employee = await ClinicEmployee.create({
    clinicId: clinic._id,
    emailEncrypted: employeeEmail,
    firstNameEncrypted: "Leyla",
    lastNameEncrypted: "Mammadova",
    phoneNumberEncrypted: "+994551112233",
    passwordHash,
    role,
    isActive,
    joinedAt: new Date(),
    preferredLanguage: "az",
    invitedBy: ownerId,
    invitationId: new mongoose.Types.ObjectId(),
  });

  await ClinicMembership.create({
    userId: employee._id,
    clinicId: clinic._id,
    role,
    isActive: true,
    joinedAt: new Date(),
    actorType: "employee",
  });

  return { clinic, employee, ownerId, password, email: employeeEmail };
}

// ─── POST /login ──────────────────────────────────────────────

describe("POST /api/v1/clinic/employees/login", () => {
  it("authenticates with valid email + password", async () => {
    const { clinic, email, password } = await setupClinicWithEmployee();
    const app = createTestApp();

    const agent = request.agent(app);
    const res = await agent
      .post("/api/v1/clinic/employees/login")
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.employee).toBeDefined();
    expect(res.body.employee.email).toBe(email);
    expect(res.body.employee.firstName).toBe("Leyla");
    expect(res.body.employee.role).toBe("receptionist");
    // passwordHash must NEVER be exposed in API responses
    expect(res.body.employee.passwordHash).toBeUndefined();

    expect(res.body.clinic._id).toBe(String(clinic._id));
    expect(res.body.clinic.name).toContain("Test Clinic");
    expect(res.body.role).toBe("receptionist");
  });

  it("rejects wrong password with 401", async () => {
    const { email } = await setupClinicWithEmployee();
    const app = createTestApp();

    const res = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password: "WrongPassword!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects nonexistent email with 401 (no info leak)", async () => {
    await setupClinicWithEmployee();
    const app = createTestApp();

    const res = await request(app).post("/api/v1/clinic/employees/login").send({
      email: "ghost@example.com",
      password: "AnyPassword123!",
    });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects inactive employee with 401", async () => {
    const { email, password } = await setupClinicWithEmployee({
      isActive: false,
    });
    const app = createTestApp();

    const res = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email, password });

    expect(res.status).toBe(401);
  });

  it("rejects malformed email with 400", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/v1/clinic/employees/login")
      .send({ email: "not-an-email", password: "anything" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ─── GET /me ──────────────────────────────────────────────────

describe("GET /api/v1/clinic/employees/me", () => {
  it("returns 401 without session", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/v1/clinic/employees/me");
    expect(res.status).toBe(401);
  });

  it("returns employee + clinic for authenticated employee", async () => {
    const { clinic, employee } = await setupClinicWithEmployee();

    // Use a session pre-loaded with employeeId
    const app = createTestApp({ employeeId: employee._id });

    const res = await request(app).get("/api/v1/clinic/employees/me");

    expect(res.status).toBe(200);
    expect(res.body.employee._id).toBe(String(employee._id));
    expect(res.body.employee.firstName).toBe("Leyla");
    expect(res.body.employee.passwordHash).toBeUndefined();
    expect(res.body.clinic._id).toBe(String(clinic._id));
    expect(res.body.role).toBe("receptionist");
  });
});

// ─── POST /logout ─────────────────────────────────────────────

describe("POST /api/v1/clinic/employees/logout", () => {
  it("destroys session and subsequent /me returns 401", async () => {
    const { employee, email, password } = await setupClinicWithEmployee();
    const app = createTestApp();

    const agent = request.agent(app);

    // 1. Login
    const loginRes = await agent
      .post("/api/v1/clinic/employees/login")
      .send({ email, password });
    expect(loginRes.status).toBe(200);

    // 2. /me works while session is alive
    const meRes = await agent.get("/api/v1/clinic/employees/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.employee._id).toBe(String(employee._id));

    // 3. Logout
    const logoutRes = await agent.post("/api/v1/clinic/employees/logout");
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // 4. /me now returns 401
    const meAfter = await agent.get("/api/v1/clinic/employees/me");
    expect(meAfter.status).toBe(401);
  });
});
