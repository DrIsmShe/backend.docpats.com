// server/common/services/featureFlag.service.js
//
// Per-clinic feature flags.
//
// Two layers:
//   1. Tier-based features (defined by Clinic.tier: starter/pro/medical_tourism/enterprise)
//   2. Per-clinic overrides stored in FeatureFlag collection
//
// Final resolution: tier features ∪ explicit-enabled - explicit-disabled.
//
// Usage:
//   import { isFeatureEnabled, requireFeature, FEATURES } from ".../featureFlag.service.js";
//
//   if (await isFeatureEnabled(FEATURES.PHARMACY, clinicId)) { ... }
//
//   router.use("/pharmacy", requireFeature(FEATURES.PHARMACY), pharmacyRoutes);

import mongoose from "mongoose";
import logger from "../logger.js";

const log = logger.child({ module: "featureFlag" });

// ─── FEATURE FLAGS REGISTRY ─────────────────────────────────────

/**
 * All possible features.
 * When adding a new feature → register here AND add to TIER_FEATURES below.
 */
export const FEATURES = Object.freeze({
  // Tier-gated
  PHARMACY: "pharmacy",
  ACCOUNTING: "accounting",
  AI_TRIAGE: "ai_triage",
  SIMULATION: "simulation",
  VIDEO_RECEPTION: "video_reception",
  CUSTOM_DOMAIN: "custom_domain",
  WHITE_LABEL: "white_label",
  WHATSAPP: "whatsapp",
  WEBHOOKS: "webhooks",

  // Experimental
  NO_SHOW_AI: "no_show_ai_predictor",
  AUTO_SEO: "auto_seo_articles",
  CROSS_CLINIC_REFERRAL: "cross_clinic_referral",
});

/**
 * Default features per tier.
 */
const TIER_FEATURES = Object.freeze({
  starter: [],

  pro: [FEATURES.AI_TRIAGE, FEATURES.WHATSAPP, FEATURES.NO_SHOW_AI],

  medical_tourism: [
    FEATURES.AI_TRIAGE,
    FEATURES.SIMULATION,
    FEATURES.VIDEO_RECEPTION,
    FEATURES.CUSTOM_DOMAIN,
    FEATURES.WHATSAPP,
  ],

  enterprise: Object.values(FEATURES), // all features
});

// ─── MONGOOSE MODEL ────────────────────────────────────────────

const featureFlagSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      index: true,
    },
    enabled: { type: Boolean, default: false },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    enabledAt: Date,
    enabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    collection: "feature_flags",
  },
);

featureFlagSchema.index({ clinicId: 1, feature: 1 }, { unique: true });

const FeatureFlag =
  mongoose.models.FeatureFlag ||
  mongoose.model("FeatureFlag", featureFlagSchema);

// ─── IN-MEMORY CACHE ───────────────────────────────────────────

/**
 * Cache of resolved feature sets per clinic.
 * Map<clinicIdStr, { features: Set<string>, expiry: number }>
 */
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Invalidate cache for a clinic. Call when:
 *   - Clinic.tier changes
 *   - A FeatureFlag is created/updated/deleted for the clinic
 */
export function invalidateFeatureCache(clinicId) {
  cache.delete(String(clinicId));
}

/**
 * Clear entire cache (useful in tests).
 */
export function clearFeatureCache() {
  cache.clear();
}

// ─── PUBLIC API ────────────────────────────────────────────────

/**
 * Get the full set of enabled features for a clinic.
 * @param {string|ObjectId} clinicId
 * @returns {Promise<Set<string>>}
 */
export async function getEnabledFeatures(clinicId) {
  if (!clinicId) return new Set();

  const key = String(clinicId);
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.features;
  }

  // Lazy-load Clinic model to avoid circular import at module init
  const Clinic = mongoose.models.Clinic || mongoose.model("Clinic");
  const clinic = await Clinic.findById(clinicId).select("tier").lean();

  if (!clinic) {
    log.warn({ clinicId: key }, "getEnabledFeatures: clinic not found");
    return new Set();
  }

  const tier = clinic.tier || "starter";
  const tierFeatures = TIER_FEATURES[tier] || [];
  const features = new Set(tierFeatures);

  // Apply per-clinic overrides
  const overrides = await FeatureFlag.find({ clinicId }).lean();
  overrides.forEach((flag) => {
    if (flag.enabled) features.add(flag.feature);
    else features.delete(flag.feature);
  });

  cache.set(key, { features, expiry: Date.now() + CACHE_TTL_MS });
  return features;
}

/**
 * Check if a single feature is enabled for a clinic.
 * @param {string} feature
 * @param {string|ObjectId} clinicId
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(feature, clinicId) {
  const features = await getEnabledFeatures(clinicId);
  return features.has(feature);
}

/**
 * Express middleware factory: blocks route if feature is not enabled.
 * Requires tenantContext to be set (i.e. tenantMiddleware must run first).
 *
 *   router.use("/pharmacy", requireFeature(FEATURES.PHARMACY), pharmacyRouter);
 */
export function requireFeature(feature) {
  return async (req, res, next) => {
    const clinicId = req.tenantContext?.clinicId;
    if (!clinicId) {
      return res.status(403).json({
        error: "No clinic context",
        code: "NO_CLINIC_MEMBERSHIP",
      });
    }
    try {
      const enabled = await isFeatureEnabled(feature, clinicId);
      if (!enabled) {
        return res.status(403).json({
          error: `Feature '${feature}' is not enabled for your clinic`,
          code: "FEATURE_NOT_ENABLED",
          feature,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Enable a feature override for a clinic (admin operation).
 */
export async function enableFeature(feature, clinicId, enabledByUserId = null) {
  const flag = await FeatureFlag.findOneAndUpdate(
    { clinicId, feature },
    {
      enabled: true,
      enabledAt: new Date(),
      enabledBy: enabledByUserId,
    },
    { upsert: true, new: true },
  );
  invalidateFeatureCache(clinicId);
  return flag;
}

/**
 * Disable a feature for a clinic (admin operation).
 */
export async function disableFeature(feature, clinicId) {
  await FeatureFlag.findOneAndUpdate(
    { clinicId, feature },
    { enabled: false, enabledAt: null, enabledBy: null },
    { upsert: true },
  );
  invalidateFeatureCache(clinicId);
}

// Re-export model in case admin tools need it
export { FeatureFlag };
