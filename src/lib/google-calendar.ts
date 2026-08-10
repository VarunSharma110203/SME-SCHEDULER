function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function getLiveGoogleConfig() {
  return {
    enabled: !!(env("LIVE_ICAL_URL") && env("LIVE_GOOGLE_CALENDAR_SME_ID")),
    smeId: env("LIVE_GOOGLE_CALENDAR_SME_ID") || "sme-3",
    icalUrl: env("LIVE_ICAL_URL"),
  };
}

type IcsBusyEvent = { startTime: string; title: string };

function unfoldIcs(content: string) {
  return content.replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(value: string) {
  const cleaned = value.trim();
  if (/^\d{8}T\d{6}Z$/.test(cleaned)) {
    const year = cleaned.slice(0, 4);
    const month = cleaned.slice(4, 6);
    const day = cleaned.slice(6, 8);
    const hour = cleaned.slice(9, 11);
    const minute = cleaned.slice(11, 13);
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  if (/^\d{8}T\d{6}$/.test(cleaned)) {
    const year = cleaned.slice(0, 4);
    const month = cleaned.slice(4, 6);
    const day = cleaned.slice(6, 8);
    const hour = cleaned.slice(9, 11);
    const minute = cleaned.slice(11, 13);
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)} 00:00`;
  }
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) {
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
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
