function env(name: string) {
  return process.env[name]?.trim() || "";
}

const DEFAULT_ICAL_URL = "https://calendar.google.com/calendar/ical/41e95241d283dfd5edee3389c46860fd9c1ee590ecd44480f8b2eb94d3e57c0d%40group.calendar.google.com/private-614f87a75eee490cc4f27817433dbf79/basic.ics";

export function getLiveGoogleConfig() {
  const icalUrl = env("LIVE_ICAL_URL") || DEFAULT_ICAL_URL;
  const rawId = env("LIVE_GOOGLE_CALENDAR_SME_ID") || "sme-3";
  const smeId = (rawId === "vikram-live" || !rawId) ? "sme-3" : rawId;
  return {
    enabled: !!icalUrl,
    smeId,
    icalUrl,
  };
}

type IcsBusyEvent = { startTime: string; title: string };

function unfoldIcs(content: string) {
  return content.replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(value: string) {
  const cleaned = value.trim();
  const formatIsoDateTime = (year: string, month: string, day: string, hour: string, minute: string) =>
    `${year}-${month}-${day} ${hour}:${minute}`;
  const formatUtcToIst = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date).replace(",", "").replace(/\//g, "-").replace(" ", " ");
  if (/^\d{8}T\d{6}Z$/.test(cleaned)) {
    const year = cleaned.slice(0, 4);
    const month = cleaned.slice(4, 6);
    const day = cleaned.slice(6, 8);
    const hour = cleaned.slice(9, 11);
    const minute = cleaned.slice(11, 13);
    return formatUtcToIst(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))));
  }
  if (/^\d{8}T\d{6}$/.test(cleaned)) {
    const year = cleaned.slice(0, 4);
    const month = cleaned.slice(4, 6);
    const day = cleaned.slice(6, 8);
    const hour = cleaned.slice(9, 11);
    const minute = cleaned.slice(11, 13);
    return formatIsoDateTime(year, month, day, hour, minute);
  }
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)} 00:00`;
  }
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) {
    return formatUtcToIst(d);
  }
  return "";
}

export async function fetchBusyEventsFromIcs(icalUrl: string): Promise<IcsBusyEvent[]> {
  const res = await fetch(icalUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = unfoldIcs(await res.text());
  const lines = text.split(/\r?\n/);
  const events: IcsBusyEvent[] = [];
  let inEvent = false;
  let summary = "";
  let startTime = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      summary = "";
      startTime = "";
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && startTime) events.push({ startTime, title: summary || "Busy" });
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith("SUMMARY:")) summary = line.slice(8).trim();
    if (line.startsWith("DTSTART")) {
      const idx = line.indexOf(":");
      startTime = parseIcsDate(line.slice(idx + 1));
    }
  }

  return events.filter((ev) => ev.startTime);
}
