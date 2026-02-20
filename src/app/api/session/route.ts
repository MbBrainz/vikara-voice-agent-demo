import { NextResponse } from "next/server";
import OpenAI from "openai";
import { assertInternal } from "@/lib/assert-internal";
import { env } from "@/env";

export async function POST(req: Request) {
  try {
    assertInternal(req);
  } catch (e) {
    if (e instanceof NextResponse) return e;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    const response = await client.realtime.clientSecrets.create({
      session: {
        type: "realtime",
        model: "gpt-4o-realtime-preview",
      },
    });

    return NextResponse.json({
      clientSecret: response.value,
      expiresAt: response.expires_at,
    });
  } catch (error) {
    console.error("Failed to create realtime session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
