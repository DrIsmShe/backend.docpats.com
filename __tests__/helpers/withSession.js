// __tests__/helpers/withSession.js
//
// Helper for integration tests of clinic-* endpoints.
// Builds a minimal test-only Express app with mocked session,
// without loading the full server stack from index.js.

import express from "express";
import session from "express-session";

import clinicRoutes from "../../modules/clinic/index.js";

/**
 * Build a minimal Express app for testing /api/v1/clinic/* endpoints.
 *
 * @param {object} [options]
 * @param {string} [options.userId]      If provided, every request is treated
 *                                       as that DocPats user (session.userId).
 * @param {string} [options.employeeId]  If provided, every request is treated
 *                                       as that ClinicEmployee (session.employeeId).
 * @returns {express.Application}
 */
export function createTestApp(options = {}) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use(
    session({
      secret: "test_secret_at_least_16_chars_long",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true },
    }),
  );

  // Test-only middleware: inject identity into session if provided.
  // Only one of userId/employeeId should be set; userId wins if both are passed.
  if (options.userId || options.employeeId) {
    app.use((req, res, next) => {
      if (options.userId) {
        req.session.userId = String(options.userId);
      } else if (options.employeeId) {
        req.session.employeeId = String(options.employeeId);
      }
      next();
    });
  }

  app.use("/api/v1/clinic", clinicRoutes);

  return app;
}
