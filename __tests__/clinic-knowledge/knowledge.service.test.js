// server/__tests__/clinic-knowledge/knowledge.service.test.js
//
// Service-level tests: CRUD, publish/version semantics, optional
// department-ownership validation, filters (category/status/tag/q),
// soft-archive, and the MANDATORY tenant-isolation suite.
//
// Mongo + cleanup from __tests__/setup.js. Service takes clinicId as an
// explicit arg (no ALS), like the other clinic-* services.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import ClinicKnowledgeArticle from "../../modules/clinic/clinic-knowledge/models/clinicKnowledgeArticle.model.js";
import * as svc from "../../modules/clinic/clinic-knowledge/services/knowledge.service.js";
import * as deptSvc from "../../modules/clinic/clinic-departments/services/department.service.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicKnowledgeArticle.syncIndexes();
});

async function makeDept(clinicId, name = "Неврология") {
  return deptSvc.createDepartment(clinicId, { name });
}

// ─── CREATE ───
describe("createArticle — basics", () => {
  it("creates a draft with defaults", async () => {
    const a = await svc.createArticle(CLINIC_A, { title: "Протокол" });
    expect(a.title).toBe("Протокол");
    expect(a.status).toBe("draft");
    expect(a.version).toBe(1);
    expect(a.publishedAt).toBeNull();
    expect(String(a.clinicId)).toBe(String(CLINIC_A));
  });

  it("stamps publishedAt when created as published", async () => {
    const a = await svc.createArticle(CLINIC_A, {
      title: "Готовый",
      status: "published",
    });
    expect(a.status).toBe("published");
    expect(a.publishedAt).toBeTruthy();
  });

  it("accepts an optional department of this clinic", async () => {
    const dept = await makeDept(CLINIC_A);
    const a = await svc.createArticle(CLINIC_A, {
      title: "Departmental",
      departmentId: dept._id,
    });
    expect(String(a.departmentId)).toBe(String(dept._id));
  });

  it("rejects a department from another clinic", async () => {
    const foreign = await makeDept(CLINIC_B, "Foreign");
    await expect(
      svc.createArticle(CLINIC_A, {
        title: "X",
        departmentId: foreign._id,
      }),
    ).rejects.toThrow(/not found in this clinic/i);
  });
});

// ─── LIST ───
describe("listArticles", () => {
  it("returns only this clinic's articles", async () => {
    await svc.createArticle(CLINIC_A, { title: "A1" });
    await svc.createArticle(CLINIC_A, { title: "A2" });
    await svc.createArticle(CLINIC_B, { title: "B1" });

    const list = await svc.listArticles(CLINIC_A);
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.title).sort()).toEqual(["A1", "A2"]);
  });

  it("filters by category and status", async () => {
    await svc.createArticle(CLINIC_A, {
      title: "SOP doc",
      category: "sop",
      status: "published",
    });
    await svc.createArticle(CLINIC_A, { title: "Draft FAQ", category: "faq" });

    const sop = await svc.listArticles(CLINIC_A, { category: "sop" });
    expect(sop.map((a) => a.title)).toEqual(["SOP doc"]);

    const published = await svc.listArticles(CLINIC_A, { status: "published" });
    expect(published.map((a) => a.title)).toEqual(["SOP doc"]);
  });

  it("filters by tag", async () => {
    await svc.createArticle(CLINIC_A, {
      title: "Tagged",
      tags: ["covid", "triage"],
    });
    await svc.createArticle(CLINIC_A, { title: "Untagged" });

    const hit = await svc.listArticles(CLINIC_A, { tag: "triage" });
    expect(hit.map((a) => a.title)).toEqual(["Tagged"]);
  });

  it("search q matches title and is regex-safe", async () => {
    await svc.createArticle(CLINIC_A, { title: "Кардиопротокол" });
    await svc.createArticle(CLINIC_A, { title: "Неврология" });

    const hit = await svc.listArticles(CLINIC_A, { q: "Кардио" });
    expect(hit).toHaveLength(1);

    const none = await svc.listArticles(CLINIC_A, { q: ".*" });
    expect(none).toHaveLength(0);
  });

  it("sorts pinned first", async () => {
    await svc.createArticle(CLINIC_A, { title: "Normal" });
    await svc.createArticle(CLINIC_A, { title: "Pinned", pinned: true });

    const list = await svc.listArticles(CLINIC_A);
    expect(list[0].title).toBe("Pinned");
  });
});

