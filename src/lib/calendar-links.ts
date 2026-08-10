import type { Session, SME } from "@/lib/data";

function formatGoogleCalendarDate(date: Date) {
  return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
}

export function generateGoogleCalendarUrl(session: {
  topic: string;
  track: string;
  start_time_utc: string;
  duration_hours: number;
  sme_email?: string;
}) {
  const startDate = new Date(session.start_time_utc);
  const endDate = new Date(startDate.getTime() + session.duration_hours * 60 * 60 * 1000);
  const title = encodeURIComponent(`Interview Kickstart: ${session.topic}`);
  const details = encodeURIComponent(`Domain Track: ${session.track}\nLive Learning Session`);
  const dates = `${formatGoogleCalendarDate(startDate)}/${formatGoogleCalendarDate(endDate)}`;
  const add = session.sme_email ? encodeURIComponent(session.sme_email) : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&add=${add}`;
}

export function generateWeeklyICS(assignments: Array<{ session: Session; sme?: SME | null }>) {
  const formatICSDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Interview Kickstart//SME Scheduler//EN",
  ];

  assignments.forEach(({ session, sme }) => {
    const start = new Date(session.startTime.replace(" ", "T") + ":00");
    const end = new Date(start.getTime() + session.durationHours * 60 * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `SUMMARY:IK Class - ${session.topic}`,
      `DESCRIPTION:Instructor: ${sme?.name || "Unassigned"}`,
      `DTSTART:${formatICSDate(start)}`,
      `DTEND:${formatICSDate(end)}`,
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
