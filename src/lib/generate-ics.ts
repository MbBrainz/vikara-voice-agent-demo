/**
 * Generate a standards-compliant ICS calendar invite (RFC 5545).
 * Uses METHOD:REQUEST so email clients render Accept/Decline buttons.
 */
export function generateICS(options: {
  attendeeName: string;
  attendeeEmail: string;
  startTime: Date;
  durationMinutes?: number;
  summary?: string;
  description?: string;
  organizerEmail?: string;
  organizerName?: string;
}): string {
  const {
    attendeeName,
    attendeeEmail,
    startTime,
    durationMinutes = 30,
    summary = "Vikara Product Demo",
    description = "Product demo scheduled via Vikara voice agent.",
    organizerEmail = "invites@vikara.ttslab.dev",
    organizerName = "Vikara",
  } = options;

  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  const now = new Date();
  const uid = `demo-${now.getTime()}@vikara.ttslab.dev`;

  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");

  // RFC 5545 requires \r\n line endings
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vikara//Demo Scheduler//EN",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmt(now)}`,
    `DTSTART:${fmt(startTime)}`,
    `DTEND:${fmt(endTime)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${attendeeName}:mailto:${attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    `BEGIN:VALARM`,
    `TRIGGER:-PT15M`,
    `ACTION:DISPLAY`,
    `DESCRIPTION:Reminder`,
    `END:VALARM`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}
