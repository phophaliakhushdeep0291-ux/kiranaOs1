import { z } from "zod";

export const restoreBackupSchema = z.object({
  confirmation: z.string().trim().min(8).max(80),
}).strict();
