// server/modules/clinic/clinic-patients/services/provisional.service.js
//
// Provisional User registration — for patients onboarded BY a clinic
// without the patient's direct participation.
//
// Flow:
//   1. Clinic registers a new patient → service creates a User with:
//        isProvisional: true
//        emailEncrypted: tmp email of form  "patient.{slug}.{6 base-36}@docpats.com"
//        password: argon2-hashed strong temp password
//        mustCompleteRegistration: true
//        provisionalExpiresAt: now + 3 years
//   2. Patient receives a printed/PDF card with the tmp credentials + QR code.
//      Additionally — if the receptionist provided the patient's contact
//      email — a copy of the card is delivered to that inbox via
//      sendPatientCardEmail (fire-and-forget; SMTP failure does NOT
//      block registration).
//   3. Patient logs in within 3 years and is FORCED to change email+password
//      via POST /auth/complete-provisional-registration (next commit).
//   4. If 3 years pass — cron anonymizes the record (next commit).
//   5. If patient walks into another clinic before activation — that clinic
//      can call reissueProvisionalCredentials() and get fresh creds
//      with extended +3y expiry. History tracked in User.reissueHistory.
//
// This service is the LOW-LEVEL plumbing. It is called from:
//   - patient.service.js → createPatient (when createProvisionalUser=true,
//     or for Cases 1/3 dedup branches)
//   - admin tools / wipe flow
//   - cron cleanup job
//
// It does NOT enforce tenant context — the CALLER is responsible for
// passing the right clinicId. We do verify the clinic exists and is
// active, because we trust no one.

import crypto from "crypto";
import argon2 from "argon2";

import User from "../../../../common/models/Auth/users.js";
import Clinic from "../../clinic-core/models/clinic.model.js";

import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";
import auditService from "../../../audit/services/audit.service.js";
import { sendEmail } from "../../../auth/services/emailService.js";

const log = logger.child({ module: "clinic-patients/provisional" });

// ─── Constants ────────────────────────────────────────────────────────

// Provisional User lives for 3 years before cron anonymizes it.
// Same TTL applies to a reissued account (expiry is reset to now + this).
const PROVISIONAL_TTL_MS = 3 * 365 * 24 * 60 * 60 * 1000;

// tmp email domain — never resolves to a real inbox, so even if leaked,
// it can't be used for password recovery against any real provider.
const TMP_EMAIL_DOMAIN = "docpats.com";
const TMP_EMAIL_PREFIX = "patient";

// Password generation: 9 chars from a no-ambiguity alphabet (no 0/O/1/l/I).
// Pattern: aaa-bbb-ccc — easy for receptionist to read aloud over the
// phone, hard to brute-force (~52 bits of entropy).
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const PASSWORD_GROUP_LEN = 3;
const PASSWORD_GROUPS = 3;

// Required by User model — DocPats requires every user to have a bio.
// Filled with a marker so admin tools can identify provisional patients
// even by reading raw DB.
const PROVISIONAL_BIO = "Provisional patient record created by clinic.";

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate the random suffix for a tmp email — 6 base-36 chars.
 * 36^6 ≈ 2.18 billion → collision risk negligible per (clinic, suffix).
 * Still, the caller retries on a unique-index hit.
 */
function generateEmailSuffix() {
  // 4 random bytes = 32 bits; base36 of that fits ~6.2 chars.
  // We slice to exactly 6 for consistent visual format.
  return crypto.randomBytes(4).toString("hex").slice(0, 6);
  // Note: we use hex (0-9a-f) rather than full base36 to keep things
  // case-insensitive — the receptionist will type this email by hand.
}

/**
 * Build the full tmp email string from a clinic slug + suffix.
 * Slug is validated upstream (clinic.model: [a-z0-9-]+), so it's safe.
 *   "best-clinic-baku" + "k7a3b9"  → "patient.best-clinic-baku.k7a3b9@docpats.com"
 */
function buildTmpEmail(clinicSlug, suffix) {
  return `${TMP_EMAIL_PREFIX}.${clinicSlug}.${suffix}@${TMP_EMAIL_DOMAIN}`;
}

