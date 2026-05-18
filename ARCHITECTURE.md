# DocPats — Architecture Decisions

Этот документ фиксирует ключевые архитектурные решения DocPats backend. Цель — объяснить **почему** проект организован именно так, чтобы будущие изменения делались с пониманием контекста.

Документ обновляется при каждом значимом архитектурном решении. Дата последнего обновления: **18 мая 2026**.

---

## 1. Bounded Contexts

Проект разделён на несколько доменов, каждый со своими правилами шифрования, аудита и хранения данных. Это сознательный выбор — Domain-Driven Design подход.

```
DocPats Backend
├── auth                    User authentication, sessions
├── clinic/                 Multi-tenant clinic SaaS (HIPAA-critical)
│   ├── clinic-foundation     RBAC, ClinicMembership, Clinic
│   ├── clinic-appointments   Appointments, FSM, conflict detection
│   ├── clinic-patients       PHI patients, blind-index search
│   └── clinic-medical        SOAP encounters (Sprint 2, planned)
├── myClinic                Legacy single-doctor practice module
├── communication           Chat (dialogs, messages), calls, gateway
├── audit                   Canonical HIPAA audit (hipaa_audit_logs)
├── simulation              Surgical simulation (S.1-S.6)
├── surgery                 Surgical case planning
├── anthropometry           Specialized scientific module (own audit)
├── consultation            AI consultations (Claude API)
├── translation             i18n worker (BullMQ)
├── userSynthesis           AI patient summary
├── doctorsProfiles         Doctor profile management
├── patientsProfiles        Patient profile management
└── polyclinic              Legacy polyclinic records
```

Каждый модуль внутри себя **последовательный** (одна схема шифрования, один audit, один RBAC). Различия между модулями **обоснованы** — см. ниже.

---

## 2. Encryption Strategy

В проекте используются **две схемы шифрования** намеренно. Это не "ошибка которую надо унифицировать" — это **bounded contexts** с разными требованиями.

### 2.1. AES-256-CBC + `ENCRYPTION_KEY` (canonical, clinic-domain)

**Что шифруется:**

- User PHI: `firstNameEncrypted`, `lastNameEncrypted`, `emailEncrypted`, `phoneEncrypted` (legacy, не трогать)
- DoctorVerification fields
- Polyclinic models, clinicEmployee, staffInvitation
- Clinic patient PHI (`modules/clinic/clinic-patients/models/clinicPatient.model.js`)
- Clinic appointments — `reasonEncrypted`
- Chat messages — `Message.textEncrypted`

**Формат:** `iv:ciphertext` (2-part hex)

**Ключ:** `process.env.ENCRYPTION_KEY` (16 байт, padded to 32 для AES-256)

**Почему CBC, а не GCM:** Достаточно для текстового PHI. Проверка целостности данных делается на audit-уровне (`hipaa_audit_logs` записывают все изменения с outcome). Tamper detection не критичен на уровне поля, т.к. модификация записи в БД оставляет след в audit logs.

**Blind-index hashes:** Для поиска по зашифрованным полям используется HMAC через `ENCRYPTION_KEY` как pepper:

- `phoneHash`, `emailHash`, `firstNameHash`, `lastNameHash` — HMAC-SHA256
- Позволяет поиск без расшифровки записей в БД

### 2.2. AES-256-GCM + `SURGERY_ENCRYPTION_KEY` (surgery-domain)

**Что шифруется:**

- Simulation labels: `labelEncrypted`, `patientRefEncrypted` (`modules/simulation/services/encryption.service.js`)
- Surgical case plans
- `cryptoPhone` middleware (`common/middlewares/cryptoPhone.js`)

**Формат:** `iv:authTag:ciphertext` (3-part hex)

**Ключ:** `process.env.SURGERY_ENCRYPTION_KEY` (32 байта hex = 64 символа)

**Почему GCM:** Surgical data — это **планы операций**. Auth tag GCM даёт integrity check на уровне поля. Если кто-то модифицирует ciphertext в БД напрямую — расшифровка упадёт с `AuthenticationError`, операционные планы не пройдут валидацию. Это критичный fail-safe для хирургии.