// ─── GET ───
describe("getArticleById", () => {
  it("returns the article", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "X" });
    const found = await svc.getArticleById(CLINIC_A, created._id);
    expect(found.title).toBe("X");
  });

  it("throws NotFound for an id outside the clinic", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "X" });
    await expect(svc.getArticleById(CLINIC_B, created._id)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ─── UPDATE ───
describe("updateArticle", () => {
  it("updates fields", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "Old" });
    const updated = await svc.updateArticle(CLINIC_A, created._id, {
      title: "New",
      category: "guideline",
    });
    expect(updated.title).toBe("New");
    expect(updated.category).toBe("guideline");
  });

  it("bumps version when content changes", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "V1" });
    expect(created.version).toBe(1);
    const updated = await svc.updateArticle(CLINIC_A, created._id, {
      body: "new body",
    });
    expect(updated.version).toBe(2);
  });

  it("does NOT bump version for non-content changes (pinned)", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "V1" });
    const updated = await svc.updateArticle(CLINIC_A, created._id, {
      pinned: true,
    });
    expect(updated.version).toBe(1);
    expect(updated.pinned).toBe(true);
  });

  it("stamps publishedAt on first publish only", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "Draft" });
    const published = await svc.updateArticle(CLINIC_A, created._id, {
      status: "published",
    });
    expect(published.publishedAt).toBeTruthy();
    const firstStamp = published.publishedAt;

    // archive then re-publish shouldn't reset the original publishedAt
    await svc.updateArticle(CLINIC_A, created._id, { status: "archived" });
    const rePublished = await svc.updateArticle(CLINIC_A, created._id, {
      status: "published",
    });
    expect(String(rePublished.publishedAt)).toBe(String(firstStamp));
  });

  it("rejects moving to a foreign department", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "X" });
    const foreign = await makeDept(CLINIC_B, "Foreign");
    await expect(
      svc.updateArticle(CLINIC_A, created._id, {
        departmentId: foreign._id,
      }),
    ).rejects.toThrow(/not found in this clinic/i);
  });
});

// ─── ARCHIVE ───
describe("archiveArticle", () => {
  it("soft-archives (status=archived, record stays)", async () => {
    const created = await svc.createArticle(CLINIC_A, { title: "X" });
    const archived = await svc.archiveArticle(CLINIC_A, created._id);
    expect(archived.status).toBe("archived");

    const stillThere = await ClinicKnowledgeArticle.findById(created._id);
    expect(stillThere).not.toBeNull();
  });
});

// ─── MANDATORY TENANT ISOLATION ───
describe("tenant isolation (mandatory)", () => {
  it("clinic A cannot read clinic B's article", async () => {
    const b = await svc.createArticle(CLINIC_B, { title: "B-secret" });
    await expect(svc.getArticleById(CLINIC_A, b._id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("clinic A cannot update clinic B's article", async () => {
    const b = await svc.createArticle(CLINIC_B, { title: "B" });
    await expect(
      svc.updateArticle(CLINIC_A, b._id, { title: "hacked" }),
    ).rejects.toThrow(/not found/i);

    const untouched = await ClinicKnowledgeArticle.findById(b._id);
    expect(untouched.title).toBe("B");
  });

  it("clinic A cannot archive clinic B's article", async () => {
    const b = await svc.createArticle(CLINIC_B, { title: "B" });
    await expect(svc.archiveArticle(CLINIC_A, b._id)).rejects.toThrow(
      /not found/i,
    );

    const untouched = await ClinicKnowledgeArticle.findById(b._id);
    expect(untouched.status).toBe("draft");
  });
});
