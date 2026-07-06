// __tests__/clinic-staff/invitations.test.js

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import crypto from "node:crypto";

// Mock the email sender so no real emails go out during tests.
// Must be defined BEFORE imports that use it.
vi.mock(
  "../../modules/clinic/clinic-staff/email/sendInvitationEmail.js",
  () => ({
    sendRichEmail: vi.fn().mockResolvedValue(true),
  }),
);

import { createTestApp } from "../helpers/withSession.js";
import * as clinicService from "../../modules/clinic/clinic-core/services/clinic.service.js";
import StaffInvitation from "../../modules/clinic/clinic-staff/models/staffInvitation.model.js";
import ClinicEmployee from "../../modules/clinic/clinic-staff/models/clinicEmployee.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import { createSignedToken } from "../../common/utils/signedUrl.js";

import { sendRichEmail } from "../../modules/clinic/clinic-staff/email/sendInvitationEmail.js";

let clinicCounter = 0;

async function setupClinicWithOwner() {
  clinicCounter += 1;
  const ownerId = new mongoose.Types.ObjectId();
  const { clinic } = await clinicService.createClinic(
    { name: `Test Clinic ${clinicCounter}` },
    ownerId,
  );
  return { clinic, ownerId };
}

async function setupClinicWithRole(role) {
  const { clinic, ownerId } = await setupClinicWithOwner();
  const userId = new mongoose.Types.ObjectId();
  await ClinicMembership.create({
    userId,
    clinicId: clinic._id,
    role,
    isActive: true,
    joinedAt: new Date(),
  });
  return { clinic, ownerId, userId };
}

beforeEach(() => {
  // Reset mock call history between tests so assertions don't leak
  sendRichEmail.mockClear();
});

// ─── CREATE INVITATION ─────────────────────────────────────────

describe("POST /api/v1/clinic/invitations — create", () => {
  it("requires authentication", async () => {
    const app = createTestApp();
    const res = await request(app).post("/api/v1/clinic/invitations").send({
      email: "leyla@example.com",
      role: "receptionist",
    });
    expect(res.status).toBe(401);
  });

  it("owner can create invitation and email is sent", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });

    const res = await request(app).post("/api/v1/clinic/invitations").send({
      email: "leyla@example.com",
      role: "receptionist",
      language: "ru",
    });

    expect(res.status).toBe(201);
    expect(res.body.invitation).toBeDefined();
    expect(res.body.invitation.role).toBe("receptionist");
    expect(res.body.invitation.status).toBe("pending");
    expect(res.body.emailSent).toBe(true);

    expect(sendRichEmail).toHaveBeenCalledTimes(1);
    const callArgs = sendRichEmail.mock.calls[0][0];
    expect(callArgs.to).toBe("leyla@example.com");
    expect(callArgs.subject).toContain("Test Clinic");
    expect(callArgs.htmlContent).toContain("/clinic/invitations/accept?token=");
  });

  it("rejects invalid role (e.g. 'doctor' is User-tied, not internal)", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });

    const res = await request(app)
      .post("/api/v1/clinic/invitations")
      .send({ email: "x@example.com", role: "doctor" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("manager cannot invite admin (privilege escalation guard)", async () => {
    const { userId } = await setupClinicWithRole("manager");
    const app = createTestApp({ userId });

    const res = await request(app)
      .post("/api/v1/clinic/invitations")
      .send({ email: "x@example.com", role: "admin" });

    expect(res.status).toBe(400);
  });

  it("rejects 409 if a pending invitation for same email exists", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });

    await request(app)
      .post("/api/v1/clinic/invitations")
      .send({ email: "duplicate@example.com", role: "receptionist" });

    const res = await request(app)
      .post("/api/v1/clinic/invitations")
      .send({ email: "duplicate@example.com", role: "nurse" });

    expect(res.status).toBe(409);
  });
});

// ─── LIST INVITATIONS ──────────────────────────────────────────

