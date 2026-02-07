// ======================= IMPORTS =======================
import express from "express";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import xss from "xss-clean";
import session from "express-session";
import cookieParser from "cookie-parser";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";

import fs from "fs";

import connectDB from "./common/config/db/mongodb.js";
import routes from "./common/routes/index.js";
import uploadRoutes from "./common/routes/uploadRoutes.js";
import uploadFileRoutes from "./common/routes/uploadFileRoutes.js";
import emailLimiter from "./common/middlewares/rateLimiter.js";

import User, { decrypt as decryptUser } from "./common/models/Auth/users.js";
import NewPatientPolyclinic from "./common/models/PatientProfile/patientProfile.js";
import DoctorProfile from "./common/models/DoctorProfile/profileDoctor.js";
import "./common/models/Comments/CommentDocpats.js";

import { initializeSpecializations } from "./common/utils/initSpecializations.js";
import cron from "node-cron";
import { cleanupOldNotifications } from "./jobs/cleanupOldNotifications.js";

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

  // ⭐ новый продакшн домен:
  "https://docpats.com",
  "https://www.docpats.com",

  // старый netlify (можешь оставить, он не мешает)
  "https://frontend-docpats.netlify.app",
];

const corsOptions = {
  origin: function (origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },

  credentials: true, // обязательно для cookie + session

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Pragma",
    "Expires",
    "X-Requested-With",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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
app.set("trust proxy", 1);

// ======================= SESSION =======================
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI (или MONGO_URL) не задан в .env");
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

app.use(
  session({
    secret: process.env.SECRET || "default_secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URL,
      dbName: process.env.MONGODB_DB || "DOCPATS_NEW",
      collectionName: "sessions",
      autoRemove: "native",
      ttl: 14 * 24 * 60 * 60,
      touchAfter: 24 * 3600,
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction, // false локально
      sameSite: isProduction ? "none" : "lax",
      maxAge: 14 * 24 * 60 * 60 * 1000,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  }),
);
process.on("unhandledRejection", (err) => {
  if (err?.message?.includes("Unable to find the session to touch")) {
    console.warn("⚠️ Сессия недоступна (просрочена или удалена). Игнорируем.");
  } else {
    console.error("❌ Unhandled Rejection:", err);
  }
});

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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    console.error("❌ /common-for-user error:", err);
    res.status(200).json({ authenticated: false });
  }
});

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

// ======================= AUTO ROUTE LOADER =======================
const modulesPath = path.join(__dirname, "modules");
if (fs.existsSync(modulesPath)) {
  fs.readdirSync(modulesPath).forEach((moduleName) => {
    const routeDir = path.join(modulesPath, moduleName, "routes");
    if (fs.existsSync(routeDir)) {
      fs.readdirSync(routeDir).forEach((file) => {
        if (file.endsWith(".js")) {
          const routePath = path.join(routeDir, file);
          const fileUrl = pathToFileURL(routePath).href;
          import(fileUrl)
            .then((module) => {
              if (module.default) {
                app.use(`/api/${moduleName}`, module.default);
                console.log(`✅ Route loaded: /api/${moduleName}/${file}`);
              }
            })
            .catch((err) =>
              console.error(
                `❌ Ошибка загрузки маршрута ${file}:`,
                err.message,
              ),
            );
        }
      });
    }
  });
} else {
  console.warn("⚠️ Папка modules не найдена, автозагрузка роутов пропущена");
}

// ======================= CRON =======================
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

    const { default: autoCleanAppointments } =
      await import("./jobs/autoCleanAppointments.js");
    console.log("🧹 AutoCleanAppointments загружен.");

    console.log("🚀 Первичная очистка уведомлений...");
    try {
      await cleanupOldNotifications();
    } catch (err) {
      console.error("❌ Ошибка первичной очистки:", err);
    }

    await initializeSpecializations();

    app.listen(startPort, () =>
      console.log(`🚀 Сервер запущен: http://localhost:${startPort}`),
    );
  } catch (err) {
    console.error("❌ Ошибка запуска сервера:", err);
    process.exit(1);
  }
}

console.log("📦 [index.js] Запуск bootstrap()...");
bootstrap();
