import { describe, it, expect, beforeAll } from "vitest";
import {
  createSignedToken,
  verifySignedToken,
} from "../../common/utils/signedUrl.js";

beforeAll(() => {
  // Ensure SECRET is set for tests (CI workflow provides this)
  if (!process.env.SECRET && !process.env.SIGNED_URL_SECRET) {
    process.env.SECRET = "test_secret_at_least_16_chars_long";
  }
});

describe("signedUrl — create + verify", () => {
  it("round-trip with payload", () => {
    const token = createSignedToken(
      { resourceId: "abc123", type: "lab_result" },
      "1h",
    );
    const decoded = verifySignedToken(token);
    expect(decoded.resourceId).toBe("abc123");
    expect(decoded.type).toBe("lab_result");
    expect(decoded.iat).toBeTypeOf("number");
    expect(decoded.exp).toBeTypeOf("number");
  });

  it("rejects payload that is not an object", () => {
    expect(() => createSignedToken("not-an-object", "1h")).toThrow();
    expect(() => createSignedToken(null, "1h")).toThrow();
  });

  it("supports TTL formats: s, m, h, d", () => {
    expect(verifySignedToken(createSignedToken({ x: 1 }, "30s"))).toBeDefined();
    expect(verifySignedToken(createSignedToken({ x: 1 }, "5m"))).toBeDefined();
    expect(verifySignedToken(createSignedToken({ x: 1 }, "2h"))).toBeDefined();
    expect(verifySignedToken(createSignedToken({ x: 1 }, "7d"))).toBeDefined();
  });

  it("supports numeric TTL (seconds)", () => {
    const token = createSignedToken({ x: 1 }, 3600);
    const decoded = verifySignedToken(token);
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it("rejects invalid TTL format", () => {
    expect(() => createSignedToken({ x: 1 }, "1week")).toThrow(/TTL/);
  });
});

describe("signedUrl — security", () => {
  it("rejects tampered token (signature mismatch)", () => {
    const token = createSignedToken({ x: 1 }, "1h");
    const tampered = token.slice(0, -3) + "AAA";
    expect(() => verifySignedToken(tampered)).toThrow();
    try {
      verifySignedToken(tampered);
    } catch (e) {
      expect(e.code).toBe("INVALID_SIGNATURE");
    }
  });

  it("rejects malformed token", () => {
    expect(() => verifySignedToken("not.a.valid.token")).toThrow();
    expect(() => verifySignedToken("nodot")).toThrow();
    expect(() => verifySignedToken("")).toThrow();
  });

  it("rejects expired token", async () => {
    const shortToken = createSignedToken({ x: 1 }, 1);
    await new Promise((r) => setTimeout(r, 2100));
    expect(() => verifySignedToken(shortToken)).toThrow();
    try {
      verifySignedToken(shortToken);
    } catch (e) {
      expect(e.code).toBe("TOKEN_EXPIRED");
    }
  });

  it("rejects token with modified payload", () => {
    const token = createSignedToken({ resourceId: "original" }, "1h");
    const [payload, sig] = token.split(".");
    // Decode, modify, re-encode payload — but signature stays old
    const modifiedPayload = Buffer.from(
      JSON.stringify({ resourceId: "hacked", iat: 0, exp: 9999999999 }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const fakeToken = `${modifiedPayload}.${sig}`;
    expect(() => verifySignedToken(fakeToken)).toThrow();
  });
});
