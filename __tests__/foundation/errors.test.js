import { describe, it, expect } from "vitest";
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  TenantViolationError,
  NotFoundError,
  ConflictError,
  FeatureNotEnabledError,
  UnprocessableError,
  RateLimitError,
  ServiceUnavailableError,
  toErrorResponse,
} from "../../common/utils/errors.js";

describe("error classes — base AppError", () => {
  it("sets default status 500 and code", () => {
    const e = new AppError("oops");
    expect(e.status).toBe(500);
    expect(e.code).toBe("INTERNAL_ERROR");
    expect(e.isOperational).toBe(true);
  });

  it("sets custom status, code, details", () => {
    const e = new AppError("custom", 418, "TEAPOT", { teapot: true });
    expect(e.status).toBe(418);
    expect(e.code).toBe("TEAPOT");
    expect(e.details).toEqual({ teapot: true });
  });

  it("captures stack trace", () => {
    const e = new AppError("with stack");
    expect(e.stack).toContain("AppError");
  });
});

describe("error classes — specific subclasses", () => {
  it("ValidationError → 400 + VALIDATION_ERROR", () => {
    const e = new ValidationError("bad email", { field: "email" });
    expect(e.status).toBe(400);
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.details).toEqual({ field: "email" });
  });

  it("UnauthorizedError → 401", () => {
    expect(new UnauthorizedError().status).toBe(401);
  });

  it("ForbiddenError → 403", () => {
    expect(new ForbiddenError().status).toBe(403);
  });

  it("TenantViolationError → 403 + TENANT_VIOLATION", () => {
    const e = new TenantViolationError();
    expect(e.status).toBe(403);
    expect(e.code).toBe("TENANT_VIOLATION");
  });

  it("NotFoundError → 404", () => {
    const e = new NotFoundError("Patient");
    expect(e.status).toBe(404);
    expect(e.message).toBe("Patient not found");
    expect(e.details).toEqual({ resource: "Patient" });
  });

  it("ConflictError → 409", () => {
    expect(new ConflictError().status).toBe(409);
  });

  it("FeatureNotEnabledError → 403 + FEATURE_NOT_ENABLED", () => {
    const e = new FeatureNotEnabledError("pharmacy");
    expect(e.status).toBe(403);
    expect(e.code).toBe("FEATURE_NOT_ENABLED");
    expect(e.details).toEqual({ feature: "pharmacy" });
  });

  it("UnprocessableError → 422", () => {
    expect(new UnprocessableError().status).toBe(422);
  });

  it("RateLimitError → 429", () => {
    const e = new RateLimitError(60);
    expect(e.status).toBe(429);
    expect(e.retryAfter).toBe(60);
  });

  it("ServiceUnavailableError → 503", () => {
    expect(new ServiceUnavailableError().status).toBe(503);
  });
});

describe("toErrorResponse", () => {
  it("formats AppError correctly", () => {
    const e = new ValidationError("bad email", { field: "email" });
    const resp = toErrorResponse(e);
    expect(resp.status).toBe(400);
    expect(resp.body.code).toBe("VALIDATION_ERROR");
    expect(resp.body.details).toEqual({ field: "email" });
  });

  it("includes retryAfter from RateLimitError", () => {
    const e = new RateLimitError(60);
    const resp = toErrorResponse(e);
    expect(resp.body.retryAfter).toBe(60);
  });

  it("converts Mongoose ValidationError shape", () => {
    const fake = {
      name: "ValidationError",
      errors: {
        email: { message: "Email is required" },
        age: { message: "Age must be positive" },
      },
    };
    const resp = toErrorResponse(fake);
    expect(resp.status).toBe(400);
    expect(resp.body.code).toBe("VALIDATION_ERROR");
    expect(resp.body.details).toEqual({
      email: "Email is required",
      age: "Age must be positive",
    });
  });

  it("converts Mongoose CastError", () => {
    const fake = { name: "CastError", path: "id", value: "abc" };
    const resp = toErrorResponse(fake);
    expect(resp.status).toBe(400);
    expect(resp.body.error).toContain("Invalid id: abc");
  });

  it("converts Mongo duplicate key (11000)", () => {
    const fake = {
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: "test@test.com" },
    };
    const resp = toErrorResponse(fake);
    expect(resp.status).toBe(409);
    expect(resp.body.code).toBe("CONFLICT");
    expect(resp.body.details.keyValue.email).toBe("test@test.com");
  });

  it("falls back to generic 500 for unknown errors", () => {
    const resp = toErrorResponse(new Error("random"));
    expect(resp.status).toBe(500);
    expect(resp.body.code).toBe("INTERNAL_ERROR");
  });
});
