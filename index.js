// ======================= IMPORTS =======================
import "./modules/translation/translation.worker.js";
import "./modules/surgery/simulation.worker.js";
import express from "express";

import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import xss from "xss-clean";
import session from "express-session";
import cookieParser from "cookie-parser";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";

import connectDB from "./common/config/db/mongodb.js";
import routes from "./common/routes/index.js";
import uploadRoutes from "./common/routes/uploadRoutes.js";
import uploadFileRoutes from "./common/routes/uploadFileRoutes.js";
import emailLimiter from "./common/middlewares/rateLimiter.js";

import User, { decrypt as decryptUser } from "./common/models/Auth/users.js";
import NewPatientPolyclinic from "./common/models/PatientProfile/patientProfile.js";
import "./common/models/Comments/CommentDocpats.js";
import consultationRoutes from "./modules/consultation/consultation.routes.js";
import { initializeSpecializations } from "./common/utils/initSpecializations.js";
import cron from "node-cron";
import { cleanupOldNotifications } from "./jobs/cleanupOldNotifications.js";
import { initCommunicationGateway } from "./modules/communication/gateway/socket.gateway.js";
// ✅ ИСПРАВЛЕНО: импорт на верхнем уровне, НЕ внутри функции
import { initCallGateway } from "./modules/communication/calls/call.gateway.js";

import sitemapRoutes from "./common/sitemap/routes/sitemap.routes.js";
import { setSimulationIo } from "./modules/surgery/simulationIo.js";
import "./jobs/prefetch.job.js";
import userSynthesisRoutes from "./modules/userSynthesis/userSynthesis.routes.js";
// ======================= PATHS =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================= ENV =======================
dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 11000);

// ======================= MONGOOSE CONFIG =======================
mongoose.set("strictQuery", true);
mongoose.set("bufferCommands", false);
mongoose.set("bufferTimeoutMS", 0);

// ======================= CORS =======================
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:11000",
  "https://docpats.com",
  "https://www.docpats.com",
  "https://frontend-docpats.netlify.app",
];

function checkOrigin(origin, cb) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    cb(null, true);
  } else {
    cb(new Error(`Origin ${origin} not allowed`));
  }
}
app.use("/", sitemapRoutes);
app.use(cors({ origin: checkOrigin, credentials: true }));
app.options("*", cors({ origin: checkOrigin, credentials: true }));

// ======================= SECURITY MIDDLEWARES =======================
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(xss());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ======================= SESSION =======================
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL;

if (!MONGODB_URI) {
  console.error("❌ Mongo URI не задан");
  process.exit(1);
}

if (!process.env.SECRET) {
  console.error("❌ SESSION_SECRET не задан в .env");
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === "production";
console.log(
  "🌍 NODE_ENV =",
  process.env.NODE_ENV,
  "| isProduction =",
  isProduction,
);

if (isProduction) {
  app.set("trust proxy", 1);
}

const cookieConfig = {
  httpOnly: true,
  maxAge: 14 * 24 * 60 * 60 * 1000,
};

if (isProduction) {
  cookieConfig.secure = true;
  cookieConfig.sameSite = "none";
} else {
  cookieConfig.secure = false;
  cookieConfig.sameSite = "lax";
}

const sessionMiddleware = session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGODB_URI,
    dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
    collectionName: "sessions",
    autoRemove: "native",
    ttl: 14 * 24 * 60 * 60,
    touchAfter: 24 * 3600,
  }),
  cookie: cookieConfig,
});

app.use(sessionMiddleware);

// ✅ ИСПРАВЛЕНО: consultation routes теперь после sessionMiddleware,
// чтобы req.session был доступен в контроллерах
app.use("/api/consultation", consultationRoutes);

process.on("unhandledRejection", (err) => {
  if (err?.message?.includes("Unable to find the session to touch")) {
    console.warn("⚠️ Сессия недоступна (просрочена или удалена). Игнорируем.");
  } else {
    console.error("❌ Unhandled Rejection:", err);
  }
});

// ======================= DEV LOGGING =======================
if (!isProduction) {
  app.use((req, res, next) => {
    console.log("Incoming:", req.method, req.url);
    next();
  });
}

// ======================= STATIC FILES =======================
const uploadsPath = path.join(__dirname, "uploads");
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  },
  express.static(uploadsPath),
);
app.use(express.static(path.join(__dirname, "public")));

// ======================= HEALTHCHECK =======================
app.get("/healthz", (req, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json({
    ok: mongoose.connection.readyState === 1,
    state: states[mongoose.connection.readyState] || "unknown",
  });
});

