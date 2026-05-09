import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import {
  FEATURES,
  isFeatureEnabled,
  getEnabledFeatures,
  enableFeature,
  disableFeature,
  invalidateFeatureCache,
  clearFeatureCache,
} from "../../common/services/featureFlag.service.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";

beforeEach(() => {
  clearFeatureCache();
});

describe("FeatureFlag — tier defaults", () => {
  it("starter tier has no features", async () => {
    const c = await Clinic.create({
      name: "Starter Clinic",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "starter",
    });
    const features = await getEnabledFeatures(c._id);
    expect(features.size).toBe(0);
  });

  it("pro tier has AI_TRIAGE, WHATSAPP, NO_SHOW_AI", async () => {
    const c = await Clinic.create({
      name: "Pro Clinic",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "pro",
    });
    const features = await getEnabledFeatures(c._id);
    expect(features.has(FEATURES.AI_TRIAGE)).toBe(true);
    expect(features.has(FEATURES.WHATSAPP)).toBe(true);
    expect(features.has(FEATURES.NO_SHOW_AI)).toBe(true);
    expect(features.has(FEATURES.SIMULATION)).toBe(false);
  });

  it("medical_tourism tier includes SIMULATION and CUSTOM_DOMAIN", async () => {
    const c = await Clinic.create({
      name: "Tourism Clinic",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "medical_tourism",
    });
    const features = await getEnabledFeatures(c._id);
    expect(features.has(FEATURES.SIMULATION)).toBe(true);
    expect(features.has(FEATURES.CUSTOM_DOMAIN)).toBe(true);
    expect(features.has(FEATURES.VIDEO_RECEPTION)).toBe(true);
  });

  it("enterprise tier has ALL features", async () => {
    const c = await Clinic.create({
      name: "Enterprise Clinic",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "enterprise",
    });
    const features = await getEnabledFeatures(c._id);
    expect(features.size).toBe(Object.values(FEATURES).length);
  });
});

describe("FeatureFlag — overrides", () => {
  it("enableFeature grants feature on starter clinic", async () => {
    const c = await Clinic.create({
      name: "Starter Override",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "starter",
    });
    expect(await isFeatureEnabled(FEATURES.SIMULATION, c._id)).toBe(false);
    await enableFeature(FEATURES.SIMULATION, c._id);
    expect(await isFeatureEnabled(FEATURES.SIMULATION, c._id)).toBe(true);
  });

  it("disableFeature revokes feature on pro clinic", async () => {
    const c = await Clinic.create({
      name: "Pro Disable",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "pro",
    });
    expect(await isFeatureEnabled(FEATURES.WHATSAPP, c._id)).toBe(true);
    await disableFeature(FEATURES.WHATSAPP, c._id);
    expect(await isFeatureEnabled(FEATURES.WHATSAPP, c._id)).toBe(false);
  });
});

describe("FeatureFlag — cache", () => {
  it("invalidate clears cache after tier change", async () => {
    const c = await Clinic.create({
      name: "Cache Test",
      ownerId: new mongoose.Types.ObjectId(),
      tier: "starter",
    });

    const before = await getEnabledFeatures(c._id);
    expect(before.size).toBe(0);

    // Update tier directly in DB (simulates external update)
    await Clinic.findByIdAndUpdate(c._id, { tier: "pro" });

    // Without invalidation, cache returns stale result
    const stale = await getEnabledFeatures(c._id);
    expect(stale.size).toBe(0);

    // After invalidation, fresh result
    invalidateFeatureCache(c._id);
    const fresh = await getEnabledFeatures(c._id);
    expect(fresh.size).toBeGreaterThan(0);
  });
});
