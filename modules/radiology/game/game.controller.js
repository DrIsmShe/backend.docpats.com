// server/modules/radiology/game/game.controller.js

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import {
  getProfile,
  getLeaderboard,
  getDailyCase,
  getWeeklyCase,
} from "./game.service.js";

export const profileController = asyncHandler(async (req, res) => {
  res.json(await getProfile(req.radiologyActor.userId));
});

export const leaderboardController = asyncHandler(async (req, res) => {
  const items = await getLeaderboard({ limit: Number(req.query.limit) || 20 });
  res.json({ items });
});

export const dailyController = asyncHandler(async (req, res) => {
  res.json({ daily: await getDailyCase() });
});

export const weeklyController = asyncHandler(async (req, res) => {
  res.json({ weekly: await getWeeklyCase() });
});
