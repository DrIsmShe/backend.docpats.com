// server/common/logger.js
//
// Structured logger for new clinic-module code.
// Uses pino for JSON output in production, pino-pretty in development.
//
// Usage:
//   import logger from "../../common/logger.js";
//   logger.info({ clinicId, userId }, "Created appointment");
//   logger.error({ err, route: "/api/v1/clinic/staff" }, "Failed to create staff");
//
// IMPORTANT: This is for NEW code. Existing console.log statements in legacy
// files (index.js, old controllers) are NOT migrated automatically.

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

const transport = isProduction
  ? undefined
  : {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
        singleLine: false,
      },
    };

const logger = pino({
  level: logLevel,
  base: {
    service: "docpats-api",
    env: process.env.NODE_ENV || "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "authorization",
      "cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.authorization",
      "*.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.SURGERY_ENCRYPTION_KEY",
      "*.ENCRYPTION_KEY",
      "*.SECRET",
    ],
    censor: "[REDACTED]",
  },
  transport,
});

export function childLogger(context) {
  return logger.child(context);
}

export default logger;
