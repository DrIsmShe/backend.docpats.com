// server/__tests__/clinic-knowledge/clinicKnowledgeArticle.model.test.js
//
// Model-level tests: schema defaults, validation, tenant scoping.
// Mongo connection + per-test cleanup come from __tests__/setup.js.
//
// ClinicKnowledgeArticle is a DEFAULT export; the enum lists are named.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import ClinicKnowledgeArticle, {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_VISIBILITIES,
} from "../../modules/clinic/clinic-knowledge/models/clinicKnowledgeArticle.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicKnowledgeArticle.syncIndexes();
});

describe("ClinicKnowledgeArticle model — basics", () => {
  it("applies defaults (status=draft, category=other, visibility=all, version=1)", async () => {
    const a = await ClinicKnowledgeArticle.create({
      clinicId: CLINIC_A,
      title: "Протокол приёма",
    });
    expect(a.status).toBe("draft");
    expect(a.category).toBe("other");
    expect(a.visibility).toBe("all");
    expect(a.version).toBe(1);
    expect(a.pinned).toBe(false);
    expect(a.departmentId).toBeNull();
    expect(a.publishedAt).toBeNull();
    expect(Array.isArray(a.tags)).toBe(true);
  });

  it("exposes enum lists", () => {
    expect(KNOWLEDGE_STATUSES).toContain("published");
    expect(KNOWLEDGE_CATEGORIES).toContain("sop");
    expect(KNOWLEDGE_VISIBILITIES).toContain("clinical");
  });
});

describe("ClinicKnowledgeArticle model — validation (errors)", () => {
  it("requires title", async () => {
    await expect(
      ClinicKnowledgeArticle.create({ clinicId: CLINIC_A }),
    ).rejects.toThrow(/title/i);
  });

  it("requires clinicId", async () => {
    await expect(ClinicKnowledgeArticle.create({ title: "X" })).rejects.toThrow(
      /clinicId/i,
    );
  });

  it("rejects an invalid status", async () => {
    await expect(
      ClinicKnowledgeArticle.create({
        clinicId: CLINIC_A,
        title: "X",
        status: "live",
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid category", async () => {
    await expect(
      ClinicKnowledgeArticle.create({
        clinicId: CLINIC_A,
        title: "X",
        category: "banana",
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid visibility", async () => {
    await expect(
      ClinicKnowledgeArticle.create({
        clinicId: CLINIC_A,
        title: "X",
        visibility: "secret",
      }),
    ).rejects.toThrow();
  });
});

describe("ClinicKnowledgeArticle model — tenant isolation (raw queries)", () => {
  it("does not return another clinic's articles", async () => {
    await ClinicKnowledgeArticle.create({ clinicId: CLINIC_A, title: "A-doc" });
    await ClinicKnowledgeArticle.create({ clinicId: CLINIC_B, title: "B-doc" });

    const aOnly = await ClinicKnowledgeArticle.find({ clinicId: CLINIC_A });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0].title).toBe("A-doc");
  });
});
