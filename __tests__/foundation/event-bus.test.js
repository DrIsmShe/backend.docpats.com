import { describe, it, expect, beforeEach } from "vitest";
import { eventBus, EVENTS } from "../../common/events/eventBus.js";

// Helper: clean up listeners between tests to prevent cross-test pollution
beforeEach(() => {
  Object.values(EVENTS).forEach((evt) => eventBus.removeAllListeners(evt));
});

describe("eventBus — basic emit", () => {
  it("emit with no listeners does not throw", () => {
    expect(() =>
      eventBus.emitSafe(EVENTS.APPOINTMENT_CREATED, {}),
    ).not.toThrow();
  });

  it("listener receives payload", async () => {
    let received = null;
    eventBus.on(EVENTS.APPOINTMENT_COMPLETED, (p) => {
      received = p;
    });
    eventBus.emitSafe(EVENTS.APPOINTMENT_COMPLETED, { appointmentId: "a1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual({ appointmentId: "a1" });
  });

  it("multiple listeners all receive events", async () => {
    let counter = 0;
    eventBus.on(EVENTS.STAFF_JOINED, () => {
      counter += 1;
    });
    eventBus.on(EVENTS.STAFF_JOINED, () => {
      counter += 10;
    });
    eventBus.on(EVENTS.STAFF_JOINED, () => {
      counter += 100;
    });
    eventBus.emitSafe(EVENTS.STAFF_JOINED, {});
    await new Promise((r) => setTimeout(r, 20));
    expect(counter).toBe(111);
  });
});

describe("eventBus — error isolation", () => {
  it("listener error does not propagate to publisher", () => {
    eventBus.on(EVENTS.PAYMENT_RECEIVED, () => {
      throw new Error("Listener intentionally fails");
    });
    expect(() => eventBus.emitSafe(EVENTS.PAYMENT_RECEIVED, {})).not.toThrow();
  });

  it("one failing listener does not stop others", async () => {
    let secondRan = false;
    eventBus.on(EVENTS.INVOICE_CREATED, () => {
      throw new Error("first fails");
    });
    eventBus.on(EVENTS.INVOICE_CREATED, () => {
      secondRan = true;
    });
    eventBus.emitSafe(EVENTS.INVOICE_CREATED, {});
    await new Promise((r) => setTimeout(r, 30));
    expect(secondRan).toBe(true);
  });

  it("async listener that throws is caught", async () => {
    eventBus.on(EVENTS.LEAD_CAPTURED, async () => {
      throw new Error("async failure");
    });
    expect(() => eventBus.emitSafe(EVENTS.LEAD_CAPTURED, {})).not.toThrow();
    await new Promise((r) => setTimeout(r, 30));
  });
});

describe("EVENTS catalog", () => {
  it("contains expected canonical events", () => {
    expect(EVENTS.APPOINTMENT_CREATED).toBe("appointment.created");
    expect(EVENTS.PAYMENT_RECEIVED).toBe("payment.received");
    expect(EVENTS.STAFF_JOINED).toBe("staff.joined");
    expect(EVENTS.CLINIC_CREATED).toBe("clinic.created");
  });

  it("is frozen (cannot mutate)", () => {
    expect(() => {
      EVENTS.NEW = "new.event";
    }).toThrow();
  });
});
