import { NextResponse } from "next/server";

/**
 * GET /api/schedule/draft
 *
 * Fetches the current draft schedule. Equivalent to FastAPI's "fetch draft" endpoint.
 *
 * In production this would read from a persistent store (DB/Redis).
 * For the prototype, returns a static response demonstrating the API shape.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    message: "Draft schedule is managed client-side in this prototype. In production, this endpoint would read from the persistent schedule store.",
    apiShape: {
      draftSchedule: "Record<sessionId, smeId | null>",
      assignments: "AssignmentResult[]",
      conflicts: "ConflictFlag[]",
      stats: {
        totalSessions: "number",
        filled: "number",
        gaps: "number",
        approvedCount: "number",
      },
    },
  });
}