// ======================= DB GUARD =======================
app.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "База данных недоступна" });
  }
  next();
});

// ======================= COMMON AUTH =======================
app.get("/common-for-user", async (req, res) => {
  try {
    const rawId = req.session?.userId;
    if (!rawId) return res.status(200).json({ authenticated: false });

    const user = await User.findById(rawId);
    if (!user) {
      req.session.destroy?.(() => {});
      return res.status(200).json({ authenticated: false });
    }

    let firstName, lastName, email;
    try {
      if (typeof user.decryptFields === "function") {
        const d = user.decryptFields();
        firstName = d?.firstName;
        lastName = d?.lastName;
        email = d?.email;
      } else {
        firstName = decryptUser(user.firstNameEncrypted);
        lastName = decryptUser(user.lastNameEncrypted);
        email = decryptUser(user.emailEncrypted);
      }
    } catch {}

    let patientPolyclinicId = null;
    if (user.role === "patient") {
      const clinicDoc = await NewPatientPolyclinic.findOne({
        linkedUserId: user._id,
      });
      if (clinicDoc) patientPolyclinicId = String(clinicDoc._id);
    }

    res.json({
      authenticated: true,
      user: {
        _id: String(user._id),
        userId: String(user._id),
        patientPolyclinicId,
        role: user.role,
        username: user.username,
        email,
        firstName,
        lastName,
        preferredLanguage: user.preferredLanguage ?? "ru",
        country: user.country ?? "",
        dateOfBirth: user.dateOfBirth ?? null,
        bio: user.bio ?? "",
        avatar: user.avatar ?? null,
        isDoctor: !!user.isDoctor,
        isPatient: !!user.isPatient,
        isBlocked: !!user.isBlocked,
        verification: user.verification || {
          level: "unverified",
          status: "none",
          verifiedAt: null,
          jurisdictionCode: null,
        },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    console.error("❌ /common-for-user error:", err);
    res.status(200).json({ authenticated: false });
  }
});
app.use("/api/user-synthesis", userSynthesisRoutes);
// ======================= ROUTES =======================
app.use("/api", uploadFileRoutes);
app.use(uploadRoutes);
app.use(routes);
app.use("/update-email-doctor", emailLimiter);

// ======================= AUTO MODEL LOADER =======================
console.log("📦 [index.js] Загрузка моделей...");
await import("./common/models/index.js")
  .then(() => console.log("✅ [index.js] Модели успешно загружены"))
  .catch((err) => console.error("❌ [index.js] Ошибка загрузки моделей:", err));

// ======================= CRON CLEANUP =======================
let isCleaning = false;
cron.schedule("0 3 * * *", async () => {
  if (isCleaning) return;
  isCleaning = true;
  try {
    console.log("🕒 Запуск очистки старых уведомлений...");
    await cleanupOldNotifications();
  } catch (err) {
    console.error("❌ Ошибка очистки (cron):", err);
  } finally {
    isCleaning = false;
  }
});
console.log("⏳ Планировщик очистки уведомлений активен");

// ======================= BOOTSTRAP =======================
async function bootstrap(startPort = PORT) {
  try {
    await connectDB();
    console.log("✅ MongoDB подключен");

    console.log("🚀 Первичная очистка уведомлений...");
    try {
      await cleanupOldNotifications();
    } catch (err) {
      console.error("❌ Ошибка первичной очистки:", err);
    }

    await initializeSpecializations();

    const server = http.createServer(app);

    const io = new Server(server, {
      cors: {
        origin: checkOrigin,
        credentials: true,
      },
    });

    // ✅ Создаём namespace ОДИН РАЗ
    const nsp = io.of("/communication");

    // ✅ Session middleware — пробрасываем сессию в socket.request
    nsp.use((socket, next) => {
      sessionMiddleware(socket.request, socket.request.res || {}, next);
    });

    // ✅ Передаём nsp напрямую — НЕ io!
    initCommunicationGateway(nsp);

    // ✅ Call gateway на том же nsp
    initCallGateway(nsp);

    app.set("io", io);
    setSimulationIo(io);
    server.listen(startPort, () =>
      console.log(
        `🚀 Сервер + WebSocket запущен: http://localhost:${startPort}`,
      ),
    );
  } catch (err) {
    console.error("❌ Ошибка запуска сервера:", err);
    process.exit(1);
  }
}

console.log("📦 [index.js] Запуск bootstrap()...");
bootstrap();
