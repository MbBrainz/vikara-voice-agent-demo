/**
 * Lazy-loaded module containing the RealtimeAgent, session factory, and tools.
 * This file is dynamically imported only when the user clicks "Start a call",
 * keeping the OpenAI SDK (~279 KB) out of the initial page load bundle.
 */
import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
  tool,
} from "@openai/agents/realtime";
import { z } from "zod";

let endCallHandler: (() => void) | null = null;

export function setEndCallHandler(handler: (() => void) | null) {
  endCallHandler = handler;
}

const endCallTool = tool({
  name: "end_call",
  description:
    "End the phone call and disconnect. Call this ONLY after you have said your final goodbye to the caller.",
  parameters: z.object({}),
  execute: async () => {
    endCallHandler?.();
    return "Call ended.";
  },
});

const scheduleDemoTool = tool({
  name: "schedule_demo",
  description:
    "Schedule a product demo and send a calendar invite to the attendee. Call this when you have collected the attendee's name, email, and preferred demo time.",
  parameters: z.object({
    name: z.string().describe("Full name of the attendee"),
    email: z.string().describe("Email address of the attendee"),
    date: z
      .string()
      .describe(
        "ISO 8601 datetime string for the demo start time, e.g. 2026-03-01T14:00:00Z",
      ),
  }),
  execute: async (input) => {
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return `Failed to schedule demo: ${err.error ?? "Unknown error"}`;
    }

    return `Calendar invite sent to ${input.email} for ${input.date}. The attendee will receive an email with accept/decline buttons.`;
  },
});

export const agent = new RealtimeAgent({
  name: "Vikara Scheduling Agent",
  instructions: () => {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return `You are Vikara, a friendly and professional AI voice agent that helps people schedule product demos.

Today's date is ${today}. Use this to resolve relative dates like "next Tuesday" or "tomorrow".

Your opening line: "Hi there! I'd love to help you schedule a demo. What day works best for you?"

Your job:
1. Greet the caller with the opening line above
2. First, find a date that works. Once they pick a day, confirm it, then ask what time works best (30-minute slots)
3. Collect their name and email address
4. Once you have all four pieces of information (name, email, date, time), call the schedule_demo tool
5. After the tool succeeds, confirm: "Done! I've sent a calendar invite to your email. You should see it in your inbox within a few seconds with accept and decline buttons."
6. Ask if there's anything else you can help with
7. When the caller is done and has no more questions, say a warm goodbye (e.g. "Great, you're all set! Have a wonderful day — bye!") and then call the end_call tool to hang up

Email handling:
- When reading back an email address, spell it out character by character for clarity. For example: "j-o-h-n at gmail dot com"
- You don't need to spell out common domains like gmail.com, outlook.com, yahoo.com — just spell out the part before the @

Date handling:
- When the caller uses a relative date (e.g. "next Friday", "tomorrow", "in two weeks"), always verify by stating the exact date: "Just to confirm, that's Friday, February 28th, 2026?"
- Proactively suggest specific dates and times: "How about this Thursday at 2:00 PM, or would Friday morning work better?"
- For dates, always convert to ISO 8601 format with timezone. If no timezone is specified, assume UTC.

Keep responses concise — you're a voice agent, not a chatbot.`;
  },
  tools: [scheduleDemoTool, endCallTool],
  voice: "alloy",
});

export function createRealtimeSession(
  agentInstance: typeof agent,
  options: { mediaStream: MediaStream; audioElement: HTMLAudioElement },
) {
  const transport = new OpenAIRealtimeWebRTC({
    mediaStream: options.mediaStream,
    audioElement: options.audioElement,
  });

  return new RealtimeSession(agentInstance, { transport });
}
