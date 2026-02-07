// common/middlewares/cors.js
import cors from "cors";

const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

const corsMiddleware = cors(corsOptions);

export default corsMiddleware;
