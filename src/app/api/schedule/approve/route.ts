import { NextResponse } from "next/server";

/**
 * POST /api/schedule/approve
 *
 * Submits approvals for specific sessions. Equivalent to FastAPI's "submit approvals" endpoint.
 *
 * In production this would:
 *   1. Validate the session IDs + assigned SME IDs
 *   2. Write approved rows back to Google Sheets
 *   3. Create Google Calendar events for each approved assignment
 *   4. Send notification emails/Slack to assigned SMEs
 *   5. Return confirmation
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const approvedSessionIds: string[] = body.sessionIds || [];
  const schedule: Record<string, string> = body.schedule || {};

  // Simulate write to Google Sheets + Calendar
  await new Promise((r) => setTimeout(r, 400));

  // In production: sheets.spreadsheets.values.update() + calendar.events.insert()
  const results = approvedSessionIds.map((sessId) => ({
    sessionId: sessId,
    assignedSmeId: schedule[sessId] || null,
    status: schedule[sessId] ? "APPROVED" : "SKIPPED",
    calendarEventId: schedule[sessId] ? `evt_${sessId}_${Date.now()}` : null,
    sheetsRowUpdated: !!schedule[sessId],
  }));

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    approved: results.filter((r) => r.status === "APPROVED").length,
    skipped: results.filter((r) => r.status === "SKIPPED").length,
    results,
    exportTargets: {
      googleSheets: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      googleCalendar: "scheduling@interviewkickstart.com",
    },
  });
}
