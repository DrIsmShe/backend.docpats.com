// __tests__/clinic-core/clinic-create.test.js

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import * as service from "../../modules/clinic/clinic-core/services/clinic.service.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import { ROLES } from "../../common/auth/permissions.js";

describe("clinic-core service — createClinic", () => {
  let userId;

  beforeEach(() => {
    userId = new mongoose.Types.ObjectId();
  });

  it("creates clinic with owner membership", async () => {
    const { clinic, membership } = await service.createClinic(
      { name: "Test Clinic", timezone: "Asia/Baku", defaultCurrency: "AZN" },
      userId,
    );

    expect(clinic.name).toBe("Test Clinic");
    expect(clinic.slug).toBe("test-clinic");
    expect(String(clinic.ownerId)).toBe(String(userId));
    expect(clinic.tier).toBe("starter");

    expect(String(membership.userId)).toBe(String(userId));
    expect(String(membership.clinicId)).toBe(String(clinic._id));
    expect(membership.role).toBe(ROLES.OWNER);
    expect(membership.isPrimary).toBe(true);
  });

  it("auto-generates slug from name", async () => {
    const { clinic } = await service.createClinic(
      { name: "Best Clinic Baku" },
      userId,
    );
    expect(clinic.slug).toBe("best-clinic-baku");
  });

  it("uses provided slug if given", async () => {
    const { clinic } = await service.createClinic(
      { name: "Test", slug: "custom-slug" },
      userId,
    );
    expect(clinic.slug).toBe("custom-slug");
  });

  it("rejects duplicate slug", async () => {
    await service.createClinic({ name: "First" }, userId);
    await expect(
      service.createClinic({ name: "First Other", slug: "first" }, userId),
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects creation without ownerId", async () => {
    await expect(service.createClinic({ name: "Test" })).rejects.toThrow();
  });

  it("creates two clinics for same owner", async () => {
    const { clinic: c1 } = await service.createClinic(
      { name: "Clinic A" },
      userId,
    );
    const { clinic: c2 } = await service.createClinic(
      { name: "Clinic B" },
      userId,
    );

    const memberships = await ClinicMembership.find({ userId }).setOptions({
      skipTenantScope: true,
    });

    expect(memberships).toHaveLength(2);
    expect(memberships.every((m) => m.role === ROLES.OWNER)).toBe(true);
  });
});

describe("clinic-core service — getClinicBySlug", () => {
  it("returns clinic by slug", async () => {
    const userId = new mongoose.Types.ObjectId();
    await service.createClinic(
      { name: "Best Clinic", slug: "best-clinic" },
      userId,
    );

    const clinic = await service.getClinicBySlug("best-clinic");
    expect(clinic.name).toBe("Best Clinic");
  });

  it("throws NotFoundError for unknown slug", async () => {
    await expect(service.getClinicBySlug("nonexistent")).rejects.toThrow(
      /not found/i,
    );
  });
});