describe("GET /api/v1/clinic/invitations — list", () => {
  it("returns pending invitations of own clinic only (cross-tenant)", async () => {
    const { ownerId: ownerA } = await setupClinicWithOwner();
    const { ownerId: ownerB } = await setupClinicWithOwner();

    const appA = createTestApp({ userId: ownerA });
    const appB = createTestApp({ userId: ownerB });

    await request(appA)
      .post("/api/v1/clinic/invitations")
      .send({ email: "a@example.com", role: "nurse" });
    await request(appB)
      .post("/api/v1/clinic/invitations")
      .send({ email: "b@example.com", role: "nurse" });

    const resA = await request(appA).get("/api/v1/clinic/invitations");
    expect(resA.status).toBe(200);
    expect(resA.body.invitations).toHaveLength(1);
    expect(resA.body.invitations[0].email).toBe("a@example.com");
  });
});

// ─── REVOKE INVITATION ─────────────────────────────────────────

describe("DELETE /api/v1/clinic/invitations/:id — revoke", () => {
  it("owner can revoke pending invitation", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const app = createTestApp({ userId: ownerId });

    const create = await request(app)
      .post("/api/v1/clinic/invitations")
      .send({ email: "revoke@example.com", role: "nurse" });

    const invitationId = create.body.invitation._id;

    const res = await request(app).delete(
      `/api/v1/clinic/invitations/${invitationId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.invitation.status).toBe("revoked");
  });

  it("cannot revoke invitation from another clinic (404)", async () => {
    const { ownerId: ownerA } = await setupClinicWithOwner();
    const { ownerId: ownerB } = await setupClinicWithOwner();
    const appA = createTestApp({ userId: ownerA });
    const appB = createTestApp({ userId: ownerB });

    const create = await request(appA)
      .post("/api/v1/clinic/invitations")
      .send({ email: "x@example.com", role: "nurse" });

    const res = await request(appB).delete(
      `/api/v1/clinic/invitations/${create.body.invitation._id}`,
    );
    expect(res.status).toBe(404);
  });
});

// ─── PREVIEW + REQUEST OTP + ACCEPT ────────────────────────────

/**
 * Helper: complete create→capture-token→preview workflow.
 * Captures the token from the email mock so we can use it in subsequent calls.
 */
async function createAndCaptureToken(
  app,
  email = "newhire@example.com",
  role = "receptionist",
) {
  sendRichEmail.mockClear();
  await request(app)
    .post("/api/v1/clinic/invitations")
    .send({ email, role, language: "ru" });

  const callArgs = sendRichEmail.mock.calls[0][0];
  const html = callArgs.htmlContent;
  // Extract token from the accept URL inside html
  const match = html.match(/\?token=([^"&\s]+)/);
  if (!match) throw new Error("Token not found in email HTML");
  return decodeURIComponent(match[1]);
}

describe("GET /api/v1/clinic/invitations/preview — public preview", () => {
  it("returns invitation details for valid token", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const ownerApp = createTestApp({ userId: ownerId });
    const token = await createAndCaptureToken(ownerApp);

    const publicApp = createTestApp(); // no auth
    const res = await request(publicApp)
      .get("/api/v1/clinic/invitations/preview")
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("newhire@example.com");
    expect(res.body.role).toBe("receptionist");
    expect(res.body.clinic.name).toContain("Test Clinic");
  });

  it("rejects invalid/forged token", async () => {
    const fakeToken = createSignedToken({ invitationId: "doesnotexist" }, "1h");
    const publicApp = createTestApp();
    const res = await request(publicApp)
      .get("/api/v1/clinic/invitations/preview")
      .query({ token: fakeToken });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/clinic/invitations/request-otp", () => {
  it("generates and sends OTP", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const ownerApp = createTestApp({ userId: ownerId });
    const token = await createAndCaptureToken(ownerApp);

    sendRichEmail.mockClear();
    const publicApp = createTestApp();
    const res = await request(publicApp)
      .post("/api/v1/clinic/invitations/request-otp")
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(sendRichEmail).toHaveBeenCalledTimes(1);

    // Verify OTP is in the email HTML (6 digits)
    const html = sendRichEmail.mock.calls[0][0].htmlContent;
    expect(html).toMatch(/\d{6}/);
  });
});

describe("POST /api/v1/clinic/invitations/accept", () => {
  /**
   * Helper: extract OTP from the OTP email captured by the mock.
   */
  function extractOtpFromMockCalls() {
    // Find the OTP email — the one with a 6-digit code in a styled div
    const otpCall = sendRichEmail.mock.calls.find(([args]) =>
      /letter-spacing/.test(args.htmlContent),
    );
    if (!otpCall) throw new Error("OTP email not found in mock calls");
    const html = otpCall[0].htmlContent;
    const m = html.match(/(\d{6})/);
    if (!m) throw new Error("OTP digits not found in HTML");
    return m[1];
  }

  it("creates ClinicEmployee + ClinicMembership atomically with valid OTP", async () => {
    const { clinic, ownerId } = await setupClinicWithOwner();
    const ownerApp = createTestApp({ userId: ownerId });
    const token = await createAndCaptureToken(ownerApp);

    const publicApp = createTestApp();
    sendRichEmail.mockClear();
    await request(publicApp)
      .post("/api/v1/clinic/invitations/request-otp")
      .send({ token });

    const otp = extractOtpFromMockCalls();

    const res = await request(publicApp)
      .post("/api/v1/clinic/invitations/accept")
      .send({
        token,
        otp,
        password: "SuperSecret123!",
        firstName: "Leyla",
        lastName: "Mammadova",
        phoneNumber: "+994551234567",
        language: "az",
      });

    expect(res.status).toBe(201);
    expect(res.body.employee).toBeDefined();
    expect(res.body.employee.role).toBe("receptionist");

    // Verify ClinicEmployee was created
    const employee = await ClinicEmployee.findById(res.body.employee._id);
    expect(employee).not.toBeNull();
    expect(employee.clinicId.toString()).toBe(clinic._id.toString());
    const decrypted = employee.decryptFields();
    expect(decrypted.firstName).toBe("Leyla");
    expect(decrypted.email).toBe("newhire@example.com");

    // Verify ClinicMembership was created with actorType=employee
    const membership = await ClinicMembership.findOne({
      userId: employee._id,
      clinicId: clinic._id,
    });
    expect(membership).not.toBeNull();
    expect(membership.actorType).toBe("employee");
    expect(membership.role).toBe("receptionist");

    // Verify invitation status changed to accepted
    const invitations = await StaffInvitation.find({ clinicId: clinic._id });
    expect(invitations).toHaveLength(1);
    expect(invitations[0].status).toBe("accepted");
  });
  it("rejects invalid OTP and decrements attempts", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const ownerApp = createTestApp({ userId: ownerId });
    const token = await createAndCaptureToken(ownerApp);

    const publicApp = createTestApp();
    await request(publicApp)
      .post("/api/v1/clinic/invitations/request-otp")
      .send({ token });

    const res = await request(publicApp)
      .post("/api/v1/clinic/invitations/accept")
      .send({
        token,
        otp: "000000",
        password: "SuperSecret123!",
        firstName: "Leyla",
        lastName: "M",
      });

    expect(res.status).toBe(403);

    // Verify attempts decreased
    const inv = await StaffInvitation.findOne({});
    expect(inv.otpAttemptsLeft).toBe(2);
  });

  it("rejects accept without prior OTP request", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const ownerApp = createTestApp({ userId: ownerId });
    const token = await createAndCaptureToken(ownerApp);

    const publicApp = createTestApp();
    const res = await request(publicApp)
      .post("/api/v1/clinic/invitations/accept")
      .send({
        token,
        otp: "123456",
        password: "SuperSecret123!",
        firstName: "Leyla",
        lastName: "M",
      });

    expect(res.status).toBe(422);
  });

  it("rejects double-accept (409)", async () => {
    const { ownerId } = await setupClinicWithOwner();
    const ownerApp = createTestApp({ userId: ownerId });
    const token = await createAndCaptureToken(ownerApp);

    const publicApp = createTestApp();
    sendRichEmail.mockClear();
    await request(publicApp)
      .post("/api/v1/clinic/invitations/request-otp")
      .send({ token });

    const otp = extractOtpFromMockCalls();

    // First accept — should succeed
    await request(publicApp).post("/api/v1/clinic/invitations/accept").send({
      token,
      otp,
      password: "SuperSecret123!",
      firstName: "Leyla",
      lastName: "M",
    });

    // Second accept — should fail
    const res = await request(publicApp)
      .post("/api/v1/clinic/invitations/accept")
      .send({
        token,
        otp,
        password: "SuperSecret123!",
        firstName: "Leyla",
        lastName: "M",
      });

    expect(res.status).toBe(409);
  });
});
