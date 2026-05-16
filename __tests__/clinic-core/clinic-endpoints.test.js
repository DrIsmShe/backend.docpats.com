// __tests__/clinic-core/clinic-endpoints.test.js
//
// Integration tests for clinic-core HTTP endpoints.
// Uses supertest + an in-process Express app with mocked session.
//
// IMPORTANT (16 May 2026):
//   The createClinic controller now loads the User from DB and verifies
//   user.isDoctor === true (day-10 security fix). Tests that hit
//   POST /clinics MUST seed a matching User document via createTestDoctor,
//   not just mock req.session.userId. Otherwise the controller throws
//   UnauthorizedError ("User not found") → 401.
//
//   Other endpoints (PATCH /clinics/:id, GET /me, etc.) DO NOT load the
//   User and just trust the session — those tests don't need a seeded
//   User for the auth path itself (though they call service.createClinic
//   directly to set up tenant memberships).

import { describe, it, expect } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import { createTestApp } from "../helpers/withSession.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import * as service from "../../modules/clinic/clinic-core/services/clinic.service.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";

describe("POST /api/v1/clinic/clinics", () => {
  it("rejects unauthenticated requests", async () => {
    const app = createTestApp(); // no userId
    const res = await request(app)
      .post("/api/v1/clinic/clinics")
      .send({ name: "Anonymous Clinic" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("creates clinic for authenticated user", async () => {
    // Seed a doctor User in DB — controller's createClinic guard
    // does User.findById(userId) and requires isDoctor === true.
    const { userId } = await createTestDoctor();
    const app = createTestApp({ userId });

    const res = await request(app).post("/api/v1/clinic/clinics").send({
      name: "Best Clinic Baku",
      timezone: "Asia/Baku",
      defaultCurrency: "AZN",
    });

    expect(res.status).toBe(201);
    expect(res.body.clinic.name).toBe("Best Clinic Baku");
    expect(res.body.clinic.slug).toBe("best-clinic-baku");
    expect(res.body.clinic.tier).toBe("starter");
    expect(res.body.membership.role).toBe("owner");
    expect(res.body.membership.isPrimary).toBe(true);
  });

  it("rejects invalid input (no name)", async () => {
    const { userId } = await createTestDoctor();
    const app = createTestApp({ userId });

    const res = await request(app)
      .post("/api/v1/clinic/clinics")
      .send({ timezone: "Asia/Baku" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate slug with 409", async () => {
    const { userId } = await createTestDoctor();
    const app = createTestApp({ userId });

    await request(app)
      .post("/api/v1/clinic/clinics")
      .send({ name: "First", slug: "shared" });

    const res = await request(app)
      .post("/api/v1/clinic/clinics")
      .send({ name: "Second", slug: "shared" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });
});

describe("GET /api/v1/clinic/me", () => {
  it("returns authenticated:false without session", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/v1/clinic/me");

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it("returns hasClinic:false for user without membership", async () => {
    const userId = new mongoose.Types.ObjectId();
    const app = createTestApp({ userId });

    const res = await request(app).get("/api/v1/clinic/me");

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.hasClinic).toBe(false);
    expect(res.body.userId).toBe(String(userId));
  });

  it("returns full context for owner", async () => {
    const userId = new mongoose.Types.ObjectId();
    const { clinic } = await service.createClinic(
      { name: "My Clinic", tier: "pro" },
      userId,
    );

    const app = createTestApp({ userId });
    const res = await request(app).get("/api/v1/clinic/me");

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.hasClinic).toBe(true);
    expect(res.body.role).toBe("owner");
    expect(res.body.clinicId).toBe(String(clinic._id));

    // Full clinic object embedded
    expect(res.body.clinic).toBeDefined();
    expect(res.body.clinic.name).toBe("My Clinic");
    expect(res.body.clinic.tier).toBe("pro");
    expect(res.body.clinic.timezone).toBe("Asia/Baku");

    // Owner has full permissions
    expect(res.body.permissions.clinic.write).toBe(true);
    expect(res.body.permissions.staff.delete).toBe(true);

    // Pro tier has these features
    expect(res.body.features).toContain("ai_triage");
    expect(res.body.features).toContain("whatsapp");
    expect(res.body.features).not.toContain("simulation");
  });
});

describe("GET /api/v1/clinic/me/memberships", () => {
  it("returns 401 without auth", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/v1/clinic/me/memberships");
    expect(res.status).toBe(401);
  });

  it("lists all clinics user belongs to", async () => {
    const userId = new mongoose.Types.ObjectId();
    const { clinic: c1 } = await service.createClinic(
      { name: "Clinic A" },
      userId,
    );
    const { clinic: c2 } = await service.createClinic(
      { name: "Clinic B" },
      userId,
    );

    const app = createTestApp({ userId });
    const res = await request(app).get("/api/v1/clinic/me/memberships");

    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(2);
    const ids = res.body.memberships.map((m) => m.clinicId).sort();
    expect(ids).toEqual([String(c1._id), String(c2._id)].sort());
  });
});

describe("PATCH /api/v1/clinic/clinics/:id", () => {
  it("owner can update own clinic", async () => {
    const userId = new mongoose.Types.ObjectId();
    const { clinic } = await service.createClinic({ name: "Original" }, userId);

    const app = createTestApp({ userId });
    const res = await request(app)
      .patch(`/api/v1/clinic/clinics/${clinic._id}`)
      .send({ name: "Updated Name", contacts: { phone: "+994551234567" } });

    expect(res.status).toBe(200);
    expect(res.body.clinic.name).toBe("Updated Name");
    expect(res.body.clinic.contacts.phone).toBe("+994551234567");
  });

  it("rejects update of foreign clinic (cross-tenant)", async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const { clinic: clinicA } = await service.createClinic(
      { name: "A" },
      userA,
    );
    await service.createClinic({ name: "B" }, userB);

    // userB tries to update clinicA
    const app = createTestApp({ userId: userB });
    const res = await request(app)
      .patch(`/api/v1/clinic/clinics/${clinicA._id}`)
      .send({ name: "Hijacked" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");

    // Verify clinicA was NOT modified
    const fresh = await Clinic.findById(clinicA._id);
    expect(fresh.name).toBe("A");
  });

  it("rejects update without authentication", async () => {
    const userId = new mongoose.Types.ObjectId();
    const { clinic } = await service.createClinic({ name: "Test" }, userId);

    const app = createTestApp(); // no userId
    const res = await request(app)
      .patch(`/api/v1/clinic/clinics/${clinic._id}`)
      .send({ name: "Hacked" });

    // Without context, RBAC blocks the write attempt
    expect([401, 403]).toContain(res.status);
  });

  it("ignores forbidden fields like ownerId and tier", async () => {
    const userId = new mongoose.Types.ObjectId();
    const { clinic } = await service.createClinic({ name: "Test" }, userId);
    const fakeOwner = new mongoose.Types.ObjectId();

    const app = createTestApp({ userId });
    const res = await request(app)
      .patch(`/api/v1/clinic/clinics/${clinic._id}`)
      .send({ name: "New Name", ownerId: fakeOwner });

    expect(res.status).toBe(200);
    expect(res.body.clinic.name).toBe("New Name");
    // ownerId did NOT change
    expect(String(res.body.clinic.ownerId)).toBe(String(userId));
  });
});

describe("GET /api/v1/clinic/public/:slug", () => {
  it("returns public profile without auth", async () => {
    const userId = new mongoose.Types.ObjectId();
    await service.createClinic(
      { name: "Public Clinic", slug: "public-clinic" },
      userId,
    );

    const app = createTestApp(); // no userId
    const res = await request(app).get("/api/v1/clinic/public/public-clinic");

    expect(res.status).toBe(200);
    expect(res.body.clinic.name).toBe("Public Clinic");
    expect(res.body.clinic.slug).toBe("public-clinic");

    // Internal fields should NOT be exposed
    expect(res.body.clinic.ownerId).toBeUndefined();
    expect(res.body.clinic.tier).toBeUndefined();
  });

  it("returns 404 for unknown slug", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/v1/clinic/public/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
