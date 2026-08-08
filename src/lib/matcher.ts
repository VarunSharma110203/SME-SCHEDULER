import { SME, Session, AssignmentResult, ConflictFlag } from "./data";

/**
 * TIER SCORES (Senior Faculty > Lead Instructor > Standard SME)
 */
const TIER_WEIGHTS: Record<string, number> = {
  "Senior Faculty": 3,
  "Lead Instructor": 2,
  "Standard SME": 1,
};

/**
 * Mock synced Google Calendar events for SMEs to simulate real-time conflicts
 */
export const MOCK_CALENDAR_EVENTS: Record<string, { startTime: string; title: string }[]> = {
  "sme-1": [ // Dr. Aris Vance
    { startTime: "2026-08-10 09:00", title: "Internal Research Sync (Google Calendar)" },
    { startTime: "2026-08-12 10:00", title: "Doctor Appointment (Google Calendar)" }
  ],
  "sme-2": [ // Neha Sharma
    { startTime: "2026-08-10 10:00", title: "System Design Panel Interview (Google Calendar)" }
  ],
  "sme-3": [ // Vikram Malhotra
    { startTime: "2026-08-10 18:30", title: "DP Practice Review Session (Google Calendar)" }
  ]
};

/**
 * Helper to simulate semantic similarity scoring (LLM reasoning fallback)
 * Calculates fuzzy compatibility score for topics that aren't exact keyword matches.
 */
function getSemanticSimilarity(smeSkills: string[], requiredSkills: string[], topic: string): { score: number; reasoning: string } {
  // Simple simulator: check for closely related concepts
  const mappings: Record<string, string[]> = {
    "Agentic AI": ["LLM Fine-tuning", "Deep Learning", "Python"],
    "System Design": ["Distributed Systems", "Microservices", "System Architecture", "Database Sharding"],
    "Algorithms & Data Structures": ["Dynamic Programming", "Graphs", "Data Structures"],
    "Engineering Leadership": ["People Mgmt", "Behavioral Interview"],
    "Quantum Computing": ["Qiskit", "System Architecture"]
  };

  const related = mappings[topic] || [];
  const matches = smeSkills.filter(s => requiredSkills.includes(s) || related.includes(s));
  
  if (matches.length === 0) {
    return { score: 0.15, reasoning: "No matching skills or related capabilities found." };
  }

  const coverage = matches.length / Math.max(requiredSkills.length, 1);
  const score = Math.min(1.0, 0.4 + coverage * 0.6);
  
  return {
    score,
    reasoning: `Semantic similarity of ${(score * 100).toFixed(0)}% mapped via related skills: [${matches.join(", ")}].`
  };
}

function buildRemediationOptions(params: {
  session: Session;
  sessionTimeSlot: string;
  candidateScores: ReturnType<typeof computeCandidateScores>;
  currentAssignments?: Record<string, string | null>;
}): NonNullable<ConflictFlag["remediationOptions"]> {
  const { session, sessionTimeSlot, candidateScores } = params;
  const viableReassignments = candidateScores
    .filter((c) => c.isSlotAvailable && c.isTierValid && c.hasCoreSkill)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 3);

  const topBackup = viableReassignments[0];
  const alternates = candidateScores
    .filter((c) => c.sme.id !== topBackup?.sme.id)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 2);

  const options: NonNullable<ConflictFlag["remediationOptions"]> = [];

  if (session.priority === 1 || session.priority === 2) {
    options.push({
      label: topBackup ? `Move session and keep ${topBackup.sme.name}` : "Move session by 30-60 minutes",
      action: "RESCHEDULE",
      reason: topBackup
        ? `Move the slot to one of ${topBackup.sme.name}'s open times, like ${topBackup.sme.availableSlots.filter(slot => slot !== sessionTimeSlot).slice(0, 2).join(" or ")}.`
        : `This often clears ${sessionTimeSlot} conflicts while keeping a high-priority session intact.`
    });
  }

  if (viableReassignments.length > 0) {
    options.push({
      label: `Assign ${topBackup!.sme.name}`,
      action: "REASSIGN",
      reason: `${topBackup!.sme.name} is the best fit now: ${topBackup!.sme.tier}, ${topBackup!.sme.primaryDomain}, and free at ${sessionTimeSlot}.`
    });
  }

  if (session.minSmeTier !== "Standard SME") {
    options.push({
      label: alternates.length > 0 ? `Try ${alternates[0].sme.name} at lower tier` : "Relax tier by one level",
      action: "RELAX_TIER",
      reason: alternates.length > 0
        ? `${alternates[0].sme.name} is slightly below the requested tier but still has relevant skills and a usable calendar slot.`
        : "Reasonable only when the topic is straightforward and the session can tolerate a slightly broader match."
    });
  }

  options.push({
    label: "Escalate for manual review",
    action: "ESCALATE",
    reason: viableReassignments.length > 0
      ? `Use if Ops prefers not to use ${topBackup!.sme.name} or reschedule the session.`
      : "Use when no safe unblock exists without creating a new conflict."
  });

  return options;
}

