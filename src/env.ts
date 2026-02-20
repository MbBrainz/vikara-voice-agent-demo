import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    OPENAI_API_KEY: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    INTERNAL_SECRET: z.string().min(32),
  },
  client: {},
  experimental__runtimeEnv: {},
});
