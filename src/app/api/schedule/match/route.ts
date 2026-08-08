import { NextResponse } from "next/server";
import { INITIAL_SMES, INITIAL_SESSIONS } from "@/lib/data";
import { runMatchingEngine } from "@/lib/matcher";

/**
 * POST /api/schedule/match
 *
 * Triggers the matching engine run. Equivalent to FastAPI's "trigger run" endpoint.
 * Accepts optional overrides in the request body.
 *
 * In production this would:
 *   1. Pull latest SME + session data from the DB/Sheets
 *   2. Run the hybrid deterministic + LLM matching engine
 *   3. Persist the draft schedule
 *   4. Return assignments, conflicts, and the draft
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const smes = body.smes || INITIAL_SMES;
  const sessions = body.sessions || INITIAL_SESSIONS;
  const overrides: Record<string, string | null> = body.overrides || {};

  // Simulate engine processing time
  await new Promise((r) => setTimeout(r, 300));

  const result = runMatchingEngine(smes, sessions, undefined, overrides);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    assignments: result.assignments,
    conflicts: result.conflicts,
    draftSchedule: result.draftSchedule,
    stats: {
      totalSessions: sessions.length,
      filled: Object.values(result.draftSchedule).filter(Boolean).length,
      gaps: Object.values(result.draftSchedule).filter((v) => !v).length,
      criticalConflicts: result.conflicts.filter((c: { severity: string }) => c.severity === "CRITICAL").length,
      warnings: result.conflicts.filter((c: { severity: string }) => c.severity === "WARNING").length,
    },
  });
}
