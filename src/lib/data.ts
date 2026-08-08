export interface SME {
  id: string;
  name: string;
  avatar: string;
  primaryDomain: string; // e.g. "System Design", "Algorithms & Data Structures", "AI & Machine Learning", "Engineering Leadership"
  skills: string[];
  tier: "Senior Faculty" | "Lead Instructor" | "Standard SME";
  timeZone: string; // e.g. "US/Pacific", "US/Eastern", "Asia/Kolkata"
  availableSlots: string[]; // ISO string start times or readable slots like "Mon 09:00", "Tue 14:00"
  maxWeeklyHours: number;
  rolling4WeekHours: number; // Historical workload for fair distribution (Target standard: 12h over 4wks = avg 3h/wk)
  historicalRating: number; // Out of 5.0
  topicRatings: Record<string, number>; // Rating per specific topic
  preferredSessionModes: ("Cohort Class" | "Doubt Clearing" | "Mock Interview")[];
}

export interface Session {
  id: string;
  title: string;
  topic: string;
  requiredSkills: string[];
  minSmeTier: "Senior Faculty" | "Lead Instructor" | "Standard SME";
  startTime: string; // e.g. "2026-08-10 10:00"
  dayOfWeek: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  durationHours: number;
  mode: "Cohort Class" | "Doubt Clearing" | "Mock Interview";
  timeZone: string;
  cohortName: string;
  assignedSmeId?: string | null;
  priority: 1 | 2 | 3; // 1 = Cohort Class (High), 2 = Mock Interview (Medium), 3 = Doubt Clearing (Low)
  completed?: boolean;
}

export interface ConflictFlag {
  id: string;
  sessionId: string;
  type: "UNFILLED" | "EXPERTISE_MISMATCH" | "AVAILABILITY_CONFLICT" | "FAIRNESS_VIOLATION" | "TIMEZONE_WARNING";
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  reason: string;
  suggestedSmeIds: string[];
  remediationOptions?: {
    label: string;
    action: "RESCHEDULE" | "REASSIGN" | "RELAX_TIER" | "ESCALATE";
    reason: string;
  }[];
}

export interface AssignmentResult {
  sessionId: string;
  smeId: string | null;
  score: number; // 0 - 100
  scoreBreakdown: {
    availabilityScore: number;
    expertiseFitScore: number;
    rollingWorkloadScore: number;
    ratingScore: number;
  };
  llmReasoning: string;
  status: "OPTIMAL" | "SUBOPTIMAL" | "CONFLICT" | "UNMATCHED";
  conflicts: ConflictFlag[];
}

