import { NextResponse } from "next/server";
import { env } from "@/env";

export function assertInternal(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== env.INTERNAL_SECRET) {
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