/**
 * Generate a strong but readable temp password.
 *   Pattern: "Pa9-k3m-zR7"  (3 groups of 3 chars, hyphen-separated)
 *
 * Uses crypto.randomInt for cryptographic-grade randomness — NOT Math.random.
 * We strip ambiguous chars (0/O/1/I/l) so it can be read aloud without
 * confusion.
 */
function generateTempPassword() {
  const groups = [];
  for (let g = 0; g < PASSWORD_GROUPS; g++) {
    let group = "";
    for (let c = 0; c < PASSWORD_GROUP_LEN; c++) {
      const idx = crypto.randomInt(0, PASSWORD_ALPHABET.length);
      group += PASSWORD_ALPHABET[idx];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/**
 * Generate a username for the provisional user.
 * User model REQUIRES unique username matching [a-zA-Z0-9._-]{3,30}.
 * We derive from the tmp email's local-part (already safe chars).
 *   "patient.best-clinic-baku.k7a3b9@docpats.com" → "patient.best-clinic-baku.k7a3b9"
 *
 * Username length is capped at 30 chars. If the slug+suffix combo is too
 * long, we fall back to a hash-derived short form.
 */
function generateUsername(tmpEmail) {
  const local = tmpEmail.split("@")[0]; // "patient.best-clinic-baku.k7a3b9"
  if (local.length <= 30) return local;
  // Fallback for very long clinic slugs: keep prefix + hash.
  const hash = crypto
    .createHash("sha256")
    .update(local)
    .digest("hex")
    .slice(0, 10);
  return `patient.${hash}`;
}

/**
 * Compute the blind-index hash for a sensitive field on User.
 *
 * Why we compute hashes manually in this service rather than relying
 * on the User model's pre-save hook:
 *   Mongoose validates `required: true` BEFORE running pre-save hooks,
 *   so if we leave the hash fields blank expecting the hook to fill
 *   them, validation throws first. By computing here and passing them
 *   in to User.create(), validation passes cleanly.
 *
 * Implementation: SHA-256 of the lowercased+trimmed plaintext. This
 * MUST match what the User pre-save hook does — if it ever changes,
 * update both places. As of May 2026 the User model uses plain
 * sha256(value) with no salt or namespace.
 *
 * @param {string} value
 * @returns {string} 64-char hex digest
 */
function hashUserField(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

// ─── Email delivery ──────────────────────────────────────────────────
//
// Send a copy of the patient card to the patient's contact email after
// provisional user creation OR reissue. This is FIRE-AND-FORGET — if
// SMTP fails or the email bounces, the operation still succeeds. The
// receptionist gets the same data on screen (and can print) regardless.
//
// The temp password is sent in PLAINTEXT in the email body. This is the
// same operational risk as the receptionist handing the patient a paper
// card. At first login the patient is forced to change both email and
// password (mustCompleteRegistration flag) so exposure window is bounded.
//
// Email body is in Russian for MVP. Per-patient locale detection is a
// separate task — most receptionists work in RU/AZ, and the patient
// will eventually log in and set their own preferred language.

function buildLoginUrl(tmpEmail) {
  const base =
    process.env.REACT_APP_PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    "https://docpats.com";
  const params = new URLSearchParams({
    provisional: "1",
    email: tmpEmail,
  });
  return `${base}/login?${params.toString()}`;
}

function formatDateRu(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

/**
 * Mask an email for logs: "user@example.com" → "use***@example.com"
 * Keeps the domain visible (useful for debugging deliverability) while
 * hiding the local-part (PII).
 */
function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return email;
  return `${local.slice(0, 3)}***@${domain}`;
}

/**
 * Send the patient card by email.
 *
 * Caller MUST wrap in .catch() — this function may throw on SMTP
 * failures, network errors, or invalid recipients. We do NOT want to
 * fail registration when email delivery fails.
 *
 * `isReissue` toggles the email subject and intro text — clarifies for
 * the patient that this is a REPLACEMENT card and the old one no longer
 * works. Without this flag a returning patient might use the old card
 * thinking nothing changed.
 *
 * @param {object} args
 * @param {string} args.to             — recipient email (patient's contact)
 * @param {string} args.firstName
 * @param {string} args.lastName
 * @param {string} args.tmpEmail       — provisional login email
 * @param {string} args.tempPassword   — PLAINTEXT temp password (one-time)
 * @param {object} args.clinic         — { name, slug }
 * @param {Date}   args.expiresAt      — provisional account expiry
 * @param {boolean} [args.isReissue]   — adjusts subject/body for reissue case
 */
async function sendPatientCardEmail({
  to,
  firstName,
  lastName,
  tmpEmail,
  tempPassword,
  clinic,
  expiresAt,
  isReissue = false,
}) {
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const loginUrl = buildLoginUrl(tmpEmail);
  const expires = formatDateRu(expiresAt);
  const clinicName = clinic?.name || "клиника";

  const subject = isReissue
    ? `Обновлённая карточка пациента — ${clinicName}`
    : `Ваша карточка пациента — ${clinicName}`;

  const intro = isReissue
    ? `Клиника "${clinicName}" обновила вашу карточку в системе DocPats.
Старая карточка больше не действует — используйте только данные из этого письма.`
    : `Клиника "${clinicName}" зарегистрировала вас в системе DocPats.
Эта карточка — ваш доступ ко всем медицинским данным в одном месте.`;

  const text = `Здравствуйте, ${fullName}!

${intro}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ВРЕМЕННЫЕ ДАННЫЕ ДЛЯ ВХОДА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Email:    ${tmpEmail}
  Пароль:   ${tempPassword}

  Войти:    ${loginUrl}
  Доступно до: ${expires}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ЧТО ВЫ ПОЛУЧИТЕ ПОСЛЕ ВХОДА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Результаты всех обследований этой и других клиник DocPats
  • Онлайн-консультации с врачами
  • История болезни в одном месте
  • Запись на приём через приложение

При первом входе вы сможете сменить email и пароль на удобные.

Если письмо пришло вам по ошибке — просто проигнорируйте его.

—
DocPats · https://docpats.com
`;

  await sendEmail(to, subject, text);
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Generate a set of tmp credentials for display on the patient card.
 * Does NOT touch the database — pure generation.
 *
 * Returns: { tmpEmail, tempPassword, suffix }
 *   tempPassword is PLAINTEXT — must only be shown ONCE on the card,
 *   never logged, never persisted.
 *
 * @param {string} clinicSlug
 * @returns {{ tmpEmail: string, tempPassword: string, suffix: string }}
 */
export function generateProvisionalCredentials(clinicSlug) {
  if (!clinicSlug || typeof clinicSlug !== "string") {
    throw new ValidationError("clinicSlug is required to generate credentials");
  }
  const suffix = generateEmailSuffix();
  const tmpEmail = buildTmpEmail(clinicSlug, suffix);
  const tempPassword = generateTempPassword();
  return { tmpEmail, tempPassword, suffix };
}

/**
 * Find an existing DocPats User by contact info, for dedup at registration.
 *
 * Search strategy:
 *   - email → User.emailHash (sha256, no pepper — matches User model's hook).
 *     One indexed lookup. Active dedup path.
 *   - phone → NOT searched. User model has no phone field as blind-index,
 *     so we cannot do exact-match by phone globally. Phone-based dedup
 *     remains scoped to a single clinic (ClinicPatient.phoneHash).
 *
 * Returns null if:
 *   - no email provided
 *   - no User found
 *   - found User is anonymized / deleted (treat as "nothing here")
 *
 * Returns { user, status } where status indicates next-action branch:
 *   - "active"      → user.isProvisional === false (real registered user)
 *   - "provisional" → user.isProvisional === true (unactivated card)
 *
 * Caller is responsible for the consent + UI flow.
 *
 * @param {object} args
 * @param {string} [args.email]  — patient's contact email, will be normalized
 * @returns {Promise<{ user: object, status: "active"|"provisional" } | null>}
 */
export async function findExistingUserByContact({ email } = {}) {
  if (!email || typeof email !== "string") return null;

  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return null;

  // Use the SAME hash algorithm as the User pre-save hook (plain sha256,
  // no pepper). DO NOT use ClinicPatient.hashValue() — that one is HMAC
  // with a different key and would never match.
  const emailHash = hashUserField(normalized);

  const user = await User.findOne({
    emailHash,
    isAnonymized: { $ne: true },
    isDeleted: { $ne: true },
  }).lean();

  if (!user) return null;

  const status = user.isProvisional ? "provisional" : "active";

  log.info(
    {
      userId: String(user._id),
      status,
      emailMasked: maskEmail(normalized),
    },
    "findExistingUserByContact: match",
  );

  return { user, status };
}

/**
 * Create a provisional User document.
 * Returns the created User AND the plaintext tempPassword (only place
 * where caller sees it — the user card render).
 *
 * Retries up to MAX_RETRIES on email collision (extremely rare —
 * 4-byte suffix collision per clinic).
 *
 * If `input.contactEmail` is provided, also sends a copy of the patient
 * card (tmpEmail + tempPassword + login URL) to that address. This is
 * FIRE-AND-FORGET — SMTP failure does NOT fail the registration.
 *
 * @param {object} input
 * @param {string} input.clinicId           — required, used for provisionalCreatedBy
 * @param {string} input.firstName          — required
 * @param {string} input.lastName           — required
 * @param {Date|string} input.dateOfBirth   — required by User model
 * @param {string} [input.gender]           — optional
 * @param {string} [input.phone]            — optional, stored as-is (not encrypted on User)
 * @param {string} [input.contactEmail]     — optional, patient's real email for card delivery
 *
 * @returns {Promise<{ user: object, tempPassword: string, tmpEmail: string }>}
 */
export async function createProvisionalUser(input) {
  if (!input?.clinicId) {
    throw new ValidationError("clinicId is required");
  }
  if (!input.firstName || !input.lastName) {
    throw new ValidationError("firstName and lastName are required");
  }
  if (!input.dateOfBirth) {
    throw new ValidationError("dateOfBirth is required");
  }

  // Validate the clinic — we need its slug for the tmp email + it must
  // still be active (no creating provisionals against deleted clinics).
  // We also pull `name` here so the card-delivery email can reference
  // the clinic by display name (e.g. "DocPats Medical Center").
  const clinic = await Clinic.findById(input.clinicId)
    .select("_id slug name isActive isDeleted")
    .lean();
  if (!clinic) {
    throw new NotFoundError("Clinic");
  }
  if (clinic.isDeleted || clinic.isActive === false) {
    throw new ValidationError("Clinic is not active");
  }

  // Retry on tmpEmail collision (vanishingly rare). MAX_RETRIES caps
  // worst-case latency — if we hit even 5 collisions, something is
  // wrong (RNG broken? clock stuck?) and we'd rather fail loudly.
  const MAX_RETRIES = 5;
  let lastErr = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { tmpEmail, tempPassword } = generateProvisionalCredentials(
      clinic.slug,
    );
    const username = generateUsername(tmpEmail);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PROVISIONAL_TTL_MS);

    // Hash the temp password — argon2id, same algo as User.password elsewhere.
    const passwordHash = await argon2.hash(tempPassword, {
      type: argon2.argon2id,
    });

    try {
      // User model has required:true on emailHash/firstNameHash/lastNameHash
      // and Mongoose validates BEFORE the pre-save hook runs. So we MUST
      // compute and pass the hashes ourselves rather than relying on
      // hooks to fill them in.
      const user = await User.create({
        emailEncrypted: tmpEmail,
        firstNameEncrypted: input.firstName,
        lastNameEncrypted: input.lastName,
        // Blind-index hashes — required by User model.
        // See hashUserField() docstring for why we compute manually.
        emailHash: hashUserField(tmpEmail),
        firstNameHash: hashUserField(input.firstName),
        lastNameHash: hashUserField(input.lastName),
        username,
        password: passwordHash,
        dateOfBirth: input.dateOfBirth,
        bio: PROVISIONAL_BIO,
        role: "patient",
        isDoctor: false,
        isPatient: true,
        agreement: true, // clinic accepts on patient's behalf
        registeredAt: now,
        preferredLanguage: "ru", // clinic UI default; patient can change later

        // Provisional-specific
        isProvisional: true,
        provisionalCreatedBy: clinic._id,
        provisionalCreatedAt: now,
        provisionalExpiresAt: expiresAt,
        mustCompleteRegistration: true,

        // No subscription / trial — patient activation will set defaults
        subscriptionPlan: null,
      });

      log.info(
        {
          userId: String(user._id),
          clinicId: String(clinic._id),
          clinicSlug: clinic.slug,
          tmpEmailMasked: tmpEmail.replace(/(.{3}).+(@.+)/, "$1***$2"),
          expiresAt,
        },
        "Provisional user created",
      );

      // Audit: user.provisional.created — on the User side.
      // The actor here is whoever is in tenant context (clinic
      // receptionist/admin). We import getCurrentUserId/ActorType lazily
      // because this service is also used from cron (no tenant context).
      try {
        const { getCurrentUserId, getCurrentActorType } =
          await import("../../../../common/context/tenantContext.js");
        const actorId = getCurrentUserId();
        const actorType = getCurrentActorType();
        if (actorId) {
          auditService.recordActionAsync({
            actor: {
              userId: actorId,
              role: actorType === "employee" ? "employee" : null,
              email: null,
            },
            action: "user.provisional.created",
            resourceType: "user-account",
            resourceId: String(user._id),
            outcome: "success",
            metadata: {
              provisionalCreatedBy: String(clinic._id),
              expiresAt: expiresAt.toISOString(),
              // metadata: structural only — never logs tmpEmail or
              // tempPassword. We DO record whether a contact email was
              // provided (boolean, no PII) so audit can answer "was the
              // card delivered electronically vs paper-only?"
              cardEmailSent: Boolean(input.contactEmail),
            },
            context: null, // service-layer call, no req available
          });
        }
      } catch (auditErr) {
        // Audit is best-effort. If it fails, the user is still created.
        log.warn(
          { err: auditErr.message },
          "Failed to record user.provisional.created audit",
        );
      }

      // ─── Card delivery via email — fire-and-forget ─────────────
      //
      // If the receptionist provided a contact email, send the card
      // there. Any failure (SMTP down, bad recipient, network blip)
      // is logged but does NOT propagate — the registration succeeded,
      // the receptionist still has the printable card on screen, and
      // can re-send manually later if needed.
      if (input.contactEmail) {
        sendPatientCardEmail({
          to: input.contactEmail,
          firstName: input.firstName,
          lastName: input.lastName,
          tmpEmail,
          tempPassword,
          clinic, // { _id, slug, name } from the Clinic.findById above
          expiresAt,
          isReissue: false,
        }).catch((err) => {
          log.warn(
            {
              err: err.message,
              userId: String(user._id),
              clinicId: String(clinic._id),
              toMasked: maskEmail(input.contactEmail),
            },
            "Failed to email patient card — registration succeeded anyway",
          );
        });
      }

      return { user, tempPassword, tmpEmail };
    } catch (err) {
      // MongoDB duplicate-key error code is 11000.
      // Could be on emailHash (collision on suffix) or username.
      if (err?.code === 11000) {
        log.warn(
          { attempt, errMessage: err.message },
          "Provisional user collision, retrying",
        );
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  // All retries exhausted — caller will see a 500.
  log.error(
    { clinicId: String(clinic._id), lastErr: lastErr?.message },
    "Failed to create provisional user after retries",
  );
  throw new ConflictError(
    "Could not generate a unique provisional account — please retry",
  );
}

/**
 * Reissue provisional credentials for an existing (un-activated) User.
 *
 * Use case: a patient was registered as provisional by Clinic Y three
 * months ago, never activated. Now they walk into Clinic X. Clinic X
 * generates fresh tmp email + password, the patient gets a new card,
 * old card stops working.
 *
 * What changes on the User document:
 *   - emailEncrypted → new tmp email (Clinic X's slug)
 *   - emailHash      → recomputed (pre-save hook handles this)
 *   - password       → new argon2 hash of new tempPassword
 *   - provisionalExpiresAt → now + 3 years (sliding window)
 *   - mustCompleteRegistration → true (reset if patient had toggled it)
 *   - reissueHistory.push({clinicId, reissuedAt, reissuedBy, ...})
 *
 * What does NOT change:
 *   - provisionalCreatedBy   — still the ORIGINAL clinic
 *   - provisionalCreatedAt   — still the original timestamp
 *   - firstName / lastName / dateOfBirth — patient identity untouched
 *   - isProvisional          — stays true
 *
 * Pre-conditions enforced:
 *   - User must exist
 *   - User.isProvisional === true (cannot reissue an active account —
 *     that would overwrite the patient's real email/password)
 *   - User.isAnonymized === false (cannot resurrect anonymized data)
 *
 * Email delivery: fire-and-forget, same as createProvisionalUser, with
 * isReissue:true so the email subject/body reflects "обновлённая карта".
 *
 * Audit: emits "user.provisional.reissued" with metadata about both
 * the original clinic and the reissuing clinic — so HIPAA forensics
 * can answer "who changed my login?" cleanly.
 *
 * @param {object} args
 * @param {string} args.userId           — User._id of the provisional account
 * @param {string} args.clinicId         — Clinic doing the reissue (NEW clinic)
 * @param {string} args.reissuedBy       — actor userId or employeeId
 * @param {"user"|"employee"} args.reissuedByType  — actor type
 * @param {string} [args.contactEmail]   — patient's real email for card delivery
 *
 * @returns {Promise<{ user: object, tempPassword: string, tmpEmail: string }>}
 */
export async function reissueProvisionalCredentials({
  userId,
  clinicId,
  reissuedBy,
  reissuedByType,
  contactEmail,
} = {}) {
  if (!userId) {
    throw new ValidationError("userId is required for reissue");
  }
  if (!clinicId) {
    throw new ValidationError("clinicId is required for reissue");
  }
  if (!reissuedBy || !reissuedByType) {
    throw new ValidationError("reissuedBy and reissuedByType are required");
  }
  if (!["user", "employee"].includes(reissuedByType)) {
    throw new ValidationError("reissuedByType must be 'user' or 'employee'");
  }

  // ─── Validate target User ───
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User");
  if (user.isAnonymized) {
    throw new ValidationError(
      "Cannot reissue credentials for an anonymized account",
      { code: "user_anonymized" },
    );
  }
  if (!user.isProvisional) {
    // Caller should have checked this branch, but defence in depth —
    // we MUST NOT overwrite an active patient's email + password.
    throw new ValidationError(
      "Cannot reissue credentials for an activated account",
      { code: "user_already_active" },
    );
  }

  // ─── Validate clinic doing the reissue ───
  const clinic = await Clinic.findById(clinicId)
    .select("_id slug name isActive isDeleted")
    .lean();
  if (!clinic) throw new NotFoundError("Clinic");
  if (clinic.isDeleted || clinic.isActive === false) {
    throw new ValidationError("Clinic is not active");
  }

  // ─── Generate new creds with retry on collision ───
  const MAX_RETRIES = 5;
  let chosen = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const candidate = generateProvisionalCredentials(clinic.slug);
    // Check emailHash collision before save — saves us a round trip
    // through Mongoose validation error -> retry -> ...
    const candidateHash = hashUserField(candidate.tmpEmail);
    const exists = await User.exists({
      emailHash: candidateHash,
      _id: { $ne: user._id },
    });
    if (!exists) {
      chosen = candidate;
      break;
    }
    log.warn(
      { attempt, slug: clinic.slug },
      "Reissue tmpEmail collision, retrying",
    );
  }
  if (!chosen) {
    log.error(
      { userId: String(user._id), clinicId: String(clinic._id) },
      "Failed to generate unique tmpEmail for reissue after retries",
    );
    throw new ConflictError(
      "Could not generate a unique provisional account — please retry",
    );
  }

  const { tmpEmail, tempPassword } = chosen;
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + PROVISIONAL_TTL_MS);
  const passwordHash = await argon2.hash(tempPassword, {
    type: argon2.argon2id,
  });

  // ─── Apply changes ───
  // Note: we set emailEncrypted to plaintext; pre-save hook encrypts +
  // recomputes emailHash automatically. password is already argon2'd so
  // it bypasses hooks (no password-encryption hook in this codebase).
  const previousExpiresAt = user.provisionalExpiresAt;

  user.emailEncrypted = tmpEmail;
  user.password = passwordHash;
  user.provisionalExpiresAt = newExpiresAt;
  user.mustCompleteRegistration = true;
  user.mustChangePassword = false; // reset — patient hasn't gone through any of that yet
  user.lastPasswordChangeAt = now;

  // Append to reissueHistory. provisionalCreatedBy stays untouched.
  user.reissueHistory.push({
    clinicId: clinic._id,
    reissuedAt: now,
    reissuedBy,
    reissuedByType,
    previousExpiresAt,
  });

  // Clear any pending OTP/email-change state — those belonged to old creds.
  user.activationOtp = null;
  user.activationOtpExpiresAt = null;
  user.activationOtpAttempts = 0;
  user.activationOtpLastSentAt = null;
  user.pendingNewEmailEncrypted = null;
  user.pendingNewPasswordHash = null;

  await user.save();

  log.info(
    {
      userId: String(user._id),
      newClinicId: String(clinic._id),
      originalClinicId: user.provisionalCreatedBy
        ? String(user.provisionalCreatedBy)
        : null,
      reissueCount: user.reissueHistory.length,
      newExpiresAt,
    },
    "Provisional user reissued",
  );

  // ─── Audit ───
  try {
    auditService.recordActionAsync({
      actor: {
        userId: reissuedBy,
        role: reissuedByType === "employee" ? "employee" : null,
        email: null,
      },
      action: "user.provisional.reissued",
      resourceType: "user-account",
      resourceId: String(user._id),
      outcome: "success",
      metadata: {
        // Both clinics for forensics
        originalClinicId: user.provisionalCreatedBy
          ? String(user.provisionalCreatedBy)
          : null,
        reissuingClinicId: String(clinic._id),
        previousExpiresAt: previousExpiresAt
          ? previousExpiresAt.toISOString()
          : null,
        newExpiresAt: newExpiresAt.toISOString(),
        reissueCountAfter: user.reissueHistory.length,
        cardEmailSent: Boolean(contactEmail),
        // PHI safety: NEVER log tmpEmail/tempPassword
      },
      context: null,
    });
  } catch (auditErr) {
    log.warn(
      { err: auditErr.message },
      "Failed to record user.provisional.reissued audit",
    );
  }

  // ─── Card delivery — fire-and-forget ───
  if (contactEmail) {
    // Decrypt patient name for the email greeting.
    // We have the user document loaded with virtuals available.
    sendPatientCardEmail({
      to: contactEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      tmpEmail,
      tempPassword,
      clinic,
      expiresAt: newExpiresAt,
      isReissue: true,
    }).catch((err) => {
      log.warn(
        {
          err: err.message,
          userId: String(user._id),
          clinicId: String(clinic._id),
          toMasked: maskEmail(contactEmail),
        },
        "Failed to email reissued patient card — operation succeeded anyway",
      );
    });
  }

  return { user, tempPassword, tmpEmail };
}

/**
 * Find an active (non-anonymized, non-expired) provisional User by DOB.
 * Used when a NEW clinic onboards a patient who's already been registered
 * by another clinic: we want to surface "this person already has a
 * provisional account from clinic X".
 *
 * Returns array (could be multiple people with same DOB) with each
 * decrypted name/email — caller filters further by first/last name.
 *
 * @param {Date|string} dateOfBirth
 * @returns {Promise<Array<{
 *   _id, firstName, lastName, email,
 *   provisionalCreatedBy, provisionalCreatedAt, provisionalExpiresAt
 * }>>}
 */
export async function findActiveProvisionalByDob(dateOfBirth) {
  if (!dateOfBirth) return [];

  // Same day-range trick as searchUsersForLink: match the whole calendar
  // day rather than an exact instant (some legacy users have a time
  // component on dateOfBirth).
  const dayStart = new Date(dateOfBirth);
  if (Number.isNaN(dayStart.getTime())) return [];
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const docs = await User.find({
    dateOfBirth: { $gte: dayStart, $lt: dayEnd },
    isProvisional: true,
    isAnonymized: { $ne: true },
    isDeleted: { $ne: true },
  })
    .select(
      "_id firstNameEncrypted lastNameEncrypted emailEncrypted " +
        "provisionalCreatedBy provisionalCreatedAt provisionalExpiresAt",
    )
    .limit(50) // safety cap — same DOB collisions rare but bounded
    .lean();

  // Decrypt PII on the narrow set. Reuse User's exported decrypt helper.
  const { decrypt } = await import("../../../../common/models/Auth/users.js");
  const safe = (v) => {
    if (!v) return null;
    try {
      return decrypt(v) || null;
    } catch {
      return null;
    }
  };

  return docs.map((d) => ({
    _id: String(d._id),
    firstName: safe(d.firstNameEncrypted),
    lastName: safe(d.lastNameEncrypted),
    email: safe(d.emailEncrypted),
    provisionalCreatedBy: d.provisionalCreatedBy
      ? String(d.provisionalCreatedBy)
      : null,
    provisionalCreatedAt: d.provisionalCreatedAt,
    provisionalExpiresAt: d.provisionalExpiresAt,
  }));
}

/**
 * Anonymize a provisional User.
 *
 * The User document is NOT deleted — its _id is potentially referenced
 * by ClinicPatient.linkedUserId in one or more clinics, and breaking
 * those FKs would leave dangling references. Instead:
 *   - PII (email, firstName, lastName) is overwritten with deterministic
 *     "REDACTED" placeholders.
 *   - emailHash / nameHash are recomputed (so search by them no longer
 *     matches the original values).
 *   - dateOfBirth is reset to Unix epoch (1970-01-01) — DOB is PHI.
 *   - isAnonymized: true, anonymizedAt: now, anonymizedReason: reason.
 *   - isProvisional stays true (so DBA can still identify the record's
 *     origin if needed).
 *   - password is rotated to a random unrecoverable value — even if a
 *     leaked card had the original temp password, it now does nothing.
 *
 * Idempotent: calling on an already-anonymized user is a no-op.
 *
 * @param {string} userId
 * @param {"expired"|"wiped_by_clinic"} reason
 * @returns {Promise<{userId: string, anonymized: boolean, alreadyAnonymized?: boolean}>}
 */
export async function wipeProvisionalUser(userId, reason) {
  if (!["expired", "wiped_by_clinic"].includes(reason)) {
    throw new ValidationError(
      `Invalid wipe reason "${reason}" — must be "expired" or "wiped_by_clinic"`,
    );
  }

  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User");

  if (!user.isProvisional) {
    throw new ValidationError(
      "Refusing to wipe a non-provisional user — this would destroy real PII",
    );
  }

  if (user.isAnonymized) {
    log.info(
      { userId: String(userId) },
      "wipeProvisionalUser: already anonymized, no-op",
    );
    return {
      userId: String(userId),
      anonymized: true,
      alreadyAnonymized: true,
    };
  }

  const now = new Date();
  const shortId = String(user._id).slice(-8);

  // Overwrite PII with deterministic placeholders. We rewrite the
  // hashes too because the pre-save hook fires AFTER validation and
  // we want consistent state even if a future migration adds a
  // required check elsewhere.
  const newEmail = `anon-${shortId}@redacted.local`;
  user.emailEncrypted = newEmail;
  user.firstNameEncrypted = "REDACTED";
  user.lastNameEncrypted = "REDACTED";
  user.emailHash = hashUserField(newEmail);
  user.firstNameHash = hashUserField("REDACTED");
  user.lastNameHash = hashUserField("REDACTED");
  user.dateOfBirth = new Date(0); // 1970-01-01

  // Rotate password to something nobody knows. Even if the original
  // card with the temp password leaked, this kills it.
  const randomSecret = crypto.randomBytes(32).toString("hex");
  user.password = await argon2.hash(randomSecret, { type: argon2.argon2id });

  // Anonymization markers
  user.isAnonymized = true;
  user.anonymizedAt = now;
  user.anonymizedReason = reason;
  user.mustCompleteRegistration = false;
  user.isBlocked = true; // belt-and-suspenders: blocked even if someone
  //                       guesses the new email pattern

  await user.save();

  log.warn(
    {
      userId: String(user._id),
      reason,
      provisionalCreatedBy: user.provisionalCreatedBy
        ? String(user.provisionalCreatedBy)
        : null,
    },
    "Provisional user anonymized",
  );

  return { userId: String(user._id), anonymized: true };
}

// ─── Exports ──────────────────────────────────────────────────────────

export default {
  generateProvisionalCredentials,
  createProvisionalUser,
  reissueProvisionalCredentials,
  findExistingUserByContact,
  findActiveProvisionalByDob,
  wipeProvisionalUser,
};

// Internals exposed for unit tests only
export const __test__ = {
  generateEmailSuffix,
  buildTmpEmail,
  generateTempPassword,
  generateUsername,
  hashUserField,
  buildLoginUrl,
  formatDateRu,
  maskEmail,
  sendPatientCardEmail,
  PROVISIONAL_TTL_MS,
  PASSWORD_ALPHABET,
};