export const INITIAL_SMES: SME[] = [
  {
    id: "sme-1",
    name: "Dr. Aris Vance",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "AI & Machine Learning",
    skills: ["Agentic AI", "LLM Fine-tuning", "System Design", "Python", "Deep Learning"],
    tier: "Senior Faculty",
    timeZone: "US/Pacific",
    availableSlots: ["Mon 09:00", "Mon 14:00", "Tue 10:00", "Wed 15:00", "Thu 09:00", "Fri 11:00"],
    maxWeeklyHours: 10,
    rolling4WeekHours: 28, // Heavy historical load (Needs cooling down)
    historicalRating: 4.95,
    topicRatings: { "Agentic AI": 4.98, "LLM Fine-tuning": 4.95, "System Design": 4.88 },
    preferredSessionModes: ["Cohort Class", "Mock Interview"]
  },
  {
    id: "sme-2",
    name: "Neha Sharma",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "System Design",
    skills: ["Distributed Systems", "Microservices", "System Design", "Database Sharding", "Kafka"],
    tier: "Senior Faculty",
    timeZone: "US/Eastern",
    availableSlots: ["Mon 10:00", "Tue 14:00", "Wed 10:00", "Thu 14:00", "Fri 10:00"],
    maxWeeklyHours: 8,
    rolling4WeekHours: 12, // Light historical load (High priority for fair rotation)
    historicalRating: 4.90,
    topicRatings: { "Distributed Systems": 4.92, "System Design": 4.91, "Microservices": 4.85 },
    preferredSessionModes: ["Cohort Class", "Doubt Clearing"]
  },
  {
    id: "sme-3",
    name: "Vikram Malhotra",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "Algorithms & Data Structures",
    skills: ["Dynamic Programming", "Graphs", "Data Structures", "LeetCode Hard", "C++"],
    tier: "Lead Instructor",
    timeZone: "Asia/Kolkata",
    availableSlots: ["Mon 18:30", "Tue 18:30", "Wed 18:30", "Thu 18:30", "Sat 10:00"],
    maxWeeklyHours: 12,
    rolling4WeekHours: 16,
    historicalRating: 4.85,
    topicRatings: { "Dynamic Programming": 4.88, "Graphs": 4.86, "Data Structures": 4.82 },
    preferredSessionModes: ["Cohort Class", "Mock Interview"]
  },
  {
    id: "sme-4",
    name: "Sarah Jenkins",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "Engineering Leadership",
    skills: ["Engineering Leadership", "Behavioral Interview", "System Architecture", "People Mgmt"],
    tier: "Senior Faculty",
    timeZone: "US/Pacific",
    availableSlots: ["Tue 11:00", "Wed 11:00", "Thu 11:00", "Thu 15:00"],
    maxWeeklyHours: 6,
    rolling4WeekHours: 8,
    historicalRating: 4.97,
    topicRatings: { "Engineering Leadership": 4.99, "Behavioral Interview": 4.96 },
    preferredSessionModes: ["Cohort Class", "Mock Interview"]
  },
  {
    id: "sme-5",
    name: "Rajesh Kumar",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "AI & Machine Learning",
    skills: ["Computer Vision", "PyTorch", "Data Structures", "Python"],
    tier: "Standard SME",
    timeZone: "Asia/Kolkata",
    availableSlots: ["Mon 19:00", "Wed 19:00", "Fri 19:00", "Sat 14:00"],
    maxWeeklyHours: 10,
    rolling4WeekHours: 14,
    historicalRating: 4.65,
    topicRatings: { "Computer Vision": 4.70, "Python": 4.60 },
    preferredSessionModes: ["Doubt Clearing", "Mock Interview"]
  },
  {
    id: "sme-6",
    name: "Elena Rostova",
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "System Design",
    skills: ["Low Level Design", "Object Oriented Design", "Design Patterns", "Java"],
    tier: "Lead Instructor",
    timeZone: "Europe/London",
    availableSlots: ["Mon 14:00", "Tue 14:00", "Thu 14:00"],
    maxWeeklyHours: 6,
    rolling4WeekHours: 18,
    historicalRating: 4.88,
    topicRatings: { "Low Level Design": 4.90, "Object Oriented Design": 4.87 },
    preferredSessionModes: ["Cohort Class", "Doubt Clearing"]
  },
  {
    id: "sme-7",
    name: "Asha Menon",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "Engineering Leadership",
    skills: ["Behavioral Interview", "People Mgmt", "System Design", "Mentoring"],
    tier: "Lead Instructor",
    timeZone: "US/Pacific",
    availableSlots: ["Mon 11:00", "Tue 11:00", "Wed 14:00", "Thu 11:00"],
    maxWeeklyHours: 8,
    rolling4WeekHours: 17,
    historicalRating: 4.89,
    topicRatings: { "Behavioral Interview": 4.93, "Engineering Leadership": 4.90, "Mentoring": 4.85 },
    preferredSessionModes: ["Cohort Class", "Mock Interview"]
  },
  {
    id: "sme-8",
    name: "Kabir Sethi",
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "Algorithms & Data Structures",
    skills: ["Graphs", "Data Structures", "Dynamic Programming", "C++"],
    tier: "Standard SME",
    timeZone: "Asia/Kolkata",
    availableSlots: ["Tue 18:30", "Wed 18:30", "Fri 18:30"],
    maxWeeklyHours: 8,
    rolling4WeekHours: 9,
    historicalRating: 4.78,
    topicRatings: { "Graphs": 4.80, "Data Structures": 4.79, "Dynamic Programming": 4.75 },
    preferredSessionModes: ["Doubt Clearing", "Mock Interview"]
  },
  {
    id: "sme-9",
    name: "Maya Deshmukh",
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
    primaryDomain: "Engineering Leadership",
    skills: ["Behavioral Interview", "People Mgmt", "System Design", "Mentoring"],
    tier: "Lead Instructor",
    timeZone: "US/Pacific",
    availableSlots: ["Mon 11:00", "Tue 11:00", "Wed 14:00", "Thu 11:00"],
    maxWeeklyHours: 8,
    rolling4WeekHours: 17,
    historicalRating: 4.89,
    topicRatings: { "Behavioral Interview": 4.93, "Engineering Leadership": 4.90, "Mentoring": 4.85 },
    preferredSessionModes: ["Cohort Class", "Mock Interview"]
  }
];

