import { NextResponse } from "next/server";
import { INITIAL_SMES, INITIAL_SESSIONS } from "@/lib/data";

/**
 * POST /api/schedule/ingest
 *
 * Simulates ingesting session + SME data from Google Sheets / Calendar APIs.
 * In production, this endpoint would:
 *   1. Call `sheets.spreadsheets.values.get()` to pull SME pool from a named range
 *   2. Call `sheets.spreadsheets.values.get()` to pull weekly session manifest
 *   3. Call `calendar.freebusy.query()` for each SME's real-time availability
 *   4. Merge calendar blocks into the SME availableSlots array
 *   5. Return the unified payload
 *
 * For the prototype, returns synthetic data with a realistic network delay.
 */
export async function POST() {
  // Simulate network latency from Google APIs
  await new Promise((r) => setTimeout(r, 800));

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    source: "google_sheets_simulated",
    data: {
      smes: INITIAL_SMES,
      sessions: INITIAL_SESSIONS,
    },
    meta: {
      sheetsId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      calendarIds: INITIAL_SMES.map((s) => `${s.name.toLowerCase().replace(/ /g, ".")}@interviewkickstart.com`),
    },
  });
}