### 2.3. Decision matrix

| Тип данных                            | Схема | Ключ                   | Почему                                            |
| ------------------------------------- | ----- | ---------------------- | ------------------------------------------------- |
| Текстовый PHI (имя, телефон, диагноз) | CBC   | ENCRYPTION_KEY         | Достаточно, audit покрывает integrity             |
| Хирургические планы, симуляции        | GCM   | SURGERY_ENCRYPTION_KEY | Auth tag критичен — модификация плана недопустима |
| Legacy User PHI                       | CBC   | ENCRYPTION_KEY         | Историческое решение, миграция избыточна          |

---

## 3. Audit Logging

В проекте используются **три отдельные audit-системы**. Это тоже сознательный выбор — каждая обслуживает свой контекст.

### 3.1. `hipaa_audit_logs` (canonical, основная)

**Используется:**

- `modules/clinic/*` (clinic-patients, clinic-appointments, clinic-foundation)
- `modules/myClinic/*` — все scan-контроллеры (17 файлов)
- `modules/auth/*` (loginController)
- `modules/communication/*` (chat: dialog.join, message.create, message.delete, message.react)

**Сервис:** `recordActionAsync()` из `modules/audit/index.js`

**Коллекция:** `hipaa_audit_logs`

**Retention:** 7 лет TTL (HIPAA § 164.530(j) requirement)

**Структура записи:** Append-only, 8 composite indexes (userId+timestamp, resourceType+resourceId+timestamp, outcome+timestamp, action+timestamp и т.д.)

**Что хранится:**

- `userId`, `actorRole`, `actorEmail` (опционально), `sessionId`
- `action` (enum из `auditEnums.js`: `examination.create`, `chat.message.create` и т.д.)
- `resourceType` (enum: `examination`, `clinic-patient`, `chat-dialog` и т.д.)
- `resourceId`, `resourceOwnerId`
- `outcome`: `success` | `denied` | `failure`
- `failureReason` (для `denied`/`failure`)
- `metadata` (structural data — без PHI!)
- `context`: `ipAddress`, `userAgent`

**Critical rule — НЕТ PHI в metadata:** Никогда не записывать `firstName`, `lastName`, `phone`, `email`, `notes`, `text` сообщения. Только структурные данные — field names, counts, type flags, low-sensitivity demographics (gender, etc.).

### 3.2. `anthropometry_audit_logs` (специализированная)

**Используется:** `modules/anthropometry/*` only

**Сервис:** `modules/anthropometry/services/audit.service.js` (свой)

**Коллекция:** `anthropometry_audit_logs`

**Почему отдельная:** Anthropometry — научный модуль со специализированными actions которые не вписываются в общий enum:

- `case.create`, `case.archive`
- `study.calibrate`, `study.recalibrate`
- `annotation.create_version`, `annotation.compare`
- `photo.upload`, `photo.delete`

Эти actions не имеют смысла за пределами anthropometry, и смешивать их в общий enum ухудшит читаемость для security-аналитика, который работает с HIPAA audit.

### 3.3. DoctorVerification AuditLog

**Используется:** Doctor verification flow only

**Файл:** `common/models/DoctorVerification/AuditLog.js`

**Почему отдельная:** Verification flow имеет специфические события (document submitted, verification approved/denied, jurisdiction code assigned) которые не пересекаются с медицинским audit.

### 3.4. Decision matrix

| Что логируется                                 | Куда                          | Почему                                       |
| ---------------------------------------------- | ----------------------------- | -------------------------------------------- |
| Доступ к PHI пациентов клиники                 | `hipaa_audit_logs`            | HIPAA compliance, единая точка для аудиторов |
| Создание/просмотр исследований (CT, MRI, etc.) | `hipaa_audit_logs`            | PHI access, HIPAA scope                      |
| Chat сообщения (создание, удаление, реакции)   | `hipaa_audit_logs`            | Может содержать PHI                          |
| Auth события (login, password change)          | `hipaa_audit_logs`            | Required by HIPAA § 164.312(b)               |
| Antropometric photo measurements, calibrations | `anthropometry_audit_logs`    | Специализированные actions                   |
| Doctor identity verification events            | `DoctorVerification.AuditLog` | Не пересекается с PHI                        |

