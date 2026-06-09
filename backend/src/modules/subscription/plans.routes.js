import { Router } from "express";
import * as ctrl from "./subscription.controller.js";

const router = Router();
router.get("/", ctrl.plans);

export default router;
