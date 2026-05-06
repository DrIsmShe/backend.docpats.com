# Audit Module — HIPAA Audit Log

HIPAA-совместимый журнал доступа к PHI (Protected Health Information).
Покрывает требование **HIPAA § 164.312(b)** — Audit Controls.

## Что это и зачем

HIPAA требует журнал, который записывает каждое действие с медицинскими
данными: кто, когда, что, откуда. Это нужно для:

- Compliance-аудитов (раз в год)
- Расследования инцидентов (например, утечки данных)
- Права пациента "покажите кто видел мои данные"
- Детекции скомпрометированных аккаунтов

## Структура модуля

```
modules/audit/
├── index.js                          ← точка входа модуля
├── enums/
│   └── auditEnums.js                 ← ACTION_ENUM, RESOURCE_TYPE_ENUM, OUTCOME_ENUM
├── models/
│   └── AuditLog.model.js             ← Mongoose модель (collection: hipaa_audit_logs)
├── services/
│   └── audit.service.js              ← recordAction, recordActionAsync, queries
├── controllers/
│   └── audit.controller.js           ← REST handlers
├── routes/
│   └── audit.routes.js               ← /audit/users/... /audit/cases/...
├── middleware/
│   ├── auditMiddleware.js            ← фабрика для авто-логирования
│   └── extractActor.js               ← готовит req.actor и req.context
└── utils/
    └── errors.js                     ← ForbiddenError, ValidationError, NotFoundError
```

**Где хранится:** MongoDB collection `hipaa_audit_logs`

**Срок хранения:** 7 лет (TTL индекс, авто-удаление)

**Защита данных:** append-only — нельзя update/delete (заблокировано на
уровне модели через pre-hooks).

## Подключение модуля в проект

В главном файле сервера (`index.js` или `app.js`):

```js
import { auditRoutes } from "./modules/audit/index.js";

// Регистрация REST-эндпоинтов для compliance
app.use("/audit", auditRoutes);
```

Это даст:

- `GET /audit/users/:userId` — история действий пользователя
- `GET /audit/cases/:caseId` — история по anthropometry-case
- `GET /audit/resources/:resourceType/:resourceId` — история ресурса
- `GET /audit/resources/:resourceType/:resourceId/viewers` — кто смотрел
- `GET /audit/owners/:ownerId` — кто работал с PHI этого юзера
- `GET /audit/denied` — отказы доступа (для security)

## Использование в других модулях

### Способ 1 — Middleware (для большинства случаев)

Навешиваешь на роуты с PHI:

```js
import { auditMiddleware } from "../audit/index.js";
import authMiddleware from "../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

// Чтение диалога
router.get(
  "/dialog/:dialogId",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-dialog",
    action: "chat.dialog.read",
    resourceIdFrom: "params.dialogId",
  }),
  handler,
);

// Создание сообщения
router.post(
  "/",
  authMiddleware,
  auditMiddleware({
    resourceType: "chat-message",
    action: "chat.message.create",
    resourceIdFrom: "body.dialogId",
    metaFrom: (req) => ({ messageType: req.body.type }),
  }),
  handler,
);

// Просмотр чужого профиля — не логируем когда смотрят сами себя
router.get(
  "/profile/:userId",
  authMiddleware,
  auditMiddleware({
    resourceType: "patient-profile",
    action: "patient.profile.read",
    resourceIdFrom: "params.userId",
    resourceOwnerIdFrom: "params.userId",
    skipIf: (req) =>
      String(req.params.userId) === String(req.user._id || req.user.id),
  }),
  handler,
);
```

### Способ 2 — Прямой вызов из сервиса (для специфики)

Когда обычный middleware не подходит — например, нужно вызвать **внутри**
бизнес-логики, или обозначить специфичное действие (export/share):

```js
import { auditService } from "../audit/index.js";

// Fire-and-forget — для read/view
auditService.recordActionAsync({
  actor: { userId, email, role },
  action: "chat.message.export",
  resourceType: "chat-dialog",
  resourceId: dialogId,
  resourceOwnerId: dialogOwnerId,
  context: { ipAddress: req.ip, userAgent: req.get("user-agent") },
  metadata: { exportFormat: "pdf", messageCount: 142 },
});

// Внутри транзакции — для create/update PHI
const session = await mongoose.startSession();
session.startTransaction();
try {
  const surgicalCase = await SurgicalCase.create([{ ... }], { session });

  await auditService.recordAction({
    actor: req.actor,
    action: "surgery.case.create",
    resourceType: "surgical-case",
    resourceId: surgicalCase[0]._id,
    resourceOwnerId: surgicalCase[0].patientId,
    context: req.context,
    session,
  });

  await session.commitTransaction();
} catch (err) {
  await session.abortTransaction();
  throw err;
}
```

## Параметры middleware и service

### auditMiddleware(opts)