---

## 4. Multi-Tenancy (Clinic Module)

### 4.1. `tenantScoped` plugin

Все модели в `modules/clinic/*` используют `tenantScoped` plugin (`common/plugins/tenantScoped.js`), который:

- Добавляет обязательное поле `clinicId: ObjectId`
- Создаёт индекс на `clinicId` + ключевые поля
- Расширяет query helpers — `findByTenant(clinicId)`, `findOneByTenant(clinicId, query)`
- **Не предотвращает cross-tenant queries автоматически** — это ответственность service layer

### 4.2. Cross-tenant isolation в service layer

Каждый сервис в clinic-домене обязан фильтровать по `clinicId` явно. Тесты содержат assertions:

```javascript
test("cross-tenant isolation: findById from another clinic returns null", async () => {
  const patient = await clinicPatientService.create({ clinicId: clinicA._id, ... });
  const result = await clinicPatientService.findById(patient._id, { clinicId: clinicB._id });
  expect(result).toBeNull();
});
```

### 4.3. Variant A vs Variant B (planned vs current)

**Variant B (current):** Path-based isolation — `/api/v1/clinic/:slug/*`. Один session cookie. В runtime определяется `req.clinicId` через middleware на основе slug + ClinicMembership.

**Variant A (planned, 2-4 weeks out):** Subdomain isolation — `clinic.docpats.com`. Две отдельных session cookies (user session + employee session). Полная изоляция на уровне cookie domain.

Решение о переходе: после первых платящих клиентов, когда станет ясна реальная нагрузка и UX feedback.

---

## 5. RBAC (Role-Based Access Control)

### 5.1. Структура

**Roles:** 9 ролей в clinic-домене:

- `clinic_owner`, `clinic_admin`, `clinic_manager`
- `doctor`, `nurse`, `receptionist`
- `lab_technician`, `radiologist`, `pharmacist`

**Resources:** 31 ресурс (clinic, clinic-patient, appointment, prescription, billing, schedule, etc.)

**Actions:** Каждый ресурс имеет actions: `create`, `read`, `list`, `update`, `delete`, `export`, специализированные (`examination.create` и т.д.)

### 5.2. Permission check pattern

```javascript
// В контроллере:
await requirePermission(req, "clinic-patient", "create");

// requirePermission:
// 1. Resolves clinicId from req.params.clinicSlug
// 2. Loads ClinicMembership for req.session.userId in this clinic
// 3. Checks if membership.role has permission for {resource, action}
// 4. Throws ForbiddenError if denied + records audit denied event
```

### 5.3. Permission matrix location

`modules/clinic/clinic-foundation/rbac/permissions.js` — single source of truth для всех permissions.

---

## 6. Session & Authentication

### 6.1. Stack

- `express-session` + `connect-mongo` store
- Session collection: `sessions` (MongoDB, autoRemove: "native", TTL 14 days)
- Touch interval: 24h (то есть session не туч itself чаще раза в день — снижение нагрузки на БД)
- Argon2 для password hashing

### 6.2. Cookie configuration

```javascript
// index.js
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1); // nginx reverse proxy
}

const cookieConfig = {
  httpOnly: true,
  maxAge: 14 * 24 * 60 * 60 * 1000,
  secure: isProduction, // true в проде — only HTTPS
  sameSite: isProduction ? "none" : "lax", // none — cross-origin (Netlify → VPS)
};
```

### 6.3. WebSocket session sharing

Session middleware применяется к Socket.IO namespace `/communication`:

```javascript
nsp.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});
```

Это позволяет `socket.request.session.userId` использоваться в gateway так же как `req.session.userId` в HTTP routes. Единый сессионный store обеспечивает консистентность между HTTP и WS.

