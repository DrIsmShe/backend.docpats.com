// server/__tests__/clinic-telemed/telemed.service.test.js
//
// Service-level tests: CRUD, auto joinKey, department + host validation,
// status transitions with startedAt/endedAt stamping, date-range listing,
// cancel, and the MANDATORY tenant-isolation suite.
//
// Mongo + cleanup from __tests__/setup.js. Service takes clinicId explicitly.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import TelemedSession from "../../modules/clinic/clinic-telemed/models/telemedSession.model.js";
import * as svc from "../../modules/clinic/clinic-telemed/services/telemed.service.js";
import * as deptSvc from "../../modules/clinic/clinic-departments/services/department.service.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await TelemedSession.syncIndexes();
});

async function makeDept(clinicId, name = "Терапия") {
  return deptSvc.createDepartment(clinicId, { name });
}
async function makeMembership(clinicId, role = "doctor") {
  return ClinicMembership.create({
    userId: new mongoose.Types.ObjectId(),
    clinicId,
    role,
  });
}

const soon = () => new Date(Date.now() + 3600_000).toISOString();

// ─── CREATE ───
describe("createSession", () => {
  it("creates a scheduled session with an auto joinKey", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "Первичная консультация",
      scheduledAt: soon(),
    });
    expect(s.status).toBe("scheduled");
    expect(s.durationMinutes).toBe(30);
    expect(typeof s.joinKey).toBe("string");
    expect(s.joinKey.length).toBeGreaterThan(10);
    expect(String(s.clinicId)).toBe(String(CLINIC_A));
  });

  it("generates distinct joinKeys", async () => {
    const a = await svc.createSession(CLINIC_A, {
      title: "A",
      scheduledAt: soon(),
    });
    const b = await svc.createSession(CLINIC_A, {
      title: "B",
      scheduledAt: soon(),
    });
    expect(a.joinKey).not.toBe(b.joinKey);
  });

  it("accepts a valid department and host membership", async () => {
    const dept = await makeDept(CLINIC_A);
    const host = await makeMembership(CLINIC_A);
    const s = await svc.createSession(CLINIC_A, {
      title: "С врачом",
      scheduledAt: soon(),
      departmentId: dept._id,
      hostMembershipId: host._id,
    });
    expect(String(s.departmentId)).toBe(String(dept._id));
    expect(String(s.hostMembershipId)).toBe(String(host._id));
  });

  it("rejects a department from another clinic", async () => {
    const foreign = await makeDept(CLINIC_B, "Foreign");
    await expect(
      svc.createSession(CLINIC_A, {
        title: "X",
        scheduledAt: soon(),
        departmentId: foreign._id,
      }),
    ).rejects.toThrow(/not found in this clinic/i);
  });

  it("rejects a host membership from another clinic", async () => {
    const foreign = await makeMembership(CLINIC_B);
    await expect(
      svc.createSession(CLINIC_A, {
        title: "X",
        scheduledAt: soon(),
        hostMembershipId: foreign._id,
      }),
    ).rejects.toThrow(/does not belong to this clinic/i);
  });

  it("rejects an invalid scheduledAt", async () => {
    await expect(
      svc.createSession(CLINIC_A, {
        title: "X",
        scheduledAt: "not-a-date",
      }),
    ).rejects.toThrow(/not a valid date/i);
  });

  it("stores meetingUrl and patientUserId when provided", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const s = await svc.createSession(CLINIC_A, {
      title: "Видеоприём",
      scheduledAt: soon(),
      meetingUrl: "https://meet.jit.si/docpats-test",
      patientUserId,
    });
    expect(s.meetingUrl).toBe("https://meet.jit.si/docpats-test");
    expect(String(s.patientUserId)).toBe(String(patientUserId));

    const cleared = await svc.updateSession(CLINIC_A, s._id, {
      meetingUrl: null,
    });
    // patientUserId still set → no auto link, stays null
    expect(cleared.meetingUrl).toBeNull();
  });

  it("auto-generates meetingUrl when neither link nor patientUserId given", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "Авто-комната",
      scheduledAt: soon(),
    });
    expect(s.meetingUrl).toBeTruthy();
    expect(s.meetingUrl).toContain(s.joinKey);
  });

  it("does NOT auto-generate when a manual meetingUrl is provided", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "Ручная ссылка",
      scheduledAt: soon(),
      meetingUrl: "https://doxy.me/dr-ismayil",
    });
    expect(s.meetingUrl).toBe("https://doxy.me/dr-ismayil");
  });

  it("does NOT auto-generate when patientUserId is set (native call path)", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "Нативный звонок",
      scheduledAt: soon(),
      patientUserId: new mongoose.Types.ObjectId(),
    });
    expect(s.meetingUrl).toBeNull();
  });

  it("re-fills auto meetingUrl on update when link and patientUserId both cleared", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "Очистка",
      scheduledAt: soon(),
      patientUserId: new mongoose.Types.ObjectId(),
    });
    expect(s.meetingUrl).toBeNull();
    const u = await svc.updateSession(CLINIC_A, s._id, {
      patientUserId: null,
    });
    expect(u.meetingUrl).toBeTruthy();
    expect(u.meetingUrl).toContain(s.joinKey);
  });
});

