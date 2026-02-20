import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { generateICS } from "@/lib/generate-ics";
import { env } from "@/env";

const scheduleSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  date: z.string(), // ISO 8601 datetime string
});

export async function POST(req: Request) {
  // Accept calls from the browser tool execute (origin-based)
  // or from server-side with internal secret
  const secret = req.headers.get("x-internal-secret");
  const origin = req.headers.get("origin");
  const isInternalCall = secret === env.INTERNAL_SECRET;
  const isSameOrigin = origin !== null; // browser same-origin requests include origin

  if (!isInternalCall && !isSameOrigin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = scheduleSchema.parse(body);

    const startTime = new Date(parsed.date);
    if (isNaN(startTime.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format" },
        { status: 400 },
      );
    }

    const icsContent = generateICS({
      attendeeName: parsed.name,
      attendeeEmail: parsed.email,
      startTime,
    });

    const icsBase64 = Buffer.from(icsContent).toString("base64");

    const resend = new Resend(env.RESEND_API_KEY);

    const { error: sendError } = await resend.emails.send({
      from: "Vikara <invites@ttslab.dev>",
      to: parsed.email,
      subject: "Vikara Product Demo - Calendar Invite",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #111;">Your demo is confirmed!</h2>
          <p>Hi ${parsed.name},</p>
          <p>You're scheduled for a <strong>Vikara Product Demo</strong> on:</p>
          <p style="font-size: 18px; font-weight: 600; color: #7c3aed;">
            ${startTime.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            at ${startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
          </p>
          <p>A calendar invite is attached. Click <strong>Accept</strong> to add it to your calendar.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 13px;">Sent by Vikara — AI-powered scheduling</p>
        </div>
      `,
      attachments: [
        {
          filename: "invite.ics",
          content: icsBase64,
          contentType: "text/calendar; method=REQUEST",
        },
      ],
    });

    if (sendError) {
      throw new Error(`Resend API error: ${sendError.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Schedule error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Failed to schedule demo" },
      { status: 500 },
    );
  }
}