---

## 7. Rate Limiting

### 7.1. HTTP layer

`express-rate-limit` на критичных endpoints:

- `/api/communication/messages` POST — 30/min per IP
- `/update-email-doctor` — отдельный strict limiter (emailLimiter)
- `/api/auth/login` — login attempts protection

### 7.2. WebSocket layer

`common/utils/socketRateLimit.js` — собственный реализация per-event лимитеров:

- **Per-event store:** отдельный счётчик для `message:send`, `message:react`, `typing:start`, `dialog:join`
- **Progressive penalties:** 60s → 5min → 15min → 1h (escalation при повторных нарушениях)
- **Sliding window:** фильтрация устаревших timestamps
- **Memory hygiene:** cleanup interval 5 мин для записей неактивных >30 мин

### 7.3. Почему две системы

HTTP rate limit защищает REST endpoints. WebSocket rate limit защищает socket events напрямую — без него клиент мог бы обходить HTTP лимит через `socket.emit("message:send")`. Дублирование намеренное.

---

## 8. Tech Stack

### 8.1. Backend

- **Runtime:** Node.js (ESM modules)
- **Framework:** Express + Socket.IO
- **DB:** MongoDB Atlas (Mongoose ODM)
- **Queue:** BullMQ + Redis (translation worker, simulation worker)
- **Process manager:** PM2 на VPS Ubuntu (89.167.90.78)
- **Reverse proxy:** nginx 1.24.0 + Let's Encrypt SSL

### 8.2. Storage

- **MongoDB Atlas:** main DB (DOCPATS_NEW)
- **Cloudflare R2:** media files (bucket `docpats-media`, CDN `media.docpats.com`)
- **Redis:** BullMQ queues, no persistent data

### 8.3. External services

- **Anthropic API:** AI consultations, article synthesis, translation
- **Brevo:** transactional email
- **LemonSqueezy:** payments (Merchant of Record, planned integration)

### 8.4. Testing

- **vitest** + **mongodb-memory-server**
- 359/359 tests passing
- Cross-tenant isolation assertions в clinic тестах
- Pre-save hooks bypassed in unit tests (manual hash computation in helpers)

---

## 9. Critical Conventions

### 9.1. PHI safety in audit

**НИКОГДА** не записывать decrypted PHI в `metadata` audit log. Только структурные данные:

- ✅ `fieldName: "firstNameEncrypted"`, `wasChanged: true`
- ✅ `attachmentsCount: 2`, `textLength: 45`
- ❌ `firstName: "Иван"`, `text: "boli v zhivote"`

### 9.2. Mongoose model loading safety

Все модели обёрнуты в:

```javascript
mongoose.models.X || mongoose.model("X", schema);
```

Это предотвращает `OverwriteModelError` при повторных импортах в test environment.

### 9.3. Fire-and-forget audit

`recordActionAsync()` не блокирует ответ пользователю — нет `await`. Failure audit ловится внутри сервиса и пишет separate error log.

### 9.4. enrichWithCreatedByName pattern

На всех write-эндпойнтах где actor отличается от creator (link/unlink), используется `enrichWithCreatedByName()` для аугментации response. Иначе на frontend будет видна "стороннее" имя.

### 9.5. ESM import safety

`import { foo }` требует `export function foo`, не `export default`. Иначе SyntaxError при загрузке — сервер падает целиком (не graceful).

### 9.6. PM2 deployment

После `git pull`:

- Если меняется код — `pm2 restart all`
- Если меняется `.env` — `pm2 restart all --update-env` (обязательно!)
- Если PM2 кэширует старый код — `pm2 delete + pm2 start index.js --name X + pm2 save`

---

## 10. Sprint History