export const INITIAL_SESSIONS: Session[] = [
  // --- PAST WEEK SESSIONS (Aug 3 - Aug 9) ---
  {
    id: "sess-090",
    title: "Introduction to Database Engines",
    topic: "System Design",
    requiredSkills: ["Distributed Systems"],
    minSmeTier: "Lead Instructor",
    startTime: "2026-08-04 10:00",
    dayOfWeek: "Tuesday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "US/Eastern",
    cohortName: "Software Architecture Cohort 22",
    assignedSmeId: "sme-2",
    priority: 1,
    completed: true
  },
  {
    id: "sess-091",
    title: "Graph Traversals & BFS/DFS Foundations",
    topic: "Algorithms & Data Structures",
    requiredSkills: ["Graphs"],
    minSmeTier: "Standard SME",
    startTime: "2026-08-05 18:30",
    dayOfWeek: "Wednesday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "Asia/Kolkata",
    cohortName: "DSA Support Lounge",
    assignedSmeId: "sme-3",
    priority: 1,
    completed: true
  },
  {
    id: "sess-092",
    title: "FAANG Behavioral & Leadership Mock Session",
    topic: "Engineering Leadership",
    requiredSkills: ["Engineering Leadership", "Behavioral Interview"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-06 11:00",
    dayOfWeek: "Thursday",
    durationHours: 1.5,
    mode: "Mock Interview",
    timeZone: "US/Pacific",
    cohortName: "EM / Director Prep",
    assignedSmeId: "sme-4",
    priority: 2,
    completed: true
  },
  // --- CURRENT WEEK SESSIONS (Aug 10 - Aug 16) ---
  {
    id: "sess-101",
    title: "Mastering Agentic AI Architecture & Tool Calling",
    topic: "Agentic AI",
    requiredSkills: ["Agentic AI", "LLM Fine-tuning"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-10 09:00",
    dayOfWeek: "Monday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "US/Pacific",
    cohortName: "AI/ML Batch 14 - FAANG Acceleration",
    priority: 1
  },
  {
    id: "sess-102",
    title: "Global Scalability & Database Sharding Deep Dive",
    topic: "System Design",
    requiredSkills: ["Distributed Systems", "Database Sharding"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-10 10:00",
    dayOfWeek: "Monday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "US/Eastern",
    cohortName: "Software Architecture Cohort 22",
    priority: 1
  },
  {
    id: "sess-103",
    title: "Dynamic Programming: Knapsack & Grid Variants",
    topic: "Algorithms & Data Structures",
    requiredSkills: ["Dynamic Programming", "LeetCode Hard"],
    minSmeTier: "Lead Instructor",
    startTime: "2026-08-10 18:30",
    dayOfWeek: "Monday",
    durationHours: 2.5,
    mode: "Cohort Class",
    timeZone: "Asia/Kolkata",
    cohortName: "Algorithms Masterclass (India Cohort)",
    priority: 1
  },
  {
    id: "sess-104",
    title: "Advanced Quantum Machine Learning & Neuromorphic Computing",
    topic: "Quantum Computing",
    requiredSkills: ["Quantum Computing", "Qiskit"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-11 14:00",
    dayOfWeek: "Tuesday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "US/Pacific",
    cohortName: "Specialist Research Track",
    priority: 1
  },
  {
    id: "sess-105",
    title: "Executive Behavioral & System Design Mock Interview",
    topic: "Engineering Leadership",
    requiredSkills: ["Engineering Leadership", "Behavioral Interview"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-13 11:00",
    dayOfWeek: "Thursday",
    durationHours: 1.5,
    mode: "Mock Interview",
    timeZone: "US/Pacific",
    cohortName: "EM / Director Prep",
    priority: 2
  },
  {
    id: "sess-106",
    title: "Mid-Week Data Structures & Graph Algorithms Doubt Clearing",
    topic: "Algorithms & Data Structures",
    requiredSkills: ["Graphs", "Data Structures"],
    minSmeTier: "Standard SME",
    startTime: "2026-08-12 18:30",
    dayOfWeek: "Wednesday",
    durationHours: 2,
    mode: "Doubt Clearing",
    timeZone: "Asia/Kolkata",
    cohortName: "DSA Support Lounge",
    priority: 3
  },
  {
    id: "sess-107",
    title: "Object-Oriented Design & Design Patterns Intensive",
    topic: "System Design",
    requiredSkills: ["Low Level Design", "Design Patterns"],
    minSmeTier: "Lead Instructor",
    startTime: "2026-08-13 14:00",
    dayOfWeek: "Thursday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "Europe/London",
    cohortName: "LLD Standard Track",
    priority: 1
  },
  {
    id: "sess-108",
    title: "Behavioral Interview for Engineering Managers",
    topic: "Engineering Leadership",
    requiredSkills: ["Behavioral Interview", "People Mgmt"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-12 11:00",
    dayOfWeek: "Wednesday",
    durationHours: 1.5,
    mode: "Mock Interview",
    timeZone: "US/Pacific",
    cohortName: "Leadership Accelerator",
    priority: 2
  },
  {
    id: "sess-109",
    title: "Backend Architecture for Scale",
    topic: "System Design",
    requiredSkills: ["Microservices", "Kafka", "Distributed Systems"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-14 10:00",
    dayOfWeek: "Friday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "US/Eastern",
    cohortName: "Platform Cohort 31",
    priority: 1
  },
  {
    id: "sess-110",
    title: "Graph Practice Hour",
    topic: "Algorithms & Data Structures",
    requiredSkills: ["Graphs"],
    minSmeTier: "Standard SME",
    startTime: "2026-08-15 18:30",
    dayOfWeek: "Saturday",
    durationHours: 2,
    mode: "Doubt Clearing",
    timeZone: "Asia/Kolkata",
    cohortName: "DSA Support Lounge",
    priority: 3
  },
  {
    id: "sess-111",
    title: "Leadership Mock Interview Tie Breaker",
    topic: "Engineering Leadership",
    requiredSkills: ["Behavioral Interview", "People Mgmt"],
    minSmeTier: "Lead Instructor",
    startTime: "2026-08-14 11:00",
    dayOfWeek: "Friday",
    durationHours: 1.5,
    mode: "Mock Interview",
    timeZone: "US/Pacific",
    cohortName: "Leadership Accelerator",
    priority: 2
  },
  {
    id: "sess-112",
    title: "Practical Python Debugging for ML Teams",
    topic: "AI & Machine Learning",
    requiredSkills: ["Python", "Debugging"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-14 19:00",
    dayOfWeek: "Friday",
    durationHours: 1.5,
    mode: "Doubt Clearing",
    timeZone: "Asia/Kolkata",
    cohortName: "ML Support Lounge",
    priority: 3
  },
  {
    id: "sess-113",
    title: "Dropped SME Recovery Drill",
    topic: "System Design",
    requiredSkills: ["Distributed Systems", "Kafka"],
    minSmeTier: "Senior Faculty",
    startTime: "2026-08-10 10:00",
    dayOfWeek: "Monday",
    durationHours: 2,
    mode: "Cohort Class",
    timeZone: "US/Eastern",
    cohortName: "Platform Cohort 31",
    priority: 1
  }
];
