// server/__tests__/video/jitsiToken.service.test.js
//
// Tests for the Jitsi room-access token minter. No DB, no network — pure
// function behaviour. We set/restore env around the cases that depend on it.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";

import {
  mintRoomToken,
  isJitsiConfigured,
} from "../../common/video/jitsiToken.service.js";

const SECRET = "test-secret-do-not-use-in-prod";

describe("jitsiToken.service", () => {
  let prevSecret;
  let prevDomain;
  let prevAppId;

  beforeEach(() => {
    prevSecret = process.env.JITSI_APP_SECRET;
    prevDomain = process.env.JITSI_DOMAIN;
    prevAppId = process.env.JITSI_APP_ID;
    process.env.JITSI_APP_SECRET = SECRET;
    process.env.JITSI_DOMAIN = "localhost:8443";
    process.env.JITSI_APP_ID = "docpats";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.JITSI_APP_SECRET;
    else process.env.JITSI_APP_SECRET = prevSecret;
    if (prevDomain === undefined) delete process.env.JITSI_DOMAIN;
    else process.env.JITSI_DOMAIN = prevDomain;
    if (prevAppId === undefined) delete process.env.JITSI_APP_ID;
    else process.env.JITSI_APP_ID = prevAppId;
  });

  describe("basics", () => {
    it("mints a verifiable token with the right claims", () => {
      const { token, domain, room } = mintRoomToken({
        room: "dialog-abc123",
        userId: "u1",
        displayName: "Dr. Ismayil",
        moderator: true,
      });

      expect(domain).toBe("localhost:8443");
      expect(room).toBe("dialog-abc123");

      const decoded = jwt.verify(token, SECRET, { algorithms: ["HS256"] });
      expect(decoded.iss).toBe("docpats");
      expect(decoded.aud).toBe("jitsi");
      expect(decoded.sub).toBe("localhost"); // port stripped
      expect(decoded.room).toBe("dialog-abc123");
      expect(decoded.context.user.id).toBe("u1");
      expect(decoded.context.user.name).toBe("Dr. Ismayil");
      expect(decoded.context.user.moderator).toBe("true");
    });

    it("defaults moderator to false", () => {
      const { token } = mintRoomToken({ room: "r1", userId: "u2" });
      const decoded = jwt.verify(token, SECRET);
      expect(decoded.context.user.moderator).toBe("false");
    });

    it("sets exp ~2h in the future", () => {
      const before = Math.floor(Date.now() / 1000);
      const { token, exp } = mintRoomToken({ room: "r1", userId: "u3" });
      const decoded = jwt.verify(token, SECRET);
      expect(decoded.exp).toBe(exp);
      // between ~1h59m and 2h01m from now
      expect(exp).toBeGreaterThan(before + 7000);
      expect(exp).toBeLessThan(before + 7400);
    });

    it("token signed with a different secret fails verification", () => {
      const { token } = mintRoomToken({ room: "r1", userId: "u4" });
      expect(() => jwt.verify(token, "wrong-secret")).toThrow();
    });
  });

  describe("errors / config", () => {
    it("throws when room is missing", () => {
      expect(() => mintRoomToken({ userId: "u1" })).toThrow(/room is required/);
    });

    it("throws when JITSI_APP_SECRET is not set", () => {
      delete process.env.JITSI_APP_SECRET;
      expect(() => mintRoomToken({ room: "r1", userId: "u1" })).toThrow(
        /not configured/,
      );
    });

    it("isJitsiConfigured reflects env", () => {
      expect(isJitsiConfigured()).toBe(true);
      delete process.env.JITSI_APP_SECRET;
      expect(isJitsiConfigured()).toBe(false);
    });
  });
});
