"use client";
import React, { useState, useMemo, useEffect } from "react";
import { INITIAL_SMES, INITIAL_SESSIONS, SME, Session } from "@/lib/data";
import { runMatchingEngine, MOCK_CALENDAR_EVENTS } from "@/lib/matcher";
import { generateGoogleCalendarUrl, generateWeeklyICS } from "@/lib/calendar-links";

type CalendarEvent = { startTime: string; title: string; isScheduled?: boolean; sessionId?: string; isLiveIcs?: boolean };
type CalendarState = Record<string, CalendarEvent[]>;
import confetti from "canvas-confetti";
import {
  Sparkles, RefreshCw, UserX, CheckCircle2, AlertTriangle,
  Clock, Check, Brain, X, BarChart3, ArrowRight,
  Calendar, Users, Zap, Shield, TrendingUp,
} from "lucide-react";

const MODE_CFG = {
  "Cohort Class":   { color: "#2563EB", bg: "#EFF6FF", badge: "bg-blue-100 text-blue-800",   label: "Cohort" },
  "Mock Interview": { color: "#059669", bg: "#ECFDF5", badge: "bg-emerald-100 text-emerald-800", label: "Mock" },
  "Doubt Clearing": { color: "#7C3AED", bg: "#F5F3FF", badge: "bg-violet-100 text-violet-800", label: "Doubt" },
} as const;

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const TIER_W: Record<string, number> = { "Senior Faculty": 3, "Lead Instructor": 2, "Standard SME": 1 };

type OpsView = "SCHEDULE" | "ISSUES" | "SME";
type Role = "OPS" | "SME";