| Sprint                           | Status     | Что сделано                                                                                          |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| Sprint 0 — Clinic Foundation     | ✅         | Multi-tenancy, RBAC, Clinic + ClinicMembership models, 4 pricing tiers                               |
| Sprint 1 — Appointments          | ✅         | CRUD + FSM, PHI encryption, conflict detection, ClinicCalendarPage                                   |
| Clinic Patients module           | ✅         | PHI AES-256-GCM (later CBC after Sprint Cleanup), blind-index HMAC                                   |
| Surgical Simulation S.1-S.6      | ✅         | MVP — backend, R2, frontend editor                                                                   |
| HIPAA Message Encryption         | ✅         | AES-256-GCM (later CBC), § 164.312(a)(2)(iv)                                                         |
| HIPAA Audit Log                  | ✅         | hipaa_audit_logs, 7y TTL, 8 indexes, § 164.312(b)                                                    |
| Trial system                     | ✅         | Doctor/patient trial banners, daily cron, 5-locale emails                                            |
| Sprint Cleanup (May 17-18, 2026) | ✅         | Unified clinic-domain to CBC+ENCRYPTION_KEY, unified audit to hipaa_audit_logs across 18 controllers |
| Sprint 2 — clinic-medical        | 📋 Planned | SOAP encounters, "Start appointment" UI, 4-field form                                                |
| S.7 — Automated landmarks        | 📋 Planned | MediaPipe 468 points, symmetry mirror, measurements                                                  |
| Clinic Architecture Variant A    | 📋 Planned | Subdomain isolation `clinic.docpats.com`                                                             |
| LemonSqueezy integration         | 📋 Planned | Payment flow, MoR, 5%+$0.50 commission                                                               |

---

## 11. What's NOT Unified (And Why)

Это **не** недостатки — это **bounded contexts**:

1. **Surgery остался на GCM** — auth tag критичен для integrity хирургических планов. Не унифицировать.
2. **cryptoPhone middleware на GCM** — используется в Simulation/Surgery, шифрует телефоны участников хирургических симуляций. Часть surgery-домена.
3. **Anthropometry имеет свой audit** — specialized actions не вписываются в общий enum.
4. **DoctorVerification имеет свой AuditLog** — verification-specific events.
5. **myClinic legacy controllers** — старый single-doctor practice модуль. Не унифицирован с новым clinic-доменом потому что:
   - Используется реальными врачами в production
   - Миграция данных — отдельный проект (Sprint в будущем)
   - Audit уже unified (через `recordActionAsync` после Sprint Cleanup)

---

## 12. Production Operations

### 12.1. Deployment

```bash
ssh docpats@89.167.90.78
cd ~/app/backend.docpats.com
~/deploy.sh   # git pull + pm2 restart all
```

### 12.2. Environment

- VPS: Ubuntu, IP 89.167.90.78
- Backend: `https://backend.docpats.com` (nginx → localhost:11000)
- Frontend: Netlify, auto-deploy on push
- DNS: Cloudflare

### 12.3. Monitoring

- PM2 logs: `pm2 logs docpats-backend`
- HTTP healthcheck: `GET /healthz` → MongoDB state
- No external monitoring сейчас (Sentry/DataDog — planned)

### 12.4. Backups

- MongoDB Atlas: automatic backups (cluster setting)
- R2 media: bucket versioning (нужно проверить enabled)
- Code: GitHub `DrIsmShe/backend.docpats.com`

---

## 13. Future Considerations

Документировано для будущих decisions:

- **Когда понадобится Variant A (subdomain isolation):** После 5-10 платящих клиник или явного UX feedback о confusion между ролями (doctor account vs clinic employee account).
- **Когда мигрировать User PHI на GCM:** Только если HIPAA-аудитор потребует. Иначе текущий CBC достаточен.
- **Когда вводить отдельную audit для polyclinic:** Если объём polyclinic data превысит clinic — стоит вынести в отдельную коллекцию для производительности queries.
- **Когда внедрять structured logging (Pino/Winston):** Когда понадобится централизованный лог-аналитик (Loki, ELK). Сейчас `console.log` достаточен для PM2-based ops.

---

_Этот документ — живой. При значимых архитектурных изменениях — обновляй соответствующий раздел и пиши дату._