function computeCandidateScores(smes: SME[], session: Session, calendarEvents: Record<string, { startTime: string; title: string; isScheduled?: boolean }[]>, currentWeekHours: Record<string, number>) {
  const sessionTimeSlot = `${session.dayOfWeek.slice(0, 3)} ${session.startTime.split(" ")[1]}`;
  return smes.map((sme) => {
    let availabilityScore = 0;
    let expertiseFitScore = 0;
    let rollingWorkloadScore = 0;
    let ratingScore = 0;

    const isSlotAvailable = sme.availableSlots.includes(sessionTimeSlot);
    const isWithinWeeklyCap = (currentWeekHours[sme.id] || 0) + session.durationHours <= sme.maxWeeklyHours;
    const syncedEvents = calendarEvents[sme.id] || [];
    const calendarConflict = syncedEvents.find(ev => !ev.isScheduled && ev.startTime === session.startTime);
    const hasCalendarEventConflict = !!calendarConflict;

    if (isSlotAvailable && isWithinWeeklyCap && !hasCalendarEventConflict) {
      availabilityScore = 100;
    } else if (!isSlotAvailable || hasCalendarEventConflict) {
      availabilityScore = 0;
    } else {
      availabilityScore = 30;
    }

    const requiredTierVal = TIER_WEIGHTS[session.minSmeTier] || 1;
    const smeTierVal = TIER_WEIGHTS[sme.tier] || 1;
    const matchedSkills = session.requiredSkills.filter((sk) => sme.skills.includes(sk));
    const hasCoreSkill = session.requiredSkills.length === 0 || matchedSkills.length > 0;
    const semanticMatch = getSemanticSimilarity(sme.skills, session.requiredSkills, session.topic);

    if (smeTierVal < requiredTierVal) {
      expertiseFitScore = 20;
    } else {
      const skillCoverage = session.requiredSkills.length > 0 ? matchedSkills.length / session.requiredSkills.length : 1;
      const keywordScore = Math.round(60 + skillCoverage * 40);
      expertiseFitScore = Math.round(keywordScore * 0.6 + (semanticMatch.score * 100) * 0.4);
    }

    if (sme.rolling4WeekHours >= 24) rollingWorkloadScore = 40;
    else if (sme.rolling4WeekHours >= 18) rollingWorkloadScore = 70;
    else rollingWorkloadScore = 100;

    const topicRating = sme.topicRatings[session.topic] || sme.historicalRating;
    ratingScore = Math.round((topicRating / 5.0) * 100);

    const totalScore = Math.round(
      availabilityScore * 0.35 +
      expertiseFitScore * 0.35 +
      rollingWorkloadScore * 0.20 +
      ratingScore * 0.10
    );

    return {
      sme,
      totalScore,
      breakdown: {
        availabilityScore,
        expertiseFitScore,
        rollingWorkloadScore,
        ratingScore,
      },
      isSlotAvailable: isSlotAvailable && !hasCalendarEventConflict,
      hasCalendarEventConflict,
      calendarConflictTitle: calendarConflict?.title || "",
      isTierValid: smeTierVal >= requiredTierVal,
      hasCoreSkill,
      semanticMatchScore: semanticMatch.score,
      semanticMatchReason: semanticMatch.reasoning
    };
  });
}

function compareCandidatesForSession(
  a: ReturnType<typeof computeCandidateScores>[number],
  b: ReturnType<typeof computeCandidateScores>[number]
) {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if (a.sme.rolling4WeekHours !== b.sme.rolling4WeekHours) return a.sme.rolling4WeekHours - b.sme.rolling4WeekHours;
  if (b.breakdown.ratingScore !== a.breakdown.ratingScore) return b.breakdown.ratingScore - a.breakdown.ratingScore;
  return a.sme.name.localeCompare(b.sme.name);
}

/**
 * Match Engine orchestrates hard filters + soft score optimization + LLM reasoning simulation
 */
