import { describe, it, expect } from "vitest";
import {
  runWithTenantContext,
  getTenantContext,
  getCurrentUserId,
  getCurrentClinicId,
  getCurrentRole,
  getCurrentPermissions,
  getCurrentMembershipId,
  hasActiveContext,
  updateTenantContext,
} from "../../common/context/tenantContext.js";

describe("tenantContext — outside context", () => {
  it("hasActiveContext = false outside", () => {
    expect(hasActiveContext()).toBe(false);
  });

  it("all getters return null/empty outside", () => {
    expect(getCurrentUserId()).toBeNull();
    expect(getCurrentClinicId()).toBeNull();
    expect(getCurrentRole()).toBeNull();
    expect(getCurrentPermissions()).toEqual({});
    expect(getCurrentMembershipId()).toBeNull();
    expect(getTenantContext()).toEqual({});
  });

  it("updateTenantContext throws outside", () => {
    expect(() => updateTenantContext({ role: "admin" })).toThrow(
      /no active context/i,
    );
  });
});

describe("tenantContext — inside context", () => {
  it("getters return values inside sync callback", () => {
    runWithTenantContext(
      {
        userId: "u1",
        clinicId: "c1",
        role: "doctor",
        permissions: { x: true },
      },
      () => {
        expect(hasActiveContext()).toBe(true);
        expect(getCurrentUserId()).toBe("u1");
        expect(getCurrentClinicId()).toBe("c1");
        expect(getCurrentRole()).toBe("doctor");
        expect(getCurrentPermissions()).toEqual({ x: true });
      },
    );
  });

  it("context propagates through async/await", async () => {
    const result = await runWithTenantContext(
      { userId: "u2", clinicId: "c2", role: "admin" },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getCurrentClinicId();
      },
    );
    expect(result).toBe("c2");
  });

  it("nested contexts override and restore", () => {
    runWithTenantContext({ userId: "outer", clinicId: "C_outer" }, () => {
      expect(getCurrentClinicId()).toBe("C_outer");
      runWithTenantContext({ userId: "inner", clinicId: "C_inner" }, () => {
        expect(getCurrentClinicId()).toBe("C_inner");
      });
      expect(getCurrentClinicId()).toBe("C_outer");
    });
  });
});

describe("tenantContext — parallel isolation (CRITICAL)", () => {
  it("parallel async tasks see their own contexts", async () => {
    const task = async (label, ctx) => {
      return runWithTenantContext(ctx, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 30));
        return { label, clinicId: getCurrentClinicId() };
      });
    };

    const results = await Promise.all([
      task("A", { userId: "uA", clinicId: "clinic_A" }),
      task("B", { userId: "uB", clinicId: "clinic_B" }),
      task("C", { userId: "uC", clinicId: "clinic_C" }),
    ]);

    expect(results.find((r) => r.label === "A").clinicId).toBe("clinic_A");
    expect(results.find((r) => r.label === "B").clinicId).toBe("clinic_B");
    expect(results.find((r) => r.label === "C").clinicId).toBe("clinic_C");
  });

  it("thenable return value keeps context alive", async () => {
    // Simulates a Mongoose Query (thenable, not Promise)
    const fakeThenable = {
      then(resolve) {
        // Resolve in next tick
        setTimeout(() => resolve(getCurrentClinicId()), 10);
        return this;
      },
    };

    const result = await runWithTenantContext(
      { userId: "x", clinicId: "C_thenable" },
      () => fakeThenable,
    );

    expect(result).toBe("C_thenable");
  });
});

describe("tenantContext — updateTenantContext", () => {
  it("updates fields in current context", () => {
    runWithTenantContext({ userId: "u", clinicId: "C1" }, () => {
      updateTenantContext({ role: "admin", clinicId: "C2" });
      expect(getCurrentClinicId()).toBe("C2");
      expect(getCurrentRole()).toBe("admin");
      expect(getCurrentUserId()).toBe("u"); // not touched
    });
  });
});