| Параметр              | Тип      | Обязателен | Описание                                        |
| --------------------- | -------- | ---------- | ----------------------------------------------- |
| `resourceType`        | string   | ✅         | Тип ресурса. Должен быть в `RESOURCE_TYPE_ENUM` |
| `action`              | string   | ✅         | Действие. Должно быть в `ACTION_ENUM`           |
| `resourceIdFrom`      | string   | —          | Dot-path к ID. "params.id" или "body.dialogId"  |
| `resourceOwnerIdFrom` | string   | —          | Dot-path к userId владельца                     |
| `caseIdFrom`          | string   | —          | Dot-path к caseId (для anthropometry)           |
| `skipIf`              | function | —          | (req) => bool. Если true — не логируем          |
| `metaFrom`            | function | —          | (req, res) => object. Доп. метаданные           |

### auditService.recordAction(params)

| Параметр          | Описание                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| `actor`           | `{ userId, email, role }` (required)                                               |
| `action`          | Из `ACTION_ENUM` (required)                                                        |
| `resourceType`    | Из `RESOURCE_TYPE_ENUM` (required)                                                 |
| `resourceId`      | ObjectId ресурса (required для не-list actions)                                    |
| `caseId`          | Для anthropometry — денормализованный caseId                                       |
| `resourceOwnerId` | userId владельца PHI                                                               |
| `outcome`         | `success` / `failure` / `denied` (default: success)                                |
| `failureReason`   | Текст ошибки если outcome != success                                               |
| `metadata`        | Произвольные данные БЕЗ PHI                                                        |
| `context`         | `{ ipAddress, userAgent, sessionId, requestId, httpMethod, httpPath, statusCode }` |
| `session`         | Mongoose session для транзакций                                                    |
| `impersonatedBy`  | Если действие от имени другого юзера                                               |

## Доступные actions

См. полный список в `enums/auditEnums.js`. Основные категории:

- **Общие**: `read`, `list`, `create`, `update`, `delete`, `export`, `share`
- **Auth**: `auth.login`, `auth.logout`, `auth.failed_login`
- **Chat**: `chat.dialog.read`, `chat.message.create`, `chat.message.delete`
- **Surgery**: `surgery.case.create`, `surgery.case.read`, ...
- **Simulation**: `simulation.plan.create`, ...
- **Anthropometry**: `case.create`, `study.view`, `photo.upload`, ...
- **Profiles**: `doctor.profile.read`, `patient.profile.update`

## Что НЕ нужно логировать

❌ Аутентификацию ВНУТРИ старого AuditLog (loginController) — там свой лог
❌ Translation requests — не PHI
❌ Health check эндпоинты
❌ Static-файлы (картинки, PDF)
❌ AI synthesis articles — публичный контент
❌ Чтение собственных данных (use `skipIf`)
❌ Массовые list-эндпоинты дашбордов — слишком много шума

## Что важно понимать

⚠️ **Не клади в metadata сами PHI**. Только идентификаторы и тех. детали.
Плохо: `metadata: { patientName: "Иван Иванов" }`.
Хорошо: `metadata: { patientId: "...", recordType: "lab" }`.

⚠️ **resourceOwnerId** — критически важное поле для запроса
"кто читал данные пациента X". Заполняй где можешь.

⚠️ **TTL 7 лет** — после этого срока MongoDB удалит запись автоматически.
HIPAA требует минимум 6 лет, у нас 7 для запаса.

## Тестирование локально

```bash
# Запусти сервер
npm run dev

# Сделай запрос (например, открой чат)
# Проверь что появилась запись в hipaa_audit_logs
mongo
> use DOCPATS_NEW_LOCAL
> db.hipaa_audit_logs.find().sort({createdAt:-1}).limit(5).pretty()
```

Или через CLI:

```bash
node scripts/audit-log-query.js stats
node scripts/audit-log-query.js recent 10
```

## Compliance чеклист (для аудитора HIPAA)

- ✅ Все 7 обязательных полей: who, what, when, where, result, ip, ua
- ✅ TTL 7 лет (`expireAfterSeconds: 220752000`)
- ✅ Append-only (pre-hooks блокируют update/delete)
- ✅ Snapshot ролей/email на момент действия
- ✅ Логирование отказов доступа (outcome=denied)
- ✅ Денормализация owner_id для запроса "кто видел мои данные"
- ✅ Поддержка impersonation (если admin действует от лица доктора)
- ✅ requestId для трассируемости

## Migration path

Если в будущем захочется объединить с anthropometry-аудитом:

1. Перевести anthropometry-сервис на этот общий модуль
2. Мигрировать данные: `anthropometry_audit_logs` → `hipaa_audit_logs`
3. Обновить роуты `/audit/cases/:caseId` (уже совместимы по полям)

Сейчас они работают параллельно и **не конфликтуют** — у них разные имена
моделей (`HIPAAAuditLog` vs `AnthropometryAuditLog`) и разные коллекции.