export default function App() {
  const [smes, setSmes] = useState(() => JSON.parse(JSON.stringify(INITIAL_SMES)) as typeof INITIAL_SMES);
  const [sessions, setSessions] = useState<Session[]>(INITIAL_SESSIONS);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [approved, setApproved] = useState<Record<string, true>>({});
  const [selected, setSelected] = useState<string>("sess-101");
  const [running, setRunning] = useState(false);
  const [hasRunMatch, setHasRunMatch] = useState(false);
  
  // Modals & Navigation States
  const [currentWeekStart, setCurrentWeekStart] = useState("2026-08-10");
  const [assignModalOpen, setAssignModalOpen] = useState<string | null>(null);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [addSmeModalOpen, setAddSmeModalOpen] = useState(false);
  const [addSessionModalOpen, setAddSessionModalOpen] = useState(false);
  const [smeCalendarModalOpen, setSmeCalendarModalOpen] = useState<string | null>(null);
  const [portalSmeId, setPortalSmeId] = useState(INITIAL_SMES[0].id);

  // Live Google Calendar state — seeded with mock synced events, grows as sessions are approved
  const [calendarEvents, setCalendarEvents] = useState<CalendarState>(
    () => JSON.parse(JSON.stringify(MOCK_CALENDAR_EVENTS)) as CalendarState
  );
  const [liveGoogleSmeId, setLiveGoogleSmeId] = useState<string | null>(null);
  const [googleCalendarLive, setGoogleCalendarLive] = useState(false);

  const [role, setRole] = useState<Role>("OPS");
  const [view, setView] = useState<OpsView>("SCHEDULE");
  const isOpsRole = role === "OPS";
  const isSmeRole = role === "SME";
  const [scheduleLayout, setScheduleLayout] = useState<"WEEK" | "TABLE">("WEEK");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/google-calendar/live", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.liveEnabled || !data?.smeId || !Array.isArray(data?.events)) return;
        setLiveGoogleSmeId(data.smeId);
        setGoogleCalendarLive(true);
        setCalendarEvents(prev => ({
          ...prev,
          // Tag each live event with isLiveIcs:true so the matcher knows
          // these times are IST-parsed (from ICS) and need IST comparison.
          // Mock events for other SMEs are NOT tagged and use raw-time comparison.
          [data.smeId]: data.events.map((ev: { startTime: string; title?: string }) => ({
            startTime: ev.startTime,
            title: ev.title || "Google Calendar Busy",
            isLiveIcs: true,
          })),
        }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const normalizeIcsLikeTime = (value: string) => {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) return trimmed;
    if (trimmed.includes("T")) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) {
        return new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(d).replace(",", "").replace(/\//g, "-").replace(" ", " ");
      }
    }
    return trimmed;
  };

  /**
   * Convert a session's startTime (stored in session.timeZone) to IST string.
   * This mirrors getSessionDateTimeInZone in matcher.ts so the UI and engine
   * always agree on whether a calendar event overlaps a session slot.
   */
  const getSessionStartInIst = (session: Session): string => {
    const TIMEZONE_ALIASES: Record<string, string> = {
      "US/Pacific": "America/Los_Angeles",
      "US/Eastern": "America/New_York",
      "Asia/Kolkata": "Asia/Kolkata",
      "Europe/London": "Europe/London",
    };
    const resolvedTz = TIMEZONE_ALIASES[session.timeZone] || session.timeZone;
    const [datePart, timePart] = session.startTime.trim().split(" ");
    const [y, m, d] = datePart.split("-").map(Number);
    const [h, min] = timePart.split(":").map(Number);

    const utcMs = Date.UTC(y, m - 1, d, h, min);

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: resolvedTz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: false
    }).formatToParts(new Date(utcMs));

    const p: Record<string, number> = {};
    parts.forEach(pt => p[pt.type] = Number(pt.value));
    if (p.hour === 24) p.hour = 0;

    const targetMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diffMs = utcMs - targetMs;

    const utcDate = new Date(utcMs + diffMs);

    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(utcDate).replace(",", "").replace(/\//g, "-").replace(" ", " ");
  };

  // Filter sessions by the currently selected week
  const weeklySessions = useMemo(() => {
    const start = new Date(currentWeekStart + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    
    return sessions.filter(s => {
      const sDate = new Date(s.startTime.split(' ')[0] + "T00:00:00");
      return sDate >= start && sDate < end;
    });
  }, [sessions, currentWeekStart]);

  const isPastWeek = useMemo(() => {
    const start = new Date(currentWeekStart + "T00:00:00");
    const baseline = new Date("2026-08-10T00:00:00");
    return start < baseline;
  }, [currentWeekStart]);

  const weekRangeStr = useMemo(() => {
    const start = new Date(currentWeekStart + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  }, [currentWeekStart]);

  const prevWeek = () => {
    const d = new Date(currentWeekStart + "T00:00:00");
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(d.toISOString().split('T')[0]);
  };

  const nextWeek = () => {
    const d = new Date(currentWeekStart + "T00:00:00");
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(d.toISOString().split('T')[0]);
  };

  // Matching Engine Memoization — passes live calendarEvents and overrides reactively
  const { assignments, conflicts, draftSchedule } = useMemo(
    () => runMatchingEngine(smes, sessions, calendarEvents, overrides),
    [smes, sessions, calendarEvents, overrides]
  );

  const schedule = useMemo(() => {
    if (!hasRunMatch) {
      const empty: Record<string, string | null> = {};
      Object.entries(overrides).forEach(([s, i]) => (empty[s] = i));
      sessions.forEach(s => {
        if (s.completed && s.assignedSmeId) {
          empty[s.id] = s.assignedSmeId;
        }
      });
      return empty;
    }
    const m = { ...draftSchedule };
    Object.entries(overrides).forEach(([s, i]) => (m[s] = i));
    return m;
  }, [draftSchedule, overrides, hasRunMatch, sessions]);

  // Weekly KPIs calculation — only surface conflict metrics when matching has been run or manual overrides exist
  const weeklyFilled = useMemo(() => weeklySessions.filter(s => schedule[s.id]).length, [weeklySessions, schedule]);
  const weeklyTotal = weeklySessions.length;
  const pct = weeklyTotal > 0 ? Math.round((weeklyFilled / weeklyTotal) * 100) : 0;
  
  const weeklyConflicts = useMemo(() => {
    if (!hasRunMatch && Object.keys(overrides).length === 0) return [];
    return conflicts.filter(c => weeklySessions.some(s => s.id === c.sessionId));
  }, [conflicts, weeklySessions, hasRunMatch, overrides]);

  const crits = useMemo(() => weeklyConflicts.filter(c => c.severity === "CRITICAL").length, [weeklyConflicts]);
  const warns = useMemo(() => weeklyConflicts.filter(c => c.severity === "WARNING").length, [weeklyConflicts]);
  const appCnt = useMemo(() => weeklySessions.filter(s => approved[s.id] || s.completed).length, [weeklySessions, approved]);

  const selSess = sessions.find(s => s.id === selected) ?? weeklySessions[0] ?? sessions[0];
  const selSme  = smes.find(s => s.id === schedule[selSess?.id ?? ""]);
  const selAsgn = useMemo(() => {
    if (!hasRunMatch && !overrides[selSess?.id ?? ""]) return null;
    return assignments.find(a => a.sessionId === selSess?.id) || null;
  }, [hasRunMatch, overrides, selSess, assignments]);

  const runMatch = () => {
    setRunning(true);
    setHasRunMatch(false);
    setTimeout(() => {
      setRunning(false);
      setHasRunMatch(true);
      try { confetti({ particleCount: 90, spread: 65, origin: { y: 0.55 }, colors: ["#FF5A1F","#1E3A8A","#ffffff"] }); } catch {}
    }, 500);
  };

  const rescheduleSession = (sessId: string, newDate: string, newTime: string) => {
    const dateObj = new Date(newDate + "T00:00:00");
    const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' }) as Session["dayOfWeek"];
    setSessions(prev => prev.map(s => {
      if (s.id === sessId) {
        const newStart = `${newDate} ${newTime}`;
        return { ...s, startTime: newStart, dayOfWeek: weekday };
      }
      return s;
    }));
    setOverrides(p => {
      const copy = { ...p };
      delete copy[sessId];
      return copy;
    });
    setApproved(p => {
      if (!p[sessId]) return p;
      const copy = { ...p };
      delete copy[sessId];
      return copy;
    });
    removeScheduledEvent(sessId);
    setHasRunMatch(false);
    setTimeout(() => runMatch(), 100);
  };

  const emergencyDowngrade = (sessId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessId) {
        return { ...s, minSmeTier: "Standard SME" };
      }
      return s;
    }));
    setOverrides(p => {
      const copy = { ...p };
      delete copy[sessId];
      return copy;
    });
    setApproved(p => {
      if (!p[sessId]) return p;
      const copy = { ...p };
      delete copy[sessId];
      return copy;
    });
    setHasRunMatch(false);
    setTimeout(() => runMatch(), 100);
  };

  const reset = () => {
    setSessions(JSON.parse(JSON.stringify(INITIAL_SESSIONS)));
    setSmes(JSON.parse(JSON.stringify(INITIAL_SMES)));
    setOverrides({});
    setApproved({});
    setSelected("sess-101");
    setCurrentWeekStart("2026-08-10");
    setHasRunMatch(false);
    setCalendarEvents(JSON.parse(JSON.stringify(MOCK_CALENDAR_EVENTS)) as CalendarState);
  };

  const assignSme = (sessId: string, smeId: string | null) => {
    setOverrides(p => ({ ...p, [sessId]: smeId }));
    setApproved(p => {
      if (!p[sessId]) return p;
      const next = { ...p };
      delete next[sessId];
      return next;
    });
    setHasRunMatch(true);
  };

  const removeScheduledEvent = (sessId: string) => {
    setCalendarEvents(prev => {
      const next = { ...prev };
      Object.keys(next).forEach((smeId) => {
        next[smeId] = (next[smeId] || []).filter(ev => !(ev.isScheduled && ev.sessionId === sessId));
      });
      return next;
    });
  };

  const removeScheduledEventsForSme = (smeId: string) => {
    setCalendarEvents(prev => ({
      ...prev,
      [smeId]: (prev[smeId] || []).filter(ev => !ev.isScheduled),
    }));
  };

  const dropApprovedSession = (sessId: string) => {
    const assignedSmeId = schedule[sessId];
    if (!assignedSmeId) return;
    setApproved(p => {
      if (!p[sessId]) return p;
      const next = { ...p };
      delete next[sessId];
      return next;
    });
    setOverrides(p => ({ ...p, [sessId]: null }));
    removeScheduledEvent(sessId);
    setHasRunMatch(false);
    setTimeout(() => runMatch(), 100);
  };

  // Write an approved session event to the assigned SME's Google Calendar state
  const writeToCalendar = (sessId: string, smeId: string) => {
    const sess = sessions.find(s => s.id === sessId);
    if (!sess) return;
    removeScheduledEvent(sessId);
    const newEvent: CalendarEvent = {
      startTime: sess.startTime,
      title: `${sess.title} (IK Scheduled)`,
      isScheduled: true,
      sessionId: sessId,
    };
    setCalendarEvents(prev => ({
      ...prev,
      [smeId]: [...(prev[smeId] || []), newEvent],
    }));
  };

  const approveOne = async (sessId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const asgn = assignments.find(a => a.sessionId === sessId);
    const critFlag = asgn?.conflicts.find(c => c.severity === "CRITICAL");
    if (critFlag) {
      alert(`⚠️ Cannot Approve Session!\n\nReason: ${critFlag.reason}\n\nPlease reschedule the session or assign an available instructor.`);
      return;
    }
    const smeId = schedule[sessId];
    if (smeId && !approved[sessId]) {
      setApproved(p => ({ ...p, [sessId]: true }));
      writeToCalendar(sessId, smeId);
      try {
        await fetch("/api/schedule/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionIds: [sessId],
            schedule,
            sessions: sessions.map(sess => ({
              id: sess.id,
              title: sess.title,
              startTime: sess.startTime,
              durationHours: sess.durationHours,
            })),
          }),
        });
      } catch {}
    }
  };

  const approveAll = async () => {
    const batch: Record<string, true> = {};
    const approvedSessionIds: string[] = [];
    assignments.forEach(a => {
      const hasCrit = a.conflicts.some(c => c.severity === "CRITICAL");
      if (schedule[a.sessionId] && !hasCrit && a.status !== "CONFLICT" && !approved[a.sessionId] && weeklySessions.some(s => s.id === a.sessionId)) {
        batch[a.sessionId] = true;
        approvedSessionIds.push(a.sessionId);
        if (a.smeId) writeToCalendar(a.sessionId, a.smeId);
      }
    });
    setApproved(p => ({ ...p, ...batch }));
    try {
      await fetch("/api/schedule/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: approvedSessionIds,
          schedule,
          sessions: sessions.map(sess => ({
            id: sess.id,
            title: sess.title,
            startTime: sess.startTime,
            durationHours: sess.durationHours,
          })),
        }),
      });
    } catch {}
    try { confetti({ particleCount: 60, spread: 40, origin: { y: 0.7 } }); } catch {}
  };

  const dropSme = (smeId: string) => {
    setSmes(p => p.map(s => s.id === smeId ? { ...s, availableSlots: [], maxWeeklyHours: 0 } : s));
    setOverrides(p => { const n = { ...p }; Object.keys(n).forEach(k => { if (n[k] === smeId) delete n[k]; }); return n; });
    setApproved(p => {
      const next = { ...p };
      sessions.forEach(sess => {
        if (schedule[sess.id] === smeId) delete next[sess.id];
      });
      return next;
    });
    removeScheduledEventsForSme(smeId);
    runMatch();
  };

  const readyToApprove = assignments.filter(a => schedule[a.sessionId] && a.status === "OPTIMAL" && !approved[a.sessionId] && weeklySessions.some(s => s.id === a.sessionId)).length;

  // Sessions grouped by day
  const byDay = useMemo(() => {
    const g: Record<string, Session[]> = {};
    DAYS.forEach(d => { 
      g[d] = weeklySessions.filter(s => s.dayOfWeek === d && (modeFilter === "ALL" || s.mode === modeFilter)); 
    });
    return g;
  }, [weeklySessions, modeFilter]);

  // CSV upload handler
  const handleIngestCSV = (csvText: string) => {
    try {
      const lines = csvText.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length <= 1) return;
      
      const headers = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, ''));
      const newSessList: Session[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim().replace(/^["']|["']$/g, ''));
        if (values.length < headers.length) continue;
        
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx];
        });
        
        const id = `sess-csv-${Date.now()}-${i}`;
        const title = row.title || "Untitled Session";
        const cohortName = row.cohortName || "Manual Batch";
        const topic = row.topic || "System Design";
        const minSmeTier = (row.minSmeTier || "Standard SME") as Session["minSmeTier"];
        const startTime = row.startTime || "2026-08-10 10:00";
        const durationHours = Number(row.durationHours) || 2;
        const mode = (row.mode || "Cohort Class") as Session["mode"];
        const timeZone = row.timeZone || "US/Pacific";
        
        const requiredSkills = row.requiredSkills 
          ? row.requiredSkills.split(";").map(s => s.trim()).filter(Boolean)
          : [];
          
        const dateObj = new Date(startTime.split(' ')[0] + "T00:00:00");
        const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' }) as Session["dayOfWeek"];
        
        let priority: 1 | 2 | 3 = 3;
        if (mode === "Cohort Class") priority = 1;
        else if (mode === "Mock Interview") priority = 2;

        newSessList.push({
          id,
          title,
          cohortName,
          topic,
          requiredSkills,
          minSmeTier,
          startTime,
          dayOfWeek: weekday,
          durationHours,
          mode,
          timeZone,
          priority
        });
      }
      
      if (newSessList.length > 0) {
        setSessions(prev => [...prev, ...newSessList]);
        setUploadModalOpen(false);
        setHasRunMatch(false);
        alert(`Successfully ingested ${newSessList.length} sessions from spreadsheet!`);
      }
    } catch {
      alert("Failed to parse CSV. Please check formatting.");
    }
  };

  if (role === "SME") {
    const portalSme = smes.find(s => s.id === portalSmeId) ?? smes[0];
    const portalCalendar = calendarEvents[portalSme.id] || [];
    const portalApprovedSessions = sessions.filter(sess => schedule[sess.id] === portalSme.id && (approved[sess.id] || sess.completed));
    const portalUpcomingSessions = sessions.filter(sess => schedule[sess.id] === portalSme.id && !approved[sess.id] && !sess.completed);
    const nextSession = portalApprovedSessions[0] ?? portalUpcomingSessions[0] ?? null;

    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#F8F9FC" }}>
        <header className="h-14 flex items-center px-5 gap-4 flex-shrink-0 border-b border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 select-none">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" style={{ background: "#1E3A8A" }}>
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-black text-slate-900 tracking-tight leading-none">Interview Kickstart</div>
              <div className="text-[10px] font-semibold text-slate-400 leading-none mt-0.5">SME Portal</div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
              <button
                onClick={() => setRole("OPS")}
                className="px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 text-slate-500 hover:text-slate-800"
              >
                <Shield className="w-3.5 h-3.5" />
                Ops Team
              </button>
              <button
                onClick={() => setRole("SME")}
                className="px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 bg-white text-[#1E3A8A] shadow-sm"
              >
                <Users className="w-3.5 h-3.5" />
                SME
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 anim-fade bg-[#F8F9FC]">
          <div className="max-w-4xl mx-auto space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[#1E3A8A]">SME Portal</div>
                <h1 className="text-xl font-black text-slate-900 mt-1">My Day</h1>
                <p className="text-xs text-slate-500 mt-1">One place to see what’s booked, what to prep, and what to flag.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRole("OPS")}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 transition"
                >
                  Switch to Ops
                </button>
                <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600">
                  {portalApprovedSessions.length} approved
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5">
              <div className="space-y-5">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-center gap-3">
                    <img src={portalSme.avatar} className="w-14 h-14 rounded-full object-cover border-2 border-blue-200" alt="" />
                    <div className="min-w-0">
                      <div className="text-lg font-black text-slate-900">{portalSme.name}</div>
                      <div className="text-xs text-slate-500">{portalSme.tier} · {portalSme.timeZone}</div>
                      <div className="text-[11px] text-slate-400 mt-1">Cap {portalSme.maxWeeklyHours}h · Rolling {portalSme.rolling4WeekHours}h</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-black text-slate-900">Next session</h2>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {nextSession ? (approved[nextSession.id] || nextSession.completed ? "Approved" : "Upcoming") : "None"}
                    </span>
                  </div>
                  {nextSession ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <div>
                        <div className="text-xs font-black text-[#1E3A8A] uppercase tracking-widest">{nextSession.mode}</div>
                        <div className="text-base font-black text-slate-900 mt-1">{nextSession.title}</div>
                        <div className="text-xs text-slate-500 mt-1">{nextSession.cohortName}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-white border border-slate-200 p-3">
                          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black">When</div>
                          <div className="font-bold text-slate-900 mt-1">{nextSession.dayOfWeek} {nextSession.startTime.split(" ")[1]}</div>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200 p-3">
                          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black">Duration</div>
                          <div className="font-bold text-slate-900 mt-1">{nextSession.durationHours}h</div>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white border border-slate-200 p-3 text-xs text-slate-600">
                        <span className="font-black text-slate-900">Prep:</span> {nextSession.topic} · {nextSession.requiredSkills.join(", ") || "No special skills listed"}
                      </div>
                      {(approved[nextSession.id] || nextSession.completed) && (
                        <button
                          onClick={() => dropApprovedSession(nextSession.id)}
                          className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition"
                        >
                          I need to cancel this session
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">No session assigned yet.</div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-black text-slate-900">Upcoming sessions</h2>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{portalUpcomingSessions.length}</span>
                  </div>
                  {portalUpcomingSessions.length === 0 ? (
                    <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">Nothing else on your plate right now.</div>
                  ) : (
                    <div className="space-y-2">
                      {portalUpcomingSessions.map(sess => (
                        <button
                          key={sess.id}
                          onClick={() => dropApprovedSession(sess.id)}
                          className="w-full text-left rounded-xl border border-slate-200 p-3 hover:border-red-200 hover:bg-red-50/40 transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate">{sess.title}</div>
                              <div className="text-xs text-slate-500 mt-1">{sess.dayOfWeek} {sess.startTime.split(" ")[1]} · {sess.mode} · {sess.cohortName}</div>
                            </div>
                            <span className="text-[10px] font-black text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 flex-shrink-0">Cancel</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <div className="text-[10px] font-black uppercase tracking-widest text-blue-700">Booked</div>
                    <div className="text-3xl font-black text-blue-900 mt-1">{portalApprovedSessions.length}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Calendar blocks</div>
                    <div className="text-3xl font-black text-slate-900 mt-1">{portalCalendar.filter(ev => !ev.isScheduled).length}</div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                  <h2 className="font-black text-slate-900">What to do</h2>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 leading-relaxed">
                    Check the next session card first. If something conflicts, cancel that session here and ops will get the drop-out automatically.
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 leading-relaxed">
                    Keep this view calm: only the next action and the most relevant session list are shown. Calendar detail stays hidden unless it matters.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F8F9FC" }}>

      {/* ══════════ HEADER ══════════ */}
      <header className="h-14 flex items-center px-5 gap-4 flex-shrink-0 border-b border-slate-200 bg-white shadow-sm">
        {/* Brand */}
        <div className="flex items-center gap-2.5 select-none">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" style={{ background: "#1E3A8A" }}>
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-black text-slate-900 tracking-tight leading-none">Interview Kickstart</div>
            <div className="text-[10px] font-semibold text-slate-400 leading-none mt-0.5">Ops Scheduling Studio</div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-slate-200" />

        {/* Nav Tabs */}
        <nav className="flex items-center gap-1">
          {([
            { id: "SCHEDULE", icon: <Calendar className="w-3.5 h-3.5" />, label: "Weekly Schedule" },
            { id: "ISSUES",   icon: <AlertTriangle className="w-3.5 h-3.5" />, label: `Issues (${weeklyConflicts.length})` },
            { id: "SME",      icon: <Users className="w-3.5 h-3.5" />, label: `SME Pool (${smes.length})` },
          ] as { id: OpsView; icon: React.ReactNode; label: string }[]).map(t => {
            const isIssues = t.id === "ISSUES";
            const badgeCount = weeklyConflicts.length;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative ${
                  view === t.id
                    ? "text-[#1E3A8A] bg-blue-50 border border-blue-200"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}
              >
                {t.icon}{t.label}
                {isIssues && badgeCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center -mr-1">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button
              onClick={() => setRole("OPS")}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                role === "OPS" ? "bg-white text-[#1E3A8A] shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Ops Team
            </button>
            <button
              onClick={() => setRole("SME")}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                isSmeRole ? "bg-white text-[#1E3A8A] shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              SME
            </button>
          </div>

          {role === "OPS" && view !== "SME" && readyToApprove > 0 && !isPastWeek && (
            <button
              onClick={approveAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all shadow-sm"
              style={{ background: "#059669" }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve Ready ({readyToApprove})
            </button>
          )}
          {role === "OPS" && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Demo
            </button>
          )}
          {role === "OPS" && !isPastWeek && (
            <button
              onClick={runMatch}
              disabled={running}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
              style={{ background: running ? "#CBD5E1" : "#FF5A1F" }}
            >
              <Sparkles className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
              {running ? "Matching…" : "Smart Schedule"}
            </button>
          )}
        </div>
      </header>

      {/* ══════════ STATUS BAR + WORKFLOW GUIDE ══════════ */}
      <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center gap-4 flex-shrink-0">
        {/* Workflow Steps */}
        <div className="flex items-center gap-2 mr-2">
          <StepBadge n={1} label="Auto-Match" done={weeklyFilled > 0} active={!running && weeklyFilled === 0} />
          <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
          <StepBadge n={2} label="Fix Flags" done={crits === 0 && warns === 0 && weeklyFilled > 0} active={crits > 0 || warns > 0} />
          <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
          <StepBadge n={3} label="Approve" done={appCnt >= weeklyFilled && weeklyFilled > 0} active={appCnt < weeklyFilled && crits === 0 && weeklyFilled > 0} />
        </div>

        <div className="h-5 w-px bg-slate-200" />

        {/* KPI pills */}
        <Pill color="#1E3A8A" label="Sessions" value={weeklyTotal} />
        <Pill color="#059669" label="Matched" value={`${pct}%`} />
        <Pill color={crits > 0 ? "#DC2626" : "#059669"} label="Gaps" value={crits} />
        <Pill color={warns > 0 ? "#D97706" : "#059669"} label="Workload Alerts" value={warns} />
        <Pill color="#7C3AED" label="Approved" value={`${appCnt}/${weeklyFilled}`} />

        <div className="flex-1" />

        {/* Mode filter */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5 border border-slate-200">
          {["ALL", "Cohort Class", "Mock Interview", "Doubt Clearing"].map(m => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${
                modeFilter === m ? "bg-white text-[#1E3A8A] shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {m === "ALL" ? "All" : m === "Cohort Class" ? "Cohort" : m === "Mock Interview" ? "Mock" : "Doubt"}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════ MAIN CONTENT AREA ══════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ─── SCHEDULE VIEW (Contains Grid & Table Toggle) ─── */}
        {role === "OPS" && view === "SCHEDULE" && (
          <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
            {/* Toolbar: Week Navigator + View Layout Switcher (Grid vs Table) */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <button 
                  onClick={prevWeek}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
                >
                  ← Prev Week
                </button>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">Week Calendar</span>
                  <span className="text-sm font-black text-slate-800 mt-1">{weekRangeStr}</span>
                </div>
                <button 
                  onClick={nextWeek}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
                >
                  Next Week →
                </button>
              </div>

              {/* View Layout Toggle (Grid vs Table) + Action Buttons */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Layout Mode Switcher */}
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                  <button
                    onClick={() => setScheduleLayout("WEEK")}
                    className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold transition-all ${
                      scheduleLayout === "WEEK" ? "bg-white text-[#1E3A8A] shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" /> Week Grid
                  </button>
                  <button
                    onClick={() => setScheduleLayout("TABLE")}
                    className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold transition-all ${
                      scheduleLayout === "TABLE" ? "bg-white text-[#1E3A8A] shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" /> Table List
                  </button>
                </div>

                {isPastWeek && (
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-black rounded-lg flex items-center gap-1">
                    <Clock className="w-3 h-3" /> COMPLETED WEEK
                  </span>
                )}
                
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={() => setAddSessionModalOpen(true)}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-[#1E3A8A] hover:bg-blue-50 rounded-lg text-xs font-bold transition flex items-center gap-1"
                  >
                    + Add Session
                  </button>
                  <button 
                    onClick={() => setUploadModalOpen(true)}
                    className="px-3 py-1.5 bg-[#1E3A8A] text-white hover:bg-blue-900 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm"
                  >
                    Upload Sheet
                  </button>
                </div>
              </div>
            </div>

            {/* Layout 1: 7-Day Column Grid */}
            {scheduleLayout === "WEEK" && (
              <div className="grid grid-cols-7 gap-3 min-w-[900px] flex-1">
                {DAYS.map((day, i) => {
                  const dayDate = new Date(currentWeekStart + "T00:00:00");
                  dayDate.setDate(dayDate.getDate() + i);
                  const dateStr = dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const daySessions = byDay[day] ?? [];
                  return (
                    <div key={day} className="flex flex-col gap-2">
                      <div className="text-center py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm flex flex-col items-center">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{day.slice(0,3)}</div>
                        <div className="text-xs font-bold text-slate-800">{dateStr}</div>
                        {daySessions.length > 0 && (
                          <div className="text-[9px] font-bold mt-0.5 px-1.5 rounded-full bg-slate-100 text-slate-500">
                            {daySessions.length} session{daySessions.length > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>

                      {daySessions.length === 0 && (
                        <div className="border-2 border-dashed border-slate-200 rounded-xl h-24 flex items-center justify-center">
                          <span className="text-[10px] text-slate-300 font-semibold">No sessions</span>
                        </div>
                      )}

                      {daySessions.map(sess => {
                        const activeSmeId = schedule[sess.id] || null;
                        const assignedSme = smes.find(s => s.id === activeSmeId);
                        const asgn = assignments.find(a => a.sessionId === sess.id);
                        const displayAsgn = hasRunMatch && activeSmeId === (asgn?.smeId || null) ? asgn : null;
                        const isCrit = displayAsgn?.conflicts.some(c => c.severity === "CRITICAL");
                        const isWarn = displayAsgn?.conflicts.some(c => c.severity === "WARNING");
                        const isApproved = approved[sess.id] || sess.completed;
                        const isSelected = selected === sess.id;
                        const cfg = MODE_CFG[sess.mode] ?? MODE_CFG["Cohort Class"];

                        return (
                          <div
                            key={sess.id}
                            onClick={() => { setSelected(sess.id); setInspectorOpen(true); }}
                            className={`session-card rounded-xl border cursor-pointer flex flex-col gap-2 overflow-hidden ${isSelected ? "selected" : ""} ${sess.completed ? "opacity-80" : ""}`}
                            style={{
                              background: isCrit ? "#FEF2F2" : isApproved ? "#F0FDF4" : "white",
                              borderColor: isCrit ? "#FCA5A5" : isApproved ? "#86EFAC" : isSelected ? "#1E3A8A" : "#E2E8F0",
                            }}
                          >
                            <div
                              className="px-3 pt-2.5 pb-2 flex items-center gap-1.5"
                              style={{ borderBottom: `2px solid ${cfg.color}20` }}
                            >
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
                              <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: cfg.color }}>
                                {cfg.label}
                              </span>
                              <div className="flex-1" />
                              <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1 rounded uppercase">P{sess.priority}</span>
                              {isApproved && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                              {isCrit && <AlertTriangle className="w-3 h-3 text-red-500" />}
                              {isWarn && !isCrit && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                            </div>

                            <div className="px-2.5 pb-2.5 flex flex-col gap-2">
                              <div>
                                <div className="flex items-center gap-1 text-slate-400 mb-0.5">
                                  <Clock className="w-[10px] h-[10px]" />
                                  <span className="text-[9px] font-bold">{sess.startTime.split(" ")[1]} · {sess.durationHours}h</span>
                                </div>
                                <div className="text-[10px] font-bold text-slate-800 leading-tight line-clamp-2">
                                  {sess.title}
                                </div>
                              </div>

                              <div
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  if (!sess.completed && !isPastWeek) setAssignModalOpen(sess.id); 
                                }}
                                className="group cursor-pointer"
                              >
                                {assignedSme ? (
                                  <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50 transition-colors">
                                    <img src={assignedSme.avatar} className="w-5 h-5 rounded-full object-cover flex-shrink-0" alt="" />
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[10px] font-bold text-slate-800 truncate">{assignedSme.name}</div>
                                      <div className="text-[9px] text-slate-400">{displayAsgn ? `${displayAsgn.score}% fit` : "Manual"}</div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-1.5 bg-white rounded-lg px-2 py-1.5 border border-dashed border-slate-300 text-slate-500 group-hover:border-blue-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-colors">
                                    <span className="text-[14px] leading-none">+</span>
                                    <span className="text-[10px] font-bold">Assign SME</span>
                                  </div>
                                )}
                              </div>

                              {!isApproved && !isCrit && assignedSme && !isPastWeek && (
                                <div className="space-y-1">
                                  <button
                                    onClick={(e) => approveOne(sess.id, e)}
                                    className="w-full py-1 rounded-lg text-[10px] font-bold border transition-all"
                                    style={{ borderColor: "#1E3A8A", color: "#1E3A8A", background: "transparent" }}
                                    onMouseEnter={e => { (e.target as HTMLElement).style.background = "#EFF6FF"; }}
                                    onMouseLeave={e => { (e.target as HTMLElement).style.background = "transparent"; }}
                                  >
                                    ✓ Approve
                                  </button>
                                  <a
                                    href={generateGoogleCalendarUrl({
                                      topic: sess.topic,
                                      track: sess.cohortName,
                                      start_time_utc: new Date(sess.startTime.replace(" ", "T") + ":00").toISOString(),
                                      duration_hours: sess.durationHours,
                                    })}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block w-full py-1 rounded-lg text-[10px] font-bold text-center border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all"
                                  >
                                    Add to Google Calendar
                                  </a>
                                </div>
                              )}

                              {isApproved && (
                                <div className="w-full py-1 rounded-lg text-[10px] font-bold text-center bg-emerald-50 border border-emerald-200 text-emerald-800">
                                  {sess.completed ? "✓ Completed" : "✓ Approved"}
                                </div>
                              )}

                              {!sess.completed && !isPastWeek && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setRescheduleModalOpen(sess.id); }}
                                  className="w-full py-1 rounded-lg text-[9px] font-bold border border-slate-200 hover:bg-slate-50 text-slate-500 transition-all text-center"
                                >
                                  ✎ Reschedule
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Layout 2: Prioritized Table List */}
            {scheduleLayout === "TABLE" && (
              <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-xl border border-slate-200 shadow-xs">
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b-2 border-slate-200">
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest w-8"></th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Day</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Time</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Session</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Priority</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Mode</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Req Tier</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Assigned SME</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Fit Score</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                        <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(() => {
                        const sortedTableSessions = [...weeklySessions]
                          .filter(s => modeFilter === "ALL" || s.mode === modeFilter)
                          .sort((a, b) => {
                            const aAsgn = assignments.find(x => x.sessionId === a.id);
                            const bAsgn = assignments.find(x => x.sessionId === b.id);
                            const aIsCrit = aAsgn?.conflicts.some(c => c.severity === "CRITICAL") ? 1 : 0;
                            const bIsCrit = bAsgn?.conflicts.some(c => c.severity === "CRITICAL") ? 1 : 0;
                            const aIsUnassigned = !schedule[a.id] ? 1 : 0;
                            const bIsUnassigned = !schedule[b.id] ? 1 : 0;
                            const aErrScore = aIsCrit * 2 + aIsUnassigned;
                            const bErrScore = bIsCrit * 2 + bIsUnassigned;
                            if (aErrScore !== bErrScore) return bErrScore - aErrScore;
                            if (a.priority !== b.priority) return a.priority - b.priority;
                            return a.startTime.localeCompare(b.startTime);
                          });
                        return sortedTableSessions.map((sess, idx) => {
                          const activeSmeId = schedule[sess.id] || null;
                          const assignedSme = smes.find(s => s.id === activeSmeId);
                          const asgn = assignments.find(a => a.sessionId === sess.id);
                          const displayAsgn = hasRunMatch && activeSmeId === (asgn?.smeId || null) ? asgn : null;
                          const isCrit = displayAsgn?.conflicts.some(c => c.severity === "CRITICAL");
                          const isWarn = displayAsgn?.conflicts.some(c => c.severity === "WARNING");
                          const isApp = approved[sess.id] || sess.completed;
                          const isSel = selected === sess.id;
                          const cfg = MODE_CFG[sess.mode];
                          return (
                            <tr
                              key={sess.id}
                              onClick={() => { setSelected(sess.id); setInspectorOpen(true); }}
                              className={`cursor-pointer transition-colors ${isSel ? "bg-blue-50" : isCrit ? "bg-red-50/40" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-blue-50/40`}
                              style={{ borderLeft: isSel ? "3px solid #1E3A8A" : "3px solid transparent" }}
                            >
                              <td className="px-3 py-3.5">
                                {isApp ? <Check className="w-4 h-4 text-emerald-500" /> : <div className="w-4 h-4 rounded border border-slate-200" />}
                              </td>
                              <td className="px-4 py-3.5 text-xs font-bold text-slate-600">{sess.dayOfWeek.slice(0,3)}</td>
                              <td className="px-4 py-3.5 font-mono text-xs font-bold text-slate-800">{sess.startTime.split(" ")[1]}</td>
                              <td className="px-4 py-3.5 max-w-[220px]">
                                <div className="text-xs font-bold text-slate-900 truncate">{sess.title}</div>
                                <div className="text-[10px] text-slate-400 truncate">{sess.cohortName}</div>
                              </td>
                              <td className="px-4 py-3.5">
                                <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">Priority {sess.priority}</span>
                              </td>
                              <td className="px-4 py-3.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: cfg?.bg, color: cfg?.color }}>
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg?.color }} />
                                  {cfg?.label}
                                </span>
                              </td>
                              <td className="px-4 py-3.5 text-[11px] text-slate-600 font-medium">{sess.minSmeTier}</td>
                              <td className="px-4 py-3.5">
                                {assignedSme ? (
                                  <div className="flex items-center gap-2">
                                    <img src={assignedSme.avatar} className="w-6 h-6 rounded-full object-cover border border-slate-200" alt="" />
                                    <span className="text-xs font-bold text-slate-800">{assignedSme.name}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs font-bold text-red-600">— Unassigned —</span>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                {displayAsgn && displayAsgn.score > 0 && (
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full score-fill" style={{ width: `${displayAsgn.score}%`, background: displayAsgn.score >= 70 ? "#059669" : displayAsgn.score >= 50 ? "#D97706" : "#DC2626" }} />
                                    </div>
                                    <span className="text-[10px] font-black text-slate-600">{displayAsgn.score}%</span>
                                  </div>
                                )}
                                {!displayAsgn && activeSmeId && <span className="text-[10px] font-bold text-slate-400">Manual</span>}
                              </td>
                              <td className="px-4 py-3.5">
                                {isCrit ? <StatusBadge color="red" label="Gap" icon={<AlertTriangle className="w-3 h-3" />} />
                                  : isWarn ? <StatusBadge color="amber" label="Overloaded" icon={<AlertTriangle className="w-3 h-3" />} />
                                  : sess.completed ? <StatusBadge color="slate" label="Completed" icon={<Check className="w-3 h-3" />} />
                                  : isApp ? <StatusBadge color="green" label="Approved" icon={<CheckCircle2 className="w-3 h-3" />} />
                                  : displayAsgn && activeSmeId ? <StatusBadge color="blue" label="Ready" icon={<CheckCircle2 className="w-3 h-3" />} />
                                  : activeSmeId ? <StatusBadge color="blue" label="Manual" icon={<CheckCircle2 className="w-3 h-3" />} />
                                  : <StatusBadge color="slate" label="Pending" icon={<Clock className="w-3 h-3" />} />
                                }
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex gap-2">
                                  {!isApp && !isCrit && assignedSme && !isPastWeek && (
                                    <button onClick={(e) => approveOne(sess.id, e)} className="px-2.5 py-1 text-[10px] font-black rounded-lg border transition-all hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700" style={{ borderColor: "#E2E8F0", color: "#475569" }}>
                                      ✓ Approve
                                    </button>
                                  )}
                                  {!sess.completed && !isPastWeek && (
                                    <button onClick={(e) => { e.stopPropagation(); setRescheduleModalOpen(sess.id); }} className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                                      Reschedule
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── ISSUES VIEW (Ops Conflict Resolution Center) ─── */}
        {view === "ISSUES" && (
          <div className="flex-1 overflow-y-auto p-6 anim-fade bg-[#F8F9FC]">
            <div className="max-w-5xl mx-auto space-y-6">
              
              {/* Header Banner */}
                <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <div>
                    <div className="text-[10px] font-black text-[#FF5A1F] uppercase tracking-widest">Ops Resolution Hub</div>
                    <h1 className="text-xl font-black text-slate-900 mt-0.5">Active Scheduling Conflicts & Gaps</h1>
                    <p className="text-xs text-slate-500 mt-1">
                    Review priority-ranked conflicts, then pick the quickest safe unblock path.
                    </p>
                  </div>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-center">
                    <div className="text-lg font-black text-red-600 leading-none">{crits}</div>
                    <div className="text-[9px] font-bold text-red-700 mt-0.5">Critical Gaps</div>
                  </div>
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-center">
                    <div className="text-lg font-black text-amber-600 leading-none">{warns}</div>
                    <div className="text-[9px] font-bold text-amber-700 mt-0.5">Workload Alerts</div>
                  </div>
                </div>
              </div>

              {/* Conflict List */}
              <div className="space-y-3">
                <h3 className="font-black text-sm text-slate-900 uppercase tracking-wider text-[11px]">
                  Priority-Ranked Issues ({weeklyConflicts.length})
                </h3>

                {weeklyConflicts.length === 0 ? (
                  <div className="bg-white border border-emerald-200 rounded-2xl p-8 text-center space-y-2 shadow-sm">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                    <h4 className="font-black text-slate-900 text-sm">No Active Conflicts Found!</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      All sessions in the current week have valid, conflict-free instructor assignments meeting tier and availability rules.
                    </p>
                  </div>
                ) : (
                  weeklyConflicts.map(conf => {
                    const sess = sessions.find(s => s.id === conf.sessionId);
                    if (!sess) return null;
                    const isCrit = conf.severity === "CRITICAL";
                    const modeInfo = MODE_CFG[sess.mode];

                    return (
                      <div key={conf.id} className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 transition-all ${isCrit ? "border-red-200 hover:border-red-300" : "border-amber-200 hover:border-amber-300"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-xl flex-shrink-0 ${isCrit ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                              <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase text-white ${isCrit ? "bg-red-600" : "bg-amber-500"}`}>
                                  {conf.severity}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">
                                  Priority {sess.priority} ({modeInfo.label})
                                </span>
                                <span className="text-xs font-bold text-slate-900">{sess.title}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1">
                                {sess.cohortName} • {sess.dayOfWeek} at {sess.startTime.split(" ")[1]} ({sess.durationHours}h)
                              </div>
                            </div>
                          </div>

                          <div className="flex-shrink-0 text-right">
                            <span className="text-[10px] font-mono text-slate-400 font-semibold">{sess.timeZone}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1.05fr_0.95fr] gap-3">
                          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Session requirements</div>
                              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500">
                                {sess.mode}
                              </span>
                            </div>
                            <div className="text-sm font-bold text-slate-900">{sess.minSmeTier} minimum</div>
                            <div className="flex flex-wrap gap-1">
                              {sess.requiredSkills.length > 0 ? sess.requiredSkills.map(skill => (
                                <span key={skill} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  {skill}
                                </span>
                              )) : (
                                <span className="text-[11px] text-slate-500">No explicit skill gate</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600">Slot: {sess.dayOfWeek} {sess.startTime.split(" ")[1]} · {sess.timeZone}</div>
                          </div>

                          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-black uppercase tracking-widest text-blue-700">Recommended unblock</div>
                              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                {conf.type.replace(/_/g, " ")}
                              </span>
                            </div>
                            {(conf.remediationOptions?.length ?? 0) > 0 ? (
                              <div className="space-y-2">
                                {conf.remediationOptions!.slice(0, 3).map(option => (
                                  <div key={option.label} className="rounded-lg border border-blue-100 bg-white p-2.5 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="font-bold text-slate-900 text-sm truncate">{option.label}</div>
                                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                        option.action === "RESCHEDULE" ? "bg-orange-50 text-orange-700" :
                                        option.action === "REASSIGN" ? "bg-emerald-50 text-emerald-700" :
                                        option.action === "RELAX_TIER" ? "bg-amber-50 text-amber-700" :
                                        "bg-slate-100 text-slate-600"
                                      }`}>
                                        {option.action}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 leading-relaxed">{option.reason}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-500 bg-white border border-blue-100 rounded-lg p-3">
                                No safe unblock path computed yet. Escalate for manual review.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-100 bg-white p-3 text-xs text-slate-700 leading-relaxed font-medium">
                          <strong className="text-slate-900">Why blocked: </strong> {conf.reason}
                        </div>

                        {/* 1-Click Resolution Shortcuts */}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                          <span className="text-[10px] font-bold text-slate-400">Quick Resolution Actions:</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setRescheduleModalOpen(sess.id)}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
                            >
                              ✎ Reschedule
                            </button>
                            <button
                              onClick={() => emergencyDowngrade(sess.id)}
                              className="px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-800 transition"
                            >
                              ⚡ Lower Tier Req
                            </button>
                            <button
                              onClick={() => setAssignModalOpen(sess.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1E3A8A] hover:bg-blue-900 transition shadow-sm"
                            >
                              👤 Assign Available SME
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Edge Cases Design Overview Card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Shield className="w-5 h-5 text-[#1E3A8A]" />
                  <h3 className="font-black text-slate-900 text-sm">Assessment Edge Cases & System Resolution Rules</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-900 text-[11px]">1. Last-Minute SME Drop-outs</div>
                    <p className="text-slate-600 text-[10px] leading-relaxed">
                      Ops triggers &quot;Drop SME&quot; on instructor card. Engine immediately revokes assignments, raises Priority 1 Critical Flags, and suggests auto-reassignment to secondary candidates.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-900 text-[11px]">2. Sessions With No Available SME</div>
                    <p className="text-slate-600 text-[10px] leading-relaxed">
                      Flags `UNFILLED` gap with precise bottleneck reason (Google Calendar conflict vs missing skills). Ops uses 1-click Reschedule or Emergency Tier Downgrade.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-900 text-[11px]">3. Candidate Tie-Breaking</div>
                    <p className="text-slate-600 text-[10px] leading-relaxed">
                      Evaluates multi-variable score (Availability 35%, Expertise 35%, Fairness 20%, Rating 10%). Ties are broken in favor of SMEs with lower 4-week historical hours for fair rotation.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-100 bg-slate-50 space-y-1">
                    <div className="font-bold text-slate-900 text-[11px]">4. Rolling 4-Week Fairness Window</div>
                    <p className="text-slate-600 text-[10px] leading-relaxed">
                      Track historical hours over 4 weeks (target 12–16h). Instructors exceeding 24h trigger a `FAIRNESS_VIOLATION` warning to prevent burnout and rotate load.
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ─── SME PORTAL VIEW ─── */}
        {isSmeRole && (
          <div className="flex-1 overflow-y-auto p-6 anim-fade bg-[#F8F9FC]">
            <div className="max-w-5xl mx-auto space-y-5">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-[#1E3A8A]">SME Portal</div>
                    <h1 className="text-xl font-black text-slate-900 mt-1">My Assignments</h1>
                    <p className="text-xs text-slate-500 mt-1">What the instructor sees after ops approves the schedule.</p>
                  </div>
                  <button
                    onClick={() => setRole("OPS")}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 transition"
                  >
                    Back to Ops View
                  </button>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Choose SME</label>
                  <select
                    value={portalSmeId}
                    onChange={(e) => setPortalSmeId(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700"
                  >
                    {smes.map(sme => (
                      <option key={sme.id} value={sme.id}>{sme.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {(() => {
                const portalSme = smes.find(s => s.id === portalSmeId) ?? smes[0];
                const portalAssignedSessions = sessions.filter(sess => schedule[sess.id] === portalSme.id && (approved[sess.id] || sess.completed));
                const portalUpcomingSessions = sessions.filter(sess => schedule[sess.id] === portalSme.id && !approved[sess.id] && !sess.completed);
                const portalCalendar = calendarEvents[portalSme.id] || [];
                const scheduledPortalEvents = portalCalendar.filter(ev => ev.isScheduled);
                const externalPortalEvents = portalCalendar.filter(ev => !ev.isScheduled);

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
                    <div className="space-y-5">
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                        <div className="flex items-center gap-3">
                          <img src={portalSme.avatar} className="w-16 h-16 rounded-full object-cover border-2 border-blue-200" alt="" />
                          <div className="min-w-0">
                            <div className="text-lg font-black text-slate-900">{portalSme.name}</div>
                            <div className="text-xs text-slate-500">{portalSme.tier} · {portalSme.primaryDomain} · {portalSme.timeZone}</div>
                            <div className="text-[11px] text-slate-400 mt-1">Weekly cap {portalSme.maxWeeklyHours}h · Rolling 4-week load {portalSme.rolling4WeekHours}h</div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <h2 className="font-black text-slate-900">Upcoming sessions</h2>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{portalUpcomingSessions.length} pending</span>
                        </div>
                        {portalUpcomingSessions.length === 0 ? (
                          <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">No upcoming sessions assigned.</div>
                        ) : (
                          portalUpcomingSessions.map(sess => (
                            <div key={sess.id} className="rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4">
                              <div>
                                <div className="font-bold text-slate-900">{sess.title}</div>
                                <div className="text-xs text-slate-500 mt-1">{sess.mode} · {sess.cohortName}</div>
                                <div className="text-[11px] text-slate-400 mt-1">{sess.dayOfWeek} {sess.startTime.split(" ")[1]} · {sess.durationHours}h · {sess.topic}</div>
                              </div>
                                <button
                                  onClick={() => dropApprovedSession(sess.id)}
                                  className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition"
                                >
                                  Cancel
                                </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                        <h2 className="font-black text-slate-900">Approved sessions</h2>
                        {portalAssignedSessions.length === 0 ? (
                          <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">Nothing approved yet for this instructor.</div>
                        ) : (
                          portalAssignedSessions.map(sess => (
                            <div key={sess.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-bold text-slate-900">{sess.title}</div>
                                  <div className="text-xs text-slate-600 mt-1">{sess.cohortName} · {sess.mode} · {sess.startTime}</div>
                                  <div className="text-[11px] text-slate-500 mt-1">Skills: {sess.requiredSkills.join(", ") || "None"}</div>
                                </div>
                                <button
                                  onClick={() => dropApprovedSession(sess.id)}
                                  className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition flex-shrink-0"
                                >
                                  Mark Unavailable
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                        <h2 className="font-black text-slate-900">Calendar</h2>
                        <div className="grid grid-cols-1 gap-2">
                          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-blue-700">Written sessions</div>
                            <div className="text-2xl font-black text-blue-900 mt-1">{scheduledPortalEvents.length}</div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Personal busy blocks</div>
                            <div className="text-2xl font-black text-slate-900 mt-1">{externalPortalEvents.length}</div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {portalCalendar.length === 0 ? (
                            <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">No calendar items for this week.</div>
                          ) : portalCalendar.map((ev, idx) => (
                            <div key={`${ev.title}-${idx}`} className={`rounded-xl border p-3 ${ev.isScheduled ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                              <div className="text-sm font-bold text-slate-900">{ev.title}</div>
                              <div className="text-[11px] text-slate-500 mt-1">{ev.startTime}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                        <h2 className="font-black text-slate-900">Fairness summary</h2>
                        <div className="text-sm text-slate-600">This portal shows what the SME would see after assignment, including approved sessions and the option to mark a conflict before the ops team re-runs matching.</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Load</div>
                            <div className="text-xl font-black text-slate-900 mt-1">{portalAssignedSessions.reduce((sum, sess) => sum + sess.durationHours, 0)}h</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Approved</div>
                            <div className="text-xl font-black text-slate-900 mt-1">{portalAssignedSessions.length}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ─── SME POOL VIEW ─── */}
        {role === "OPS" && view === "SME" && (
          <div className="flex-1 overflow-y-auto p-6 anim-fade">
            <div className="max-w-6xl mx-auto space-y-5">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-xl font-black text-slate-900">SME Faculty Pool</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Track instructor availability, 4-week workload, and live Google Calendar sync status.
                  </p>
                </div>
                <button 
                  onClick={() => setAddSmeModalOpen(true)}
                  className="px-4 py-2 bg-[#1E3A8A] text-white hover:opacity-90 font-bold rounded-lg text-xs transition shadow-sm"
                  >
                    + Add New Instructor
                  </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-3">
                {(() => {
                  const focusSession = sessions.find(s => s.id === selected);
                  const focusSme = focusSession ? smes.find(s => s.id === schedule[focusSession.id]) : null;
                  if (!focusSession || !focusSme) {
                    return (
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">SME Portal Preview</div>
                        <div className="text-sm font-bold text-slate-700 mt-1">Select a session in the schedule view to preview the assigned SME portal context.</div>
                      </div>
                    );
                  }

                  const assignedEvent = (calendarEvents[focusSme.id] || []).find(ev => ev.isScheduled && ev.sessionId === focusSession.id);

                  return (
                    <>
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[#1E3A8A]">SME Portal Preview</div>
                        <div className="text-sm font-black text-slate-900 mt-1 truncate">{focusSme.name} - {focusSession.title}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {focusSession.mode} - {focusSession.dayOfWeek} {focusSession.startTime.split(" ")[1]} - {focusSession.durationHours}h - {focusSession.cohortName}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          Topic: {focusSession.topic} | Required skills: {focusSession.requiredSkills.join(", ") || "None"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {approved[focusSession.id] && assignedEvent ? (
                          <button
                            onClick={() => dropApprovedSession(focusSession.id)}
                            className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition"
                          >
                            SME Cancel Session
                          </button>
                        ) : (
                          <span className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                            Ready for SME view
                          </span>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {smes.map(sme => {
                  const overloaded = sme.rolling4WeekHours >= 24;
                  const dropped = sme.maxWeeklyHours === 0;
                  const workloadPct = Math.min(100, Math.round((sme.rolling4WeekHours / 32) * 100));
                  const calEvents = calendarEvents[sme.id] || [];
                  const scheduledEvents = calEvents.filter(e => e.isScheduled);
                  const externalBusyEvents = calEvents.filter(e => !e.isScheduled);
                  const hasSyncedCal = calEvents.length > 0;
                  const tierColor = sme.tier === "Senior Faculty" ? "#1E3A8A" : sme.tier === "Lead Instructor" ? "#FF5A1F" : "#059669";

                  // Map day abbreviations to actual dates for the current week
                  const weekStartDate = new Date(currentWeekStart + "T00:00:00");
                  const dayToDate: Record<string, string> = {};
                  ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach((d, i) => {
                    const dt = new Date(weekStartDate);
                    dt.setDate(dt.getDate() + i);
                    dayToDate[d] = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); // e.g. "11 Aug"
                  });

                  // Group available slots by abbreviated day
                  const slotsByDay: Record<string, string[]> = {};
                  sme.availableSlots.forEach(slot => {
                    const [day, time] = slot.split(" ");
                    if (!slotsByDay[day]) slotsByDay[day] = [];
                    slotsByDay[day].push(time);
                  });

                  // Slots blocked by external (personal) busy blocks — only mark busy, never "conflict" unless we have something scheduled there
                  const externalBusySlotTimes = new Set(externalBusyEvents.map(ev => ev.startTime.split(" ")[1]));
                  const ikScheduledSlotTimes = new Set(scheduledEvents.map(ev => ev.startTime.split(" ")[1]));

                  const topicEntries = Object.entries(sme.topicRatings).slice(0, 3);

                  return (
                    <div key={sme.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all flex flex-col ${dropped ? "border-red-200 opacity-60" : "border-slate-200 hover:shadow-lg hover:border-blue-200"}`}>
                      {/* Accent bar */}
                      <div className="h-1 w-full" style={{ background: dropped ? "#FCA5A5" : overloaded ? "#F59E0B" : tierColor }} />

                      {/* ── HEADER ── */}
                      <div className="p-4 pb-3 flex items-start gap-3">
                        <div className="relative flex-shrink-0">
                          <img src={sme.avatar} className="w-14 h-14 rounded-full object-cover border-2" style={{ borderColor: tierColor }} alt="" />
                          {dropped && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow">
                              <X className="w-3 h-3 text-white" />
                            </div>
                          )}
                          {/* Live Cal sync dot */}
                          {!dropped && (
                            <div title={hasSyncedCal ? "Google Calendar Synced" : "No calendar connected"} className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center shadow ${hasSyncedCal ? "bg-green-400" : "bg-slate-300"}`}>
                              <Calendar className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-black text-sm text-slate-900 leading-tight truncate">{sme.name}</h3>
                          <span className="inline-block text-[9px] font-black mt-0.5 px-1.5 py-0.5 rounded text-white" style={{ background: tierColor }}>
                            {sme.tier}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
                            <span>{sme.primaryDomain}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-semibold">{sme.timeZone}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <div className="text-base font-black text-amber-500">★{sme.historicalRating.toFixed(2)}</div>
                          <div className="text-[9px] text-slate-400">Rating</div>
                        </div>
                      </div>

                      {/* ── WORKLOAD BAR ── */}
                      <div className="px-4 pb-3">
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-slate-500 font-semibold">4-Week Rolling Load</span>
                            <span className={`font-black ${overloaded ? "text-amber-700" : "text-emerald-700"}`}>
                              {sme.rolling4WeekHours}h / 32h {overloaded ? "⚠️ Heavy" : "✓ Ok"}
                            </span>
                          </div>
                          <div className="h-2.5 bg-white border border-slate-200 rounded-full overflow-hidden">
                            <div className="h-full rounded-full score-fill" style={{ width: `${workloadPct}%`, background: overloaded ? "#F59E0B" : tierColor }} />
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-400">
                            <span>Weekly cap: {sme.maxWeeklyHours}h</span>
                            <span>{sme.availableSlots.length} slot{sme.availableSlots.length !== 1 ? "s" : ""} open</span>
                          </div>
                        </div>
                      </div>

                      {/* ── AVAILABLE SLOTS ── */}
                      <div className="px-4 pb-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Available Slots</span>
                        </div>
                        {dropped ? (
                          <p className="text-[10px] text-red-400 font-bold italic">Removed from pool</p>
                        ) : Object.keys(slotsByDay).length === 0 ? (
                          <p className="text-[10px] text-slate-400 italic">No open slots this week</p>
                        ) : (
                          <div className="space-y-1.5">
                            {Object.entries(slotsByDay).map(([day, times]) => {
                              const actualDate = dayToDate[day] || day;
                              return (
                                <div key={day} className="flex items-start gap-2 flex-wrap">
                                  <div className="flex-shrink-0 text-right w-14">
                                    <div className="text-[9px] font-black text-slate-600">{day}</div>
                                    <div className="text-[8px] text-slate-400">{actualDate}</div>
                                  </div>
                                  <div className="flex gap-1 flex-wrap">
                                    {times.map(t => {
                                      const isExternalBusy = externalBusySlotTimes.has(t);
                                      const isIkScheduled = ikScheduledSlotTimes.has(t);
                                      return (
                                        <span key={t}
                                          title={isExternalBusy ? `SME has a personal commitment at ${t} — slot blocked` : isIkScheduled ? `IK session approved at ${t}` : `Available on ${day} ${actualDate} at ${t}`}
                                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold border cursor-default
                                            ${ isIkScheduled
                                              ? "bg-blue-50 text-blue-700 border-blue-200"
                                              : isExternalBusy
                                              ? "bg-slate-50 text-slate-400 border-slate-200 line-through"
                                              : "bg-emerald-50 text-emerald-700 border-emerald-100"
                                            }`}>
                                          {isIkScheduled ? "✓ " : ""}{isExternalBusy ? "Busy" : t}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* ── GOOGLE CALENDAR ── */}
                      <div className="mx-4 mb-3 rounded-xl overflow-hidden border border-slate-100">
                        <div className={`flex items-center gap-2 px-3 py-2 border-b ${ scheduledEvents.length > 0 ? "bg-blue-50 border-blue-100" : externalBusyEvents.length > 0 ? "bg-slate-50 border-slate-100" : "bg-slate-50 border-slate-100"}`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ scheduledEvents.length > 0 ? "bg-blue-400" : externalBusyEvents.length > 0 ? "bg-slate-400" : "bg-slate-300"}`} />
                          <span className="text-[9px] font-black uppercase tracking-widest flex-1 text-slate-500">Google Calendar</span>
                          <div className="flex items-center gap-1">
                            {scheduledEvents.length > 0 && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{scheduledEvents.length} IK booked</span>
                            )}
                            {externalBusyEvents.length > 0 && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{externalBusyEvents.length} busy block{externalBusyEvents.length > 1 ? "s" : ""}</span>
                            )}
                            {calEvents.length === 0 && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">Clear</span>
                            )}
                          </div>
                        </div>
                        <div className="divide-y divide-slate-50 bg-white">
                          {scheduledEvents.map((ev, i) => (
                            <div key={`ik-${i}`} className="flex items-center gap-2 px-3 py-2 bg-blue-50/30">
                              <div className="w-0.5 rounded-full h-7 flex-shrink-0 bg-blue-400" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-bold text-blue-900 truncate">{ev.title.replace(" (IK Scheduled)", "")}</div>
                                <div className="text-[9px] text-blue-600">{ev.startTime} · IK Session</div>
                              </div>
                              <span className="text-[8px] font-black text-blue-600 bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5">✓ Approved</span>
                            </div>
                          ))}
                          {externalBusyEvents.map((ev, i) => (
                            <div key={`busy-${i}`} className="flex items-center gap-2 px-3 py-2">
                              <div className="w-0.5 rounded-full h-7 flex-shrink-0 bg-slate-300" />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-bold text-slate-600">Busy</div>
                                <div className="text-[9px] text-slate-400">{ev.startTime} · Personal commitment</div>
                              </div>
                              <span className="text-[8px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">Blocked</span>
                            </div>
                          ))}
                          {calEvents.length === 0 && (
                            <div className="px-3 py-2 text-[10px] text-slate-400">No events this week.</div>
                          )}
                        </div>
                      </div>

                      {/* ── TOPIC EXPERTISE ── */}
                      {topicEntries.length > 0 && (
                        <div className="px-4 pb-3 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="w-3 h-3 text-slate-400" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Topic Expertise</span>
                          </div>
                          <div className="space-y-2">
                            {topicEntries.map(([topic, rating]) => (
                              <div key={topic}>
                                <div className="flex justify-between text-[9px] mb-0.5">
                                  <span className="text-slate-600 font-medium truncate max-w-[75%]">{topic}</span>
                                  <span className="font-black text-amber-500">★{rating}</span>
                                </div>
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${Math.round(((rating - 4.0) / 1.0) * 100)}%`, background: tierColor }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── SKILLS + PREFERRED MODES ── */}
                      <div className="px-4 pb-3 space-y-2 mt-auto">
                        <div className="flex flex-wrap gap-1">
                          {sme.skills.map(sk => (
                            <span key={sk} className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-blue-50 text-blue-800">
                              {sk}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {sme.preferredSessionModes.map(m => {
                            const cfg = MODE_CFG[m];
                            return (
                              <span key={m} className={`px-2 py-0.5 text-[9px] font-black rounded-full ${cfg?.badge ?? "bg-slate-100 text-slate-600"}`}>
                                ✓ {cfg?.label ?? m}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── ACTIONS ── */}
                      <div className="px-4 pb-4 flex gap-2">
                        <button 
                          onClick={() => setSmeCalendarModalOpen(sme.id)}
                          className="flex-1 py-2 rounded-xl text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all flex items-center justify-center gap-1.5"
                        >
                          <Calendar className="w-3.5 h-3.5" /> Full Calendar
                        </button>
                        {!dropped ? (
                          <button
                            onClick={() => dropSme(sme.id)}
                            className="px-3 py-2 rounded-xl text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition-all flex items-center gap-1"
                            title="Simulate Last-Minute Drop-out"
                          >
                            <UserX className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-xl text-[10px] font-black uppercase flex items-center">DROPPED</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── INSPECTOR PANEL ─── */}
        {role === "OPS" && inspectorOpen && view !== "SME" && (
          <aside className="w-[340px] flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden anim-slide">
            {/* Panel Header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50 flex-shrink-0">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#FF5A1F" }}>
                <Brain className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-black text-slate-900">AI Match Inspector</div>
                <div className="text-[10px] text-slate-400">Ops Override & Reasoning</div>
              </div>
              <button onClick={() => setInspectorOpen(false)} className="p-1 rounded hover:bg-slate-200 transition">
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selSess ? (
                <>
                  {/* Session Card */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                    <div className="px-3 py-2 flex justify-between items-center" style={{ background: MODE_CFG[selSess.mode]?.color ?? "#2563EB" }}>
                      <div>
                        <div className="text-[9px] font-black text-white/80 uppercase tracking-widest">{selSess.mode}</div>
                        <div className="text-xs font-black text-white leading-snug mt-0.5">{selSess.title}</div>
                      </div>
                      <span className="text-[10px] bg-white/20 text-white font-black px-2 py-0.5 rounded">P{selSess.priority}</span>
                    </div>
                    <div className="p-3 bg-white space-y-2 text-xs">
                      <InfoRow icon={<Clock className="w-3 h-3" />} label={`${selSess.dayOfWeek} • ${selSess.startTime} • ${selSess.durationHours}h`} />
                      <InfoRow icon={<Shield className="w-3 h-3" />} label={`Min Tier: ${selSess.minSmeTier}`} />
                      <InfoRow icon={<TrendingUp className="w-3 h-3" />} label={`Topic: ${selSess.topic}`} />
                      <div className="flex flex-wrap gap-1 pt-1">
                        {selSess.requiredSkills.map(sk => (
                          <span key={sk} className="px-2 py-0.5 text-[9px] font-bold rounded-full border bg-blue-50 text-blue-800 border-blue-200">
                            {sk}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Unassigned Callout */}
                  {!selSme && (
                    <div className="rounded-xl border border-dashed border-red-300 bg-red-50/20 p-4 text-center space-y-2">
                      <UserX className="w-8 h-8 text-red-400 mx-auto" />
                      <div className="text-xs font-bold text-slate-800">Unassigned Session</div>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        {hasRunMatch 
                          ? "The matching engine could not resolve an instructor automatically. Use overrides or reschedule the session." 
                          : "Schedule not drafted. Click 'Smart Schedule' in the header to run matches, or assign manually."}
                      </p>
                    </div>
                  )}

                  {/* Conflict flags */}
                  {(() => {
                    let activeConflicts = selAsgn?.conflicts || [];
                    if (!selAsgn && selSme) {
                      const mc: Array<{ id: string; sessionId: string; type: "FAIRNESS_VIOLATION" | "TIMEZONE_WARNING"; severity: "WARNING" | "INFO"; title: string; reason: string; suggestedSmeIds: string[] }> = [];
                      if (selSme.rolling4WeekHours >= 24) {
                        mc.push({ id: "mc-1", sessionId: selSess.id, type: "FAIRNESS_VIOLATION", severity: "WARNING", title: `Rolling Workload Alert (${selSme.name})`, reason: `${selSme.name} has taught ${selSme.rolling4WeekHours}h over the past 4 weeks. Proceed with caution.`, suggestedSmeIds: [] });
                      }
                      if (selSme.timeZone !== selSess.timeZone) {
                        mc.push({ id: "mc-2", sessionId: selSess.id, type: "TIMEZONE_WARNING", severity: "INFO", title: "Cross-Timezone Schedule", reason: `Instructor timezone (${selSme.timeZone}) differs from Session timezone (${selSess.timeZone}).`, suggestedSmeIds: [] });
                      }
                      activeConflicts = mc;
                    }
                    return activeConflicts.map(c => (
                      <div
                        key={c.id}
                        className={`rounded-xl border p-3 space-y-1.5 ${
                          c.severity === "CRITICAL"
                            ? "bg-red-50 border-red-200"
                            : c.severity === "WARNING"
                            ? "bg-amber-50 border-amber-200"
                            : "bg-blue-50 border-blue-200"
                        }`}
                      >
                        <div className={`flex items-center gap-1.5 text-xs font-black ${
                          c.severity === "CRITICAL" ? "text-red-800" : c.severity === "WARNING" ? "text-amber-800" : "text-blue-800"
                        }`}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {c.title}
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-700">{c.reason}</p>
                      </div>
                    ));
                  })()}

                  {/* AI Reasoning */}
                  {selAsgn && (
                    <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-black text-blue-900">
                        <Sparkles className="w-3.5 h-3.5 text-[#FF5A1F]" />
                        LLM Reasoning
                      </div>
                      <p className="text-[11px] text-slate-700 italic leading-relaxed">&quot;{selAsgn.llmReasoning}&quot;</p>
                    </div>
                  )}

                  {/* Resolution Toolkit */}
                  {!selSess.completed && !isPastWeek && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <div className="text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-[#FF5A1F]" /> Resolution Toolkit
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">Modify date & time or lower criteria to solve availability conflicts.</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setRescheduleModalOpen(selSess.id)}
                          className="flex-1 py-1.5 bg-white border border-slate-200 text-[#1E3A8A] hover:bg-blue-50 rounded-lg text-[10px] font-bold transition shadow-xs text-center"
                        >
                          Reschedule Date/Time
                        </button>
                        <button 
                          onClick={() => emergencyDowngrade(selSess.id)} 
                          className="flex-1 py-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-lg text-[10px] font-bold transition shadow-xs text-center"
                        >
                          Lower Tier Req
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Score bars */}
                  {selAsgn && selAsgn.score > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Match Scoring</div>
                      <ScoreRow label="Availability Check" score={selAsgn.scoreBreakdown.availabilityScore} color="#059669" />
                      <ScoreRow label="Skill & Semantic Fit" score={selAsgn.scoreBreakdown.expertiseFitScore} color="#2563EB" />
                      <ScoreRow label="Fairness (Rolling workload)" score={selAsgn.scoreBreakdown.rollingWorkloadScore} color="#D97706" />
                      <ScoreRow label="SME Topic Rating" score={selAsgn.scoreBreakdown.ratingScore} color="#7C3AED" />
                      <div className="mt-1 pt-2 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-[10px] font-semibold text-slate-400">Composite Score</span>
                        <span className="text-sm font-black" style={{ color: selAsgn.score >= 70 ? "#059669" : selAsgn.score >= 50 ? "#D97706" : "#DC2626" }}>
                          {selAsgn.score}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Manual Override */}
                  {!isPastWeek && !selSess.completed && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <span>Manual Override Options</span>
                        <div className="flex-1 h-px bg-slate-200" />
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Select an instructor below to manually override auto-matching logic.
                      </p>
                      <div className="space-y-2">
                        {smes.map(sme => {
                          const isAssigned = schedule[selSess.id] === sme.id;
                          const slot = `${selSess.dayOfWeek.slice(0, 3)} ${selSess.startTime.split(" ")[1]}`;
                          const avail = sme.availableSlots.includes(slot);
                          
                          // Google Calendar sync check
                          const syncedEvents = calendarEvents[sme.id] || [];
                          const sessionTimeKey = normalizeIcsLikeTime(selSess.startTime);
                          const hasCalendarConflict = syncedEvents.some(ev => normalizeIcsLikeTime(ev.startTime) === sessionTimeKey);

                          const tierOk = TIER_W[sme.tier] >= TIER_W[selSess.minSmeTier];
                          const dropped = sme.maxWeeklyHours === 0;
                          const matchedSkills = selSess.requiredSkills.filter(sk => sme.skills.includes(sk));
                          const skillPct = selSess.requiredSkills.length > 0
                            ? Math.round((matchedSkills.length / selSess.requiredSkills.length) * 100)
                            : 100;
                          const availabilityLabel = dropped
                            ? "Unavailable"
                            : (avail && !hasCalendarConflict) ? "Available" : "Blocked";
                          const availabilityTone = dropped
                            ? "bg-slate-200 text-slate-600"
                            : (avail && !hasCalendarConflict) ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700";

                          return (
                            <button
                              key={sme.id}
                              disabled={dropped}
                              onClick={() => assignSme(selSess.id, sme.id)}
                              className="w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all hover:border-blue-400"
                              style={{
                                borderColor: isAssigned ? "#1E3A8A" : "#E2E8F0",
                                background: isAssigned ? "#EFF6FF" : dropped ? "#F8F9FC" : "white",
                                opacity: dropped ? 0.5 : 1,
                                cursor: dropped ? "not-allowed" : "pointer",
                              }}
                            >
                              <img src={sme.avatar} className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-slate-200" alt="" />
                              <div className="flex-1 min-w-0 text-xs">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900">{sme.name}</span>
                                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-black ${availabilityTone}`}>
                                    {availabilityLabel}
                                  </span>
                                  {hasCalendarConflict && (
                                    <span className="text-[8px] px-1 py-0.5 rounded font-black bg-red-100 text-red-700" title="Google Calendar event conflict synced">CAL EVENT</span>
                                  )}
                                  {!avail && !hasCalendarConflict && !dropped && (
                                    <span className="text-[8px] px-1 py-0.5 rounded font-black bg-red-100 text-red-700">BUSY</span>
                                  )}
                                  {!tierOk && (
                                    <span className="text-[8px] px-1 py-0.5 rounded font-black bg-amber-100 text-amber-700">TIER↓</span>
                                  )}
                                  {dropped && (
                                    <span className="text-[8px] px-1 py-0.5 rounded font-black bg-slate-200 text-slate-500">DROPPED</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {sme.tier} · 4wk: {sme.rolling4WeekHours}h · ★ {sme.historicalRating}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-1">
                                  Fit {skillPct}% · Slot {slot} · {avail ? "Open on SME calendar" : "Not in SME availability"}
                                  {hasCalendarConflict ? " · Busy on Google Calendar" : ""}
                                </div>
                              </div>
                              {isAssigned
                                ? <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#1E3A8A" }}>
                                    <Check className="w-3 h-3 text-white" />
                                  </div>
                                : <div className="w-5 h-5 rounded-full border border-slate-200 flex-shrink-0" />
                              }
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs font-semibold">Select a session to inspect</div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ══════════ MODALS ══════════ */}
      
      {/* 1. Assign Instructor Modal */}
      {assignModalOpen && (() => {
        const modalSess = sessions.find(x => x.id === assignModalOpen);
        if (!modalSess) return null;
        const modalCfg = MODE_CFG[modalSess.mode] ?? MODE_CFG["Cohort Class"];
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 anim-fade" onClick={() => setAssignModalOpen(null)}>
          <div className="bg-white rounded-[24px] shadow-[0_24px_70px_rgba(15,23,42,0.24)] border border-slate-200/80 w-full max-w-[640px] overflow-hidden flex flex-col max-h-[86vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-slate-950 text-[15px] tracking-[-0.02em]">Assign Instructor</h3>
                <button onClick={() => setAssignModalOpen(null)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.02)] space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: modalCfg.bg, color: modalCfg.color }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: modalCfg.color }} /> {modalCfg.label}
                  </span>
                  <span className="text-[13px] font-extrabold tracking-[-0.02em] text-slate-900 truncate">{modalSess.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {modalSess.dayOfWeek.slice(0,3)} {modalSess.startTime.split(" ")[1]}</span>
                  <span>Min: {modalSess.minSmeTier}</span>
                  <span>Topic: {modalSess.topic}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {modalSess.requiredSkills.map(sk => (
                    <span key={sk} className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">{sk}</span>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                  {googleCalendarLive && liveGoogleSmeId ? (
                    <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />Live Google Calendar active · blocks if slot is busy at session time (IST)
                    </>
                  ) : (
                    <>Shows IK availability windows. Assignment blocked if Google Calendar event overlaps this session time.</>
                  )}
                </div>
              </div>
            </div>
            
            {/* Instructors list */}
            <div className="overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/60">
              {schedule[assignModalOpen] && (
                <button
                  onClick={() => { assignSme(assignModalOpen, null); setAssignModalOpen(null); }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-2xl border border-red-200 bg-red-50 text-red-600 font-bold transition-all hover:bg-red-100 mb-1 shadow-sm text-xs"
                >
                  <X className="w-4 h-4" /> Clear Assignment
                </button>
              )}
              {smes
                .map(sme => {
                  const s = modalSess;
                  const isAssigned = schedule[s.id] === sme.id;
                  const slot = `${s.dayOfWeek.slice(0, 3)} ${s.startTime.split(" ")[1]}`;
                  const avail = sme.availableSlots.includes(slot);
                  
                  // Google Calendar conflict check.
                  // ─ Vikram (liveGoogleSmeId): ICS events are parsed into IST by the
                  //   server-side parser, so we convert the session time → IST before comparing.
                  // ─ All other SMEs: events are mock demo data stored as raw session-local
                  //   times (same format as session.startTime), so compare directly.
                  const syncedEvents = calendarEvents[sme.id] || [];
                  const isLiveSme = liveGoogleSmeId === sme.id;
                  const sessionTimeKey = isLiveSme
                    ? getSessionStartInIst(s)
                    : normalizeIcsLikeTime(s.startTime);
                  const hasCalendarConflict = syncedEvents.some(
                    ev => !ev.isScheduled && normalizeIcsLikeTime(ev.startTime) === sessionTimeKey
                  );
                  const tierOk = TIER_W[sme.tier] >= TIER_W[s.minSmeTier];
                  const dropped = sme.maxWeeklyHours === 0;
                  const matchedSkills = s.requiredSkills.filter(sk => sme.skills.includes(sk));
                  const hasSkill = s.requiredSkills.length === 0 || matchedSkills.length > 0;
                  const skillPct = s.requiredSkills.length > 0 ? Math.round((matchedSkills.length / s.requiredSkills.length) * 100) : 100;
                  const topicRating = sme.topicRatings[s.topic] || 0;
                  const prefersMode = sme.preferredSessionModes.includes(s.mode);
                  const isEligible = avail && !hasCalendarConflict && tierOk && hasSkill && !dropped;
                  const availabilityLabel = dropped
                    ? "Unavailable"
                    : hasCalendarConflict
                      ? "Blocked"
                      : avail
                        ? "Available"
                        : "Blocked";
                  const availabilityTone = dropped
                    ? "bg-slate-200 text-slate-600"
                    : hasCalendarConflict
                      ? "bg-red-100 text-red-700"
                      : avail
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700";

                  return {
                    sme,
                    s,
                    isAssigned,
                    slot,
                    avail,
                    hasCalendarConflict,
                    tierOk,
                    dropped,
                    matchedSkills,
                    hasSkill,
                    skillPct,
                    topicRating,
                    prefersMode,
                    isEligible,
                    availabilityLabel,
                    availabilityTone
                  };
                })
                .sort((a, b) => {
                   if (a.isEligible && !b.isEligible) return -1;
                   if (!a.isEligible && b.isEligible) return 1;
                   if (a.skillPct !== b.skillPct) return b.skillPct - a.skillPct;
                   return a.sme.rolling4WeekHours - b.sme.rolling4WeekHours;
                })
                .map((item) => {
                  if (!item) return null;
                  const { sme, s, isAssigned, slot, avail, hasCalendarConflict, tierOk, dropped, skillPct, topicRating, prefersMode, isEligible, availabilityLabel, availabilityTone } = item;
                  const openSlots = sme.availableSlots.filter(openSlot => openSlot !== slot).slice(0, 3);
                  const availabilityPreview = sme.availableSlots.slice(0, 4);
                  const slotInAvailability = avail;
                  const canTakeThisSlot = avail && !hasCalendarConflict && tierOk && !dropped;
                  const ikSuitable = canTakeThisSlot && (prefersMode || s.mode === "Cohort Class");
                  const liveBusy = liveGoogleSmeId === sme.id ? hasCalendarConflict : false;
                  return (
                  <button
                    key={sme.id}
                    disabled={(!avail && !isAssigned) || hasCalendarConflict || dropped}
                    onClick={() => { assignSme(s.id, sme.id); setAssignModalOpen(null); }}
                    className="w-full flex flex-col gap-2.5 p-3.5 rounded-2xl border text-left transition-all hover:border-blue-400 hover:shadow-sm"
                    style={{
                      borderColor: isAssigned ? "#1E3A8A" : "#E2E8F0",
                      background: isAssigned ? "#F3F7FF" : ((!avail && !isAssigned) || hasCalendarConflict || dropped) ? "#F8FAFC" : "white",
                      opacity: ((!avail && !isAssigned) || hasCalendarConflict || dropped) ? 0.5 : 1,
                      cursor: ((!avail && !isAssigned) || hasCalendarConflict || dropped) ? "not-allowed" : "pointer",
                    }}
                  >
                    <div className="flex items-center gap-3 w-full">
                      <img src={sme.avatar} className="w-11 h-11 rounded-full object-cover flex-shrink-0 border border-slate-200" alt="" />
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[14px] font-extrabold tracking-[-0.02em] text-slate-900">{sme.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600">{sme.tier}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${availabilityTone}`}>
                            {availabilityLabel}
                          </span>
                          {prefersMode && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Prefers {modalCfg.label}</span>}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          Match {skillPct}% · Slot {slot} · {avail ? "Open on SME calendar" : "Not in SME availability"}
                          {hasCalendarConflict ? " · Busy on Google Calendar" : ""}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                            {liveBusy ? "Live calendar busy" : slotInAvailability ? (ikSuitable ? "IK-suitable" : "Calendar-free, not ideal") : "Open slots"}
                          </span>
                          {availabilityPreview.map(openSlot => {
                            const isSessionSlot = openSlot === slot;
                            const isBlockedHere = isSessionSlot && (!canTakeThisSlot || hasCalendarConflict || dropped);
                            const chipClass = isSessionSlot
                              ? isBlockedHere
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-300"
                              : "bg-blue-50 text-blue-700 border-blue-200";
                            return (
                              <span key={`${sme.id}-${openSlot}`} className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${chipClass}`}>
                                {isSessionSlot && isBlockedHere ? `${openSlot} blocked` : openSlot}
                              </span>
                            );
                          })}
                        </div>
                        {!avail && openSlots.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Try these slots</span>
                            {openSlots.map(openSlot => (
                              <span key={openSlot} className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                {openSlot}
                              </span>
                            ))}
                          </div>
                        )}
                        {!isEligible && (
                          <div className="flex gap-1 mt-1">
                            {hasCalendarConflict && <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-red-100 text-red-700">CAL EVENT CONFLICT</span>}
                            {!avail && !hasCalendarConflict && !dropped && <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-red-100 text-red-700">BUSY</span>}
                            {!tierOk && <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-amber-100 text-amber-700">TIER↓</span>}
                            {dropped && <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-slate-200 text-slate-500">DROPPED</span>}
                          </div>
                        )}
                      </div>
                      {isAssigned && (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#1E3A8A" }}>
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1 pl-[46px]">
                      {s.requiredSkills.map(sk => {
                        const has = sme.skills.includes(sk);
                        return (
                          <span key={sk} className={`px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${has ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-red-50 text-red-400 border-red-200 line-through"}`}>
                            {has ? "✓" : "✗"} {sk}
                          </span>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-3 pl-[46px] text-[10px] text-slate-500">
                      <span>Skill Match: <span className={`font-black ${skillPct === 100 ? "text-emerald-600" : skillPct > 0 ? "text-amber-600" : "text-red-500"}`}>{skillPct}%</span></span>
                      {topicRating > 0 && <span>Topic Rating: ★ <span className="font-black text-slate-800">{topicRating.toFixed(1)}</span></span>}
                      <span>4wk load: <span className={`font-black ${sme.rolling4WeekHours >= 24 ? "text-amber-600" : "text-slate-700"}`}>{sme.rolling4WeekHours}h</span></span>
                    </div>
                  </button>
                  );
                })}
            </div>
          </div>
        </div>
        );
      })()}

      {/* 2. Reschedule Date/Time Modal */}
      {rescheduleModalOpen && (() => {
        const s = sessions.find(x => x.id === rescheduleModalOpen);
        if (!s) return null;
        const initialDate = s.startTime.split(' ')[0];
        const initialTime = s.startTime.split(' ')[1];
        return (
          <RescheduleModalInner 
            session={s} 
            initialDate={initialDate}
            initialTime={initialTime}
            onClose={() => setRescheduleModalOpen(null)}
            onSave={(d, t) => {
              rescheduleSession(s.id, d, t);
              setRescheduleModalOpen(null);
            }}
          />
        );
      })()}

      {/* 3. CSV Ingestion Sheet Upload Modal */}
      {uploadModalOpen && (
        <UploadModalInner 
          onClose={() => setUploadModalOpen(false)}
          onUpload={handleIngestCSV}
        />
      )}

      {/* 4. Add New SME Modal */}
      {addSmeModalOpen && (
        <AddSmeModalInner 
          onClose={() => setAddSmeModalOpen(false)}
          onAdd={(newSme) => {
            const id = `sme-${smes.length + 1}`;
            const addedSme: SME = {
              id,
              name: newSme.name || "Unnamed SME",
              avatar: newSme.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
              primaryDomain: newSme.primaryDomain || "System Design",
              skills: newSme.skills || [],
              tier: newSme.tier || "Standard SME",
              timeZone: newSme.timeZone || "Asia/Kolkata",
              availableSlots: newSme.availableSlots || [],
              maxWeeklyHours: newSme.maxWeeklyHours || 8,
              rolling4WeekHours: newSme.rolling4WeekHours || 0,
              historicalRating: newSme.historicalRating || 4.7,
              topicRatings: newSme.topicRatings || {},
              preferredSessionModes: ["Cohort Class", "Mock Interview", "Doubt Clearing"]
            };
            setSmes(prev => [...prev, addedSme]);
            setAddSmeModalOpen(false);
            alert(`Instructor ${addedSme.name} added to the pool!`);
          }}
        />
      )}

      {/* 5. Add New Session Modal */}
      {addSessionModalOpen && (
        <AddSessionModalInner 
          onClose={() => setAddSessionModalOpen(false)}
          onAdd={(newSess) => {
            const id = `sess-${sessions.length + 101}`;
            const addedSess: Session = {
              id,
              title: newSess.title || "Untitled Session",
              topic: newSess.topic || "System Design",
              requiredSkills: newSess.requiredSkills || [],
              minSmeTier: newSess.minSmeTier || "Standard SME",
              startTime: newSess.startTime || "2026-08-10 10:00",
              dayOfWeek: newSess.dayOfWeek || "Monday",
              durationHours: newSess.durationHours || 2,
              mode: newSess.mode || "Cohort Class",
              timeZone: newSess.timeZone || "US/Pacific",
              cohortName: newSess.cohortName || "Manual Batch",
              priority: newSess.priority || 3
            };
            setSessions(prev => [...prev, addedSess]);
            setAddSessionModalOpen(false);
            setHasRunMatch(false);
            alert(`Session ${addedSess.title} added to schedule!`);
          }}
        />
      )}

      {/* 6. SME Calendar Sync Status Modal */}
      {smeCalendarModalOpen && (() => {
        const targetSme = smes.find(s => s.id === smeCalendarModalOpen);
        if (!targetSme) return null;
        return (
          <SmeCalendarModalInner 
            sme={targetSme}
            calendarEvents={calendarEvents[targetSme.id] || []}
            onClose={() => setSmeCalendarModalOpen(null)}
          />
        );
      })()}
      
    </div>
  );
}

/* ── Sub-components ── */

function StepBadge({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 transition-all ${
        done ? "bg-emerald-500 text-white" : active ? "text-white" : "bg-slate-200 text-slate-400"
      }`} style={active ? { background: "#FF5A1F" } : {}}>
        {done ? <Check className="w-3.5 h-3.5" /> : n}
      </div>
      <span className={`text-xs font-bold whitespace-nowrap ${done ? "text-emerald-700" : active ? "text-slate-900" : "text-slate-400"}`}>
        {label}
      </span>
    </div>
  );
}

function Pill({ color, label, value }: { color: string; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-2xs text-xs">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-slate-500 font-medium text-[11px]">{label}</span>
      <span className="font-black text-slate-900">{value}</span>
    </div>
  );
}

function StatusBadge({ color, label, icon }: { color: string; label: string; icon: React.ReactNode }) {
  const styles: Record<string, string> = {
    red: "bg-red-100 text-red-800 border-red-200",
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    green: "bg-emerald-100 text-emerald-800 border-emerald-200",
    blue: "bg-blue-100 text-blue-800 border-blue-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold ${styles[color] || styles.slate}`}>
      {icon}{label}
    </span>
  );
}

function InfoRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-600">
      <span className="text-slate-400 flex-shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function ScoreRow({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-500 font-medium">{label}</span>
        <span className="font-black text-slate-700">{score}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full score-fill" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

// Reschedule modal component
function RescheduleModalInner({ 
  session, 
  initialDate, 
  initialTime, 
  onClose, 
  onSave 
}: { 
  session: Session; 
  initialDate: string; 
  initialTime: string; 
  onClose: () => void; 
  onSave: (date: string, time: string) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);

  const targetMonthStr = useMemo(() => {
    try {
      const d = new Date(date + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } catch {
      return "";
    }
  }, [date]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="font-black text-slate-900 text-sm">Reschedule Session</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Target Timeline: {targetMonthStr || "Select Date"}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-5 space-y-4 text-xs">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900">
            <div className="font-bold">{session.title}</div>
            <div className="text-[10px] text-blue-700 mt-1">{session.cohortName} • Currently: {session.dayOfWeek} at {initialTime}</div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Start Time</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition">
            Cancel
          </button>
          <button 
            disabled={!date || !time}
            onClick={() => onSave(date, time)}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// CSV spreadsheet upload modal
function UploadModalInner({ onClose, onUpload }: { onClose: () => void; onUpload: (csvText: string) => void }) {
  const [csvText, setCsvText] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCsvText(event.target.result as string);
      }
    };
    reader.readAsText(file);
  };

  const handleUpload = () => {
    if (!csvText) return;
    onUpload(csvText);
  };

  // Simulates loading data from Google Sheets API directly
  const handleSimulateGoogleSheets = () => {
    const simulatedCSV = `title,cohortName,topic,minSmeTier,startTime,durationHours,mode,requiredSkills
"Next.js App Routing Masterclass","AI/ML Batch 14 - FAANG Acceleration","System Design","Senior Faculty","2026-08-12 11:00",2.0,"Cohort Class","System Design;Distributed Systems"
"Prompt Engineering & Agents Support Session","DSA Support Lounge","Agentic AI","Standard SME","2026-08-14 14:00",1.5,"Doubt Clearing","Agentic AI;Python"
"Algorithms Whiteboarding Challenge","Algorithms Masterclass (India Cohort)","Algorithms & Data Structures","Lead Instructor","2026-08-11 18:30",2.5,"Cohort Class","Graphs;LeetCode Hard"`;
    onUpload(simulatedCSV);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <h3 className="font-black text-slate-900 text-sm">Ingest Spreadsheet</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-xs">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 flex justify-between items-center">
            <span>Or sync directly with Google Sheets API:</span>
            <button 
              onClick={handleSimulateGoogleSheets}
              className="px-2.5 py-1 bg-[#1E3A8A] hover:bg-blue-900 text-white font-bold rounded-lg text-[10px] transition shadow-xs"
            >
              Sync Google Sheet
            </button>
          </div>

          <p className="text-slate-500 leading-relaxed">
            Alternatively, upload a CSV containing weekly sessions. Required columns: 
            <code className="bg-slate-100 p-0.5 rounded font-mono text-[9px] ml-1">title, cohortName, topic, minSmeTier, startTime, durationHours, mode, requiredSkills</code>.
          </p>
          
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:bg-slate-50 transition cursor-pointer">
            <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" id="csv-file-input" />
            <label htmlFor="csv-file-input" className="cursor-pointer space-y-2 block">
              <div className="font-bold text-blue-600">Click to choose a CSV file</div>
              <div className="text-[10px] text-slate-400">Supported format: .csv</div>
            </label>
          </div>
          {csvText && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-emerald-600">✓ File loaded successfully</span>
              <pre className="p-2 border border-slate-200 rounded-lg bg-slate-50 max-h-32 overflow-auto font-mono text-[9px] text-slate-600">{csvText.slice(0, 500)}...</pre>
            </div>
          )}
        </div>
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleUpload} disabled={!csvText} className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1E3A8A] hover:bg-blue-900 disabled:opacity-50 transition shadow-sm">Ingest Spreadsheet</button>
        </div>
      </div>
    </div>
  );
}

// SME Add Modal — with Google Cal mock connect + weekly grid + session type toggles
const ALL_SESSION_MODES: SME["preferredSessionModes"][number][] = ["Cohort Class", "Mock Interview", "Doubt Clearing"];
const WEEK_DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat"];
const TIME_SLOTS = ["08:00","09:00","10:00","11:00","14:00","15:00","17:00","18:30","19:00","20:00"];

function AddSmeModalInner({ onClose, onAdd }: { onClose: () => void; onAdd: (sme: Partial<SME>) => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("AI & Machine Learning");
  const [skills, setSkills] = useState("");
  const [tier, setTier] = useState<SME["tier"]>("Standard SME");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [hours, setHours] = useState(8);
  const [calSynced, setCalSynced] = useState(false);
  const [calSyncing, setCalSyncing] = useState(false);
  // Weekly grid: Set of "Mon 09:00" style strings
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [sessionModes, setSessionModes] = useState<Set<SME["preferredSessionModes"][number]>>(new Set(["Cohort Class", "Mock Interview", "Doubt Clearing"]));

  const toggleSlot = (slot: string) => {
    setSelectedSlots(prev => {
      const next = new Set(prev);
      if (next.has(slot)) {
        next.delete(slot);
      } else {
        next.add(slot);
      }
      return next;
    });
  };

  const toggleMode = (m: SME["preferredSessionModes"][number]) => {
    setSessionModes(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        next.delete(m);
      } else {
        next.add(m);
      }
      return next;
    });
  };

  const mockSyncCalendar = () => {
    setCalSyncing(true);
    // Simulate an OAuth + calendar fetch — auto-populate some available slots
    setTimeout(() => {
      const autoSlots = new Set(["Mon 09:00","Mon 14:00","Tue 10:00","Wed 15:00","Thu 09:00","Fri 11:00"]);
      setSelectedSlots(autoSlots);
      setCalSynced(true);
      setCalSyncing(false);
    }, 1400);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const parsedSkills = skills.split(",").map(s => s.trim()).filter(Boolean);
    onAdd({
      name,
      primaryDomain: domain,
      skills: parsedSkills,
      tier,
      timeZone: timezone,
      maxWeeklyHours: hours,
      availableSlots: Array.from(selectedSlots),
      preferredSessionModes: Array.from(sessionModes),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="font-black text-slate-900 text-sm">Add New Instructor</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Profile details + availability — synced from Google Calendar</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">

          {/* Basic Info */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Full Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Priya Mehta" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tier</label>
              <select value={tier} onChange={e => setTier(e.target.value as SME["tier"])} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="Senior Faculty">Senior Faculty</option>
                <option value="Lead Instructor">Lead Instructor</option>
                <option value="Standard SME">Standard SME</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Primary Domain</label>
              <select value={domain} onChange={e => setDomain(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="AI & Machine Learning">AI & ML</option>
                <option value="System Design">System Design</option>
                <option value="Algorithms & Data Structures">Algorithms & DSA</option>
                <option value="Engineering Leadership">Leadership</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Skills (comma-separated)</label>
            <input type="text" value={skills} onChange={e => setSkills(e.target.value)} placeholder="e.g. Distributed Systems, Microservices" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="US/Pacific">US/Pacific (PST)</option>
                <option value="US/Eastern">US/Eastern (EST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Max Weekly Hours</label>
              <input type="number" value={hours} onChange={e => setHours(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
          </div>

          {/* Session Types */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Session Types They Can Take</label>
            <div className="flex gap-2">
              {ALL_SESSION_MODES.map(m => {
                const cfg = MODE_CFG[m];
                const on = sessionModes.has(m);
                return (
                  <button key={m} onClick={() => toggleMode(m)}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-black border transition-all ${
                      on ? `${cfg?.badge ?? ""} border-transparent shadow-sm` : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                    }`}>
                    {on ? "✓ " : ""}{cfg?.label ?? m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Google Calendar Sync */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Availability</label>
              {!calSynced ? (
                <button onClick={mockSyncCalendar} disabled={calSyncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 text-[10px] font-bold text-slate-700 shadow-sm transition disabled:opacity-60">
                  <Calendar className="w-3 h-3 text-blue-500" />
                  {calSyncing ? "Syncing…" : "Connect Google Calendar"}
                </button>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                  <Check className="w-3 h-3" /> Synced — edit below
                </span>
              )}
            </div>
            {!calSynced && selectedSlots.size === 0 && (
              <p className="text-[10px] text-slate-400 italic">Connect Google Calendar to auto-import free slots, or tap cells below to set manually.</p>
            )}

            {/* Weekly Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] border-collapse">
                <thead>
                  <tr>
                    <th className="w-12" />
                    {WEEK_DAYS.map(d => (
                      <th key={d} className="font-black text-slate-500 pb-1 text-center">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map(t => (
                    <tr key={t}>
                      <td className="text-slate-400 font-mono pr-2 text-right py-0.5">{t}</td>
                      {WEEK_DAYS.map(d => {
                        const key = `${d} ${t}`;
                        const on = selectedSlots.has(key);
                        return (
                          <td key={d} className="text-center py-0.5 px-0.5">
                            <button onClick={() => toggleSlot(key)}
                              className={`w-full rounded text-[8px] font-black py-1 transition-all border ${
                                on ? "bg-blue-600 text-white border-blue-600" : "bg-slate-50 text-slate-300 border-slate-100 hover:bg-blue-50 hover:text-blue-400 hover:border-blue-200"
                              }`}>
                              {on ? "✓" : "·"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedSlots.size > 0 && (
              <p className="text-[10px] text-blue-700 font-semibold">{selectedSlots.size} slot{selectedSlots.size !== 1 ? "s" : ""} selected</p>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleSubmit} disabled={!name.trim() || sessionModes.size === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition shadow-sm">
            Add Instructor
          </button>
        </div>
      </div>
    </div>
  );
}

// Session Add Modal
function AddSessionModalInner({ onClose, onAdd }: { onClose: () => void; onAdd: (session: Partial<Session>) => void }) {
  const [title, setTitle] = useState("");
  const [cohortName, setCohortName] = useState("");
  const [topic, setTopic] = useState("System Design");
  const [skills, setSkills] = useState("");
  const [tier, setTier] = useState<Session["minSmeTier"]>("Standard SME");
  const [mode, setMode] = useState<Session["mode"]>("Cohort Class");
  const [date, setDate] = useState("2026-08-10");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(2);
  const [timezone, setTimezone] = useState("US/Pacific");

  const handleSubmit = () => {
    if (!title.trim() || !cohortName.trim()) return;
    const parsedSkills = skills.split(",").map(s => s.trim()).filter(Boolean);
    const dateObj = new Date(date + "T00:00:00");
    const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' }) as Session["dayOfWeek"];
    
    let priority: 1 | 2 | 3 = 3;
    if (mode === "Cohort Class") priority = 1;
    else if (mode === "Mock Interview") priority = 2;

    onAdd({
      title,
      cohortName,
      topic,
      requiredSkills: parsedSkills,
      minSmeTier: tier,
      mode,
      startTime: `${date} ${time}`,
      dayOfWeek: weekday,
      durationHours: duration,
      timeZone: timezone,
      priority
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <h3 className="font-black text-slate-900 text-sm">Add New Session</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto max-h-[60vh] text-xs">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Session Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Distributed Systems Deep Dive" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cohort / Batch Name</label>
            <input type="text" value={cohortName} onChange={e => setCohortName(e.target.value)} placeholder="e.g. Software Architecture Cohort 22" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value as Session["mode"])} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="Cohort Class">Cohort Class</option>
                <option value="Mock Interview">Mock Interview</option>
                <option value="Doubt Clearing">Doubt Clearing</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Topic</label>
              <select value={topic} onChange={e => setTopic(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="Agentic AI">Agentic AI</option>
                <option value="System Design">System Design</option>
                <option value="Algorithms & Data Structures">Algorithms & DSA</option>
                <option value="Engineering Leadership">Leadership</option>
                <option value="Quantum Computing">Quantum Computing</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Required Skills (Comma-separated)</label>
            <input type="text" value={skills} onChange={e => setSkills(e.target.value)} placeholder="e.g. Distributed Systems, Microservices" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Duration (Hours)</label>
              <input type="number" step="0.5" value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="US/Pacific">US/Pacific (PST)</option>
                <option value="US/Eastern">US/Eastern (EST)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Minimum SME Tier Required</label>
              <select value={tier} onChange={e => setTier(e.target.value as Session["minSmeTier"])} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
              <option value="Senior Faculty">Senior Faculty</option>
              <option value="Lead Instructor">Lead Instructor</option>
              <option value="Standard SME">Standard SME</option>
            </select>
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition shadow-sm">Add Session</button>
        </div>
      </div>
    </div>
  );
}

// SME Calendar Modal
function SmeCalendarModalInner({ 
  sme, 
  calendarEvents, 
  onClose 
}: { 
  sme: SME; 
  calendarEvents: { startTime: string; title: string; isScheduled?: boolean }[];
  onClose: () => void; 
}) {
  const externalEvents = calendarEvents.filter(e => !e.isScheduled);
  const scheduledEvents = calendarEvents.filter(e => e.isScheduled);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src={sme.avatar} className="w-9 h-9 rounded-full object-cover border-2 border-blue-200" alt="" />
            <div>
              <h3 className="font-black text-slate-900 text-sm leading-tight">{sme.name}&apos;s Calendar</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">{sme.tier} · Week of Aug 10–16, 2026</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5 text-xs">

          {/* Sync status bar */}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-emerald-800 text-[11px] font-bold">
              <Check className="w-3.5 h-3.5" /> Synced
              <span className="ml-auto text-[9px] bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded-full font-black">ACTIVE</span>
            </div>
            <div className="flex flex-col items-center justify-center bg-blue-50 border border-blue-100 rounded-xl px-3 text-[10px] font-black text-blue-700">
              <span className="text-base leading-none">{scheduledEvents.length}</span>
              <span className="font-semibold">IK sessions</span>
            </div>
            <div className="flex flex-col items-center justify-center bg-red-50 border border-red-100 rounded-xl px-3 text-[10px] font-black text-red-600">
              <span className="text-base leading-none">{externalEvents.length}</span>
              <span className="font-semibold">conflicts</span>
            </div>
          </div>

          {/* IK Scheduled Events */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">IK Sessions (Written to Calendar on Approval)</label>
            </div>
            {scheduledEvents.length === 0 ? (
              <div className="text-[11px] text-slate-400 text-center py-4 bg-slate-50 border rounded-xl border-dashed">
                No approved sessions written yet — approve a session to see it here.
              </div>
            ) : (
              <div className="space-y-1.5">
                {scheduledEvents.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="w-1 rounded-full bg-blue-400 self-stretch flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-blue-900 truncate">
                        {ev.title.replace(" (IK Scheduled)", "")}
                      </div>
                      <div className="text-[10px] text-blue-600 mt-0.5">{ev.startTime}</div>
                    </div>
                    <span className="flex-shrink-0 text-[9px] font-black uppercase text-blue-600 bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5">✓ Written</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* External Conflicts */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">External Conflicts (Google Calendar)</label>
            </div>
            {externalEvents.length === 0 ? (
              <div className="text-[11px] text-slate-400 text-center py-4 bg-slate-50 border rounded-xl border-dashed">
                No external conflicts synced
              </div>
            ) : (
              <div className="space-y-1.5">
                {externalEvents.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 bg-red-50 border border-red-100 rounded-xl">
                    <div className="w-1 rounded-full bg-red-400 self-stretch flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 truncate">
                        {ev.title.replace(" (Google Calendar)", "")}
                      </div>
                      <div className="text-[10px] text-red-500 mt-0.5">{ev.startTime} · Busy / Unavailable</div>
                    </div>
                    <span className="flex-shrink-0 text-[9px] font-black uppercase text-red-500 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Conflict</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Available slots */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-300" />
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Open Availability Slots</label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sme.availableSlots.map(slot => (
                <span key={slot} className="px-2.5 py-1 text-[10px] font-mono font-bold rounded-lg border bg-blue-50 text-blue-800 border-blue-200">{slot}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-[#1E3A8A] hover:bg-blue-900 transition shadow-sm">Done</button>
        </div>
      </div>
    </div>
  );
}
