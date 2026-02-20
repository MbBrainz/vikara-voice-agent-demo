"use server";

import OpenAI from "openai";
import { env } from "@/env";

export async function createSession() {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const response = await client.realtime.clientSecrets.create({
    session: {
      type: "realtime",
      model: "gpt-4o-realtime-preview",
    },
  });

  return {
    clientSecret: response.value,
    expiresAt: response.expires_at,
  };
}