// ─── LIST ───
describe("listSessions", () => {
  it("returns only this clinic's sessions, soonest first", async () => {
    const t1 = new Date(Date.now() + 7200_000).toISOString();
    const t2 = new Date(Date.now() + 3600_000).toISOString();
    await svc.createSession(CLINIC_A, { title: "Later", scheduledAt: t1 });
    await svc.createSession(CLINIC_A, { title: "Sooner", scheduledAt: t2 });
    await svc.createSession(CLINIC_B, { title: "Other", scheduledAt: t2 });

    const list = await svc.listSessions(CLINIC_A);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe("Sooner");
  });

  it("filters by status", async () => {
    await svc.createSession(CLINIC_A, { title: "Sched", scheduledAt: soon() });
    const live = await svc.createSession(CLINIC_A, {
      title: "Live one",
      scheduledAt: soon(),
    });
    await svc.updateSession(CLINIC_A, live._id, { status: "live" });

    const onlyLive = await svc.listSessions(CLINIC_A, { status: "live" });
    expect(onlyLive.map((s) => s.title)).toEqual(["Live one"]);
  });

  it("filters by date range", async () => {
    const near = new Date(Date.now() + 3600_000).toISOString();
    const far = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    await svc.createSession(CLINIC_A, { title: "Near", scheduledAt: near });
    await svc.createSession(CLINIC_A, { title: "Far", scheduledAt: far });

    const to = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
    const within = await svc.listSessions(CLINIC_A, { to });
    expect(within.map((s) => s.title)).toEqual(["Near"]);
  });

  it("search q matches title (regex-safe)", async () => {
    await svc.createSession(CLINIC_A, {
      title: "Кардиоконсультация",
      scheduledAt: soon(),
    });
    await svc.createSession(CLINIC_A, { title: "Невро", scheduledAt: soon() });

    const hit = await svc.listSessions(CLINIC_A, { q: "Кардио" });
    expect(hit).toHaveLength(1);
    const none = await svc.listSessions(CLINIC_A, { q: ".*" });
    expect(none).toHaveLength(0);
  });
});

// ─── GET ───
describe("getSessionById", () => {
  it("throws NotFound for an id outside the clinic", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "X",
      scheduledAt: soon(),
    });
    await expect(svc.getSessionById(CLINIC_B, s._id)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ─── UPDATE / transitions ───
describe("updateSession — transitions", () => {
  it("reschedules", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "X",
      scheduledAt: soon(),
    });
    const newTime = new Date(Date.now() + 5 * 3600_000).toISOString();
    const u = await svc.updateSession(CLINIC_A, s._id, {
      scheduledAt: newTime,
    });
    expect(new Date(u.scheduledAt).toISOString()).toBe(
      new Date(newTime).toISOString(),
    );
  });

  it("stamps startedAt when going live", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "X",
      scheduledAt: soon(),
    });
    const live = await svc.updateSession(CLINIC_A, s._id, { status: "live" });
    expect(live.status).toBe("live");
    expect(live.startedAt).toBeTruthy();
  });

  it("stamps endedAt when completing", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "X",
      scheduledAt: soon(),
    });
    await svc.updateSession(CLINIC_A, s._id, { status: "live" });
    const done = await svc.updateSession(CLINIC_A, s._id, {
      status: "completed",
    });
    expect(done.status).toBe("completed");
    expect(done.endedAt).toBeTruthy();
  });

  it("rejects an invalid scheduledAt on update", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "X",
      scheduledAt: soon(),
    });
    await expect(
      svc.updateSession(CLINIC_A, s._id, { scheduledAt: "bad" }),
    ).rejects.toThrow(/not a valid date/i);
  });
});

// ─── CANCEL ───
describe("cancelSession", () => {
  it("sets status cancelled + endedAt (record stays)", async () => {
    const s = await svc.createSession(CLINIC_A, {
      title: "X",
      scheduledAt: soon(),
    });
    const c = await svc.cancelSession(CLINIC_A, s._id);
    expect(c.status).toBe("cancelled");
    expect(c.endedAt).toBeTruthy();
    const still = await TelemedSession.findById(s._id);
    expect(still).not.toBeNull();
  });
});

// ─── MANDATORY TENANT ISOLATION ───
describe("tenant isolation (mandatory)", () => {
  it("clinic A cannot read clinic B's session", async () => {
    const b = await svc.createSession(CLINIC_B, {
      title: "B",
      scheduledAt: soon(),
    });
    await expect(svc.getSessionById(CLINIC_A, b._id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("clinic A cannot update clinic B's session", async () => {
    const b = await svc.createSession(CLINIC_B, {
      title: "B",
      scheduledAt: soon(),
    });
    await expect(
      svc.updateSession(CLINIC_A, b._id, { title: "hacked" }),
    ).rejects.toThrow(/not found/i);
    const untouched = await TelemedSession.findById(b._id);
    expect(untouched.title).toBe("B");
  });

  it("clinic A cannot cancel clinic B's session", async () => {
    const b = await svc.createSession(CLINIC_B, {
      title: "B",
      scheduledAt: soon(),
    });
    await expect(svc.cancelSession(CLINIC_A, b._id)).rejects.toThrow(
      /not found/i,
    );
    const untouched = await TelemedSession.findById(b._id);
    expect(untouched.status).toBe("scheduled");
  });
});
