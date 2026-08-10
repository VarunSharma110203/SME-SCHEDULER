import { NextResponse } from "next/server";
import { fetchBusyEventsFromIcs, getLiveGoogleConfig } from "@/lib/google-calendar";

export async function GET() {
  const cfg = getLiveGoogleConfig();
  if (!cfg.enabled) {
    return NextResponse.json({
      success: false,
      liveEnabled: false,
      smeId: cfg.smeId,
      icalUrl: cfg.icalUrl || null,
      events: [],
      message: "Live ICS sync is not configured yet.",
    });
  }

  const events = await fetchBusyEventsFromIcs(cfg.icalUrl);

  return NextResponse.json({
    success: true,
    liveEnabled: true,
    smeId: cfg.smeId,
    icalUrl: cfg.icalUrl,
    events,
  });
}