export function runMatchingEngine(
  smes: SME[],
  sessions: Session[],
  calendarEvents: Record<string, { startTime: string; title: string; isScheduled?: boolean }[]> = MOCK_CALENDAR_EVENTS,
  overrides: Record<string, string | null> = {}
): { assignments: AssignmentResult[]; conflicts: ConflictFlag[]; draftSchedule: Record<string, string | null> } {
  const allConflicts: ConflictFlag[] = [];
  const draftSchedule: Record<string, string | null> = {};
  const assignmentMap = new Map<string, AssignmentResult>();

  // Track weekly hours assigned in current run to prevent overbooking
  const currentWeekHours: Record<string, number> = {};
  smes.forEach((sme) => (currentWeekHours[sme.id] = 0));

  // Sort a copy of sessions by priority (1 = High/Cohort, 2 = Mid/Mock, 3 = Low/Doubt)
  const sortedSessions = [...sessions].sort((a, b) => a.priority - b.priority);

  sortedSessions.forEach((session) => {
    // If it's a completed past session, preserve its pre-existing assignment
    if (session.completed && session.assignedSmeId) {
      const assignedSme = smes.find(s => s.id === session.assignedSmeId);
      if (assignedSme) {
        draftSchedule[session.id] = assignedSme.id;
        currentWeekHours[assignedSme.id] = (currentWeekHours[assignedSme.id] || 0) + session.durationHours;
        
        assignmentMap.set(session.id, {
          sessionId: session.id,
          smeId: assignedSme.id,
          score: 100,
          scoreBreakdown: { availabilityScore: 100, expertiseFitScore: 100, rollingWorkloadScore: 100, ratingScore: 100 },
          llmReasoning: `Historical assignment for completed session: ${assignedSme.name}.`,
          status: "OPTIMAL",
          conflicts: []
        });
        return;
      }
    }

    const sessionTimeSlot = `${session.dayOfWeek.slice(0, 3)} ${session.startTime.split(" ")[1]}`;
    const candidateScores = computeCandidateScores(smes, session, calendarEvents, currentWeekHours);

    // Check if there is an explicit manual override for this session
    const hasOverride = overrides[session.id] !== undefined;
    const overrideSmeId = overrides[session.id];

    if (hasOverride) {
      if (overrideSmeId === null) {
        // Explicitly unassigned by user
        draftSchedule[session.id] = null;
        const unassignedConflict: ConflictFlag = {
          id: `conf-unassigned-${session.id}`,
          sessionId: session.id,
          type: "UNFILLED",
          severity: "CRITICAL",
          title: "Manually Unassigned",
          reason: "This session was manually set to unassigned by the ops coordinator.",
          suggestedSmeIds: candidateScores.slice(0, 3).map(c => c.sme.id),
          remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
        };
        allConflicts.push(unassignedConflict);
        assignmentMap.set(session.id, {
          sessionId: session.id,
          smeId: null,
          score: 0,
          scoreBreakdown: { availabilityScore: 0, expertiseFitScore: 0, rollingWorkloadScore: 0, ratingScore: 0 },
          llmReasoning: "Session manually unassigned.",
          status: "UNMATCHED",
          conflicts: [unassignedConflict]
        });
        return;
      }

      const manualSme = smes.find(s => s.id === overrideSmeId);
      if (manualSme) {
        draftSchedule[session.id] = manualSme.id;
        currentWeekHours[manualSme.id] = (currentWeekHours[manualSme.id] || 0) + session.durationHours;
        const candidateInfo = candidateScores.find(c => c.sme.id === manualSme.id);

        const manualConflicts: ConflictFlag[] = [];
        let status: AssignmentResult["status"] = "OPTIMAL";

        // Check if manual assignment collides with a Google Calendar busy event
        const syncedEvents = calendarEvents[manualSme.id] || [];
        const calEventConflict = syncedEvents.find(ev => !ev.isScheduled && ev.startTime === session.startTime);
        if (calEventConflict) {
          status = "CONFLICT";
          const calFlag: ConflictFlag = {
            id: `conf-manual-cal-${session.id}`,
            sessionId: session.id,
            type: "AVAILABILITY_CONFLICT",
            severity: "CRITICAL",
            title: `Google Calendar Conflict (${manualSme.name})`,
            reason: `${manualSme.name} is blocked by a Google Calendar event ('${calEventConflict.title.replace(" (Google Calendar)", "")}') at ${session.startTime}.`,
            suggestedSmeIds: candidateScores.filter(c => c.isSlotAvailable && c.sme.id !== manualSme.id).map(c => c.sme.id).slice(0, 2),
            remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
          };
          manualConflicts.push(calFlag);
          allConflicts.push(calFlag);
        } else if (!candidateInfo?.isSlotAvailable) {
          status = "CONFLICT";
          const slotFlag: ConflictFlag = {
            id: `conf-manual-slot-${session.id}`,
            sessionId: session.id,
            type: "AVAILABILITY_CONFLICT",
            severity: "CRITICAL",
            title: `Slot Unavailable (${manualSme.name})`,
            reason: `${manualSme.name} does not have an open availability slot for ${sessionTimeSlot}.`,
            suggestedSmeIds: candidateScores.filter(c => c.isSlotAvailable && c.sme.id !== manualSme.id).map(c => c.sme.id).slice(0, 2),
            remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
          };
          manualConflicts.push(slotFlag);
          allConflicts.push(slotFlag);
        }

        // Check tier validity
        const requiredTierVal = TIER_WEIGHTS[session.minSmeTier] || 1;
        const smeTierVal = TIER_WEIGHTS[manualSme.tier] || 1;
        if (smeTierVal < requiredTierVal) {
          status = "CONFLICT";
          const tierFlag: ConflictFlag = {
            id: `conf-manual-tier-${session.id}`,
            sessionId: session.id,
            type: "EXPERTISE_MISMATCH",
            severity: "CRITICAL",
            title: `Tier Requirement Unmet (${manualSme.name})`,
            reason: `${manualSme.name} (${manualSme.tier}) does not meet the minimum required tier (${session.minSmeTier}).`,
            suggestedSmeIds: [],
            remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
          };
          manualConflicts.push(tierFlag);
          allConflicts.push(tierFlag);
        }

        // Check workload warning
        if (manualSme.rolling4WeekHours >= 24) {
          if (status !== "CONFLICT") status = "SUBOPTIMAL";
          const fairFlag: ConflictFlag = {
            id: `conf-manual-fair-${session.id}`,
            sessionId: session.id,
            type: "FAIRNESS_VIOLATION",
            severity: "WARNING",
            title: `Rolling Workload Alert (${manualSme.name})`,
            reason: `${manualSme.name} has taught ${manualSme.rolling4WeekHours}h over the past 4 weeks (above target baseline).`,
            suggestedSmeIds: [],
            remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores, currentAssignments: draftSchedule })
          };
          manualConflicts.push(fairFlag);
          allConflicts.push(fairFlag);
        }

        assignmentMap.set(session.id, {
          sessionId: session.id,
          smeId: manualSme.id,
          score: candidateInfo?.totalScore || 50,
          scoreBreakdown: candidateInfo?.breakdown || { availabilityScore: 50, expertiseFitScore: 50, rollingWorkloadScore: 50, ratingScore: 50 },
          llmReasoning: `Manually assigned ${manualSme.name}.${manualConflicts.length > 0 ? " Warnings: " + manualConflicts.map(c => c.reason).join(" ") : ""}`,
          status,
          conflicts: manualConflicts
        });
        return;
      }
    }

    // Auto-match logic
    const validCandidates = candidateScores
      .filter((c) => c.isSlotAvailable && c.isTierValid && c.hasCoreSkill)
      .sort(compareCandidatesForSession);

    const bestCandidate = validCandidates[0];

    if (bestCandidate && bestCandidate.totalScore >= 50) {
      const assignedSme = bestCandidate.sme;
      draftSchedule[session.id] = assignedSme.id;
      currentWeekHours[assignedSme.id] = (currentWeekHours[assignedSme.id] || 0) + session.durationHours;

      const conflictsForSession: ConflictFlag[] = [];

      // Check if fairness warning applies
      if (assignedSme.rolling4WeekHours >= 24) {
        const fairnessConflict: ConflictFlag = {
          id: `conf-fair-${session.id}`,
          sessionId: session.id,
          type: "FAIRNESS_VIOLATION",
          severity: "WARNING",
          title: `Rolling Workload Alert (${assignedSme.name})`,
          reason: `${assignedSme.name} has taught ${assignedSme.rolling4WeekHours}h over the past 4 weeks (above target 16h baseline). Assigned to maintain senior domain coverage.`,
          suggestedSmeIds: candidateScores.filter(c => c.sme.id !== assignedSme.id).map(c => c.sme.id).slice(0, 2),
          remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
        };
        conflictsForSession.push(fairnessConflict);
        allConflicts.push(fairnessConflict);
      }

      // Check for timezone delta warning
      if (assignedSme.timeZone !== session.timeZone) {
        const tzConflict: ConflictFlag = {
          id: `conf-tz-${session.id}`,
          sessionId: session.id,
          type: "TIMEZONE_WARNING",
          severity: "INFO",
          title: `Cross-Timezone Schedule`,
          reason: `Instructor timezone (${assignedSme.timeZone}) differs from Session primary timezone (${session.timeZone}). Slot confirmed valid locally.`,
          suggestedSmeIds: [],
          remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
        };
        conflictsForSession.push(tzConflict);
      }

      assignmentMap.set(session.id, {
        sessionId: session.id,
        smeId: assignedSme.id,
        score: bestCandidate.totalScore,
        scoreBreakdown: bestCandidate.breakdown,
        llmReasoning: `Matched ${assignedSme.name} (${assignedSme.tier}) due to strong skill match in ${session.topic} (${(assignedSme.topicRatings[session.topic] || 4.8).toFixed(2)} rating) and calendar slot alignment (${sessionTimeSlot}).`,
        status: conflictsForSession.some(c => c.severity === "WARNING") ? "SUBOPTIMAL" : "OPTIMAL",
        conflicts: conflictsForSession
      });
    } else {
      // Unfilled / Conflict session
      draftSchedule[session.id] = null;

      // Identify root cause
      let conflictType: ConflictFlag["type"] = "UNFILLED";
      let title = "Unfilled Session - No Available SME";
      let reason = `No qualified SME in the pool is available at ${sessionTimeSlot} (${session.timeZone}).`;

      // Find top expert who is unavailable (either calendar event or slot unavailability)
      const skillMatchNoSlot = candidateScores.find(c => c.breakdown.expertiseFitScore > 60 && !c.isSlotAvailable);
      const slotMatchNoSkill = candidateScores.find(c => c.isSlotAvailable && !c.isTierValid);

      if (skillMatchNoSlot) {
        conflictType = "AVAILABILITY_CONFLICT";
        title = "Availability Bottleneck";
        if (skillMatchNoSlot.hasCalendarEventConflict) {
          reason = `Top domain expert ${skillMatchNoSlot.sme.name} has a Google Calendar conflict: '${skillMatchNoSlot.calendarConflictTitle}' at ${sessionTimeSlot}.`;
        } else {
          reason = `Top domain expert ${skillMatchNoSlot.sme.name} is qualified for ${session.topic} but has a calendar conflict at ${sessionTimeSlot}.`;
        }
      } else if (slotMatchNoSkill) {
        conflictType = "EXPERTISE_MISMATCH";
        title = "Expertise / Tier Gap";
        reason = `Available SMEs at ${sessionTimeSlot} do not meet the minimum tier requirement (${session.minSmeTier}) or skills (${session.requiredSkills.join(", ")}).`;
      }

      const gapConflict: ConflictFlag = {
        id: `conf-gap-${session.id}`,
        sessionId: session.id,
        type: conflictType,
        severity: "CRITICAL",
        title,
        reason,
        suggestedSmeIds: candidateScores.slice(0, 3).map(c => c.sme.id),
        remediationOptions: buildRemediationOptions({ session, sessionTimeSlot, candidateScores })
      };

      allConflicts.push(gapConflict);

      assignmentMap.set(session.id, {
        sessionId: session.id,
        smeId: null,
        score: 0,
        scoreBreakdown: {
          availabilityScore: 0,
          expertiseFitScore: 0,
          rollingWorkloadScore: 0,
          ratingScore: 0
        },
        llmReasoning: `Unable to match automatically. ${reason}`,
        status: "UNMATCHED",
        conflicts: [gapConflict]
      });
    }
  });

  // Map assignments back to original session order
  const assignments = sessions.map(s => {
    if (assignmentMap.has(s.id)) {
      return assignmentMap.get(s.id)!;
    }
    return {
      sessionId: s.id,
      smeId: null,
      score: 0,
      scoreBreakdown: { availabilityScore: 0, expertiseFitScore: 0, rollingWorkloadScore: 0, ratingScore: 0 },
      llmReasoning: "Session not matched. No data available.",
      status: "UNMATCHED",
      conflicts: []
    } as AssignmentResult;
  });

  // Sort conflicts by session priority so Cohort Class conflicts (Priority 1) appear first!
  const sortedConflicts = allConflicts.sort((a, b) => {
    const sA = sessions.find(s => s.id === a.sessionId);
    const sB = sessions.find(s => s.id === b.sessionId);
    const pA = sA ? sA.priority : 3;
    const pB = sB ? sB.priority : 3;
    if (pA !== pB) return pA - pB;
    // Secondary sort: critical first
    const sevVal = { CRITICAL: 1, WARNING: 2, INFO: 3 };
    return (sevVal[a.severity] || 3) - (sevVal[b.severity] || 3);
  });

  return { assignments, conflicts: sortedConflicts, draftSchedule };
}
