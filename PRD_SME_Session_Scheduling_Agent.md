# PRD: SME-to-Session Scheduling Agent

## 1. Problem Framing

Ops teams at Interview Kickstart schedule a large number of live learning sessions every week. Today, that work is done manually in spreadsheets while juggling topic fit, SME availability, tier requirements, workload fairness, timezone differences, and last-minute changes.

That process is expensive in ops time and fragile in execution. The recurring failure modes are predictable:

- sessions get assigned to SMEs who are not actually free
- topic expertise is applied inconsistently
- the same SMEs absorb too much load over time
- gaps are discovered too late to fix cleanly
- the schedule is hard to explain when someone asks, "why this assignment?"

The product opportunity is not to replace ops. It is to give ops a scheduling copilot that drafts a high-quality weekly schedule, explains the hard cases, and makes the remaining decisions faster and safer.

## 2. Product Goal

Help ops produce a weekly SME-to-session schedule that is:

- fast to draft
- safe to approve
- fair across SMEs
- easy to explain
- resilient to edge cases

In one sentence: the tool should turn a messy scheduling workflow into a guided decision flow.

## 3. Success Metrics

### What success looks like

- weekly scheduling time drops from roughly 4+ hours to under 30 minutes for most weeks
- the majority of eligible sessions are auto-matched on the first pass
- critical gaps are surfaced before approval, not after
- double-bookings are avoided
- workload is balanced across a rolling 4-week window
- ops can understand and act on most conflicts without back-and-forth
- at least 80 percent of demo sessions are resolved without manual row-by-row assignment
- the reviewer can trace every recommendation to a concrete rule, score, or LLM explanation

### How we will judge the prototype

- does the draft schedule feel credible?
- are the conflict reasons readable and actionable?
- are the unblock suggestions actually useful?
- can a non-technical ops user approve or override confidently?
- does the prototype demonstrate the edge cases the assignment asked for?
- does the prototype expose the required API actions and draft-write flow?

## 4. Users and Jobs To Be Done

### Primary user: Ops / curriculum

Needs:

- a draft schedule they can review quickly
- clear signals for what is blocked and why
- simple actions to resolve issues
- confidence that fairness and expertise have been respected

Job to be done:

- “Help me generate a good weekly schedule without rebuilding it from scratch.”

### Secondary user: SME

Needs:

- fair and predictable load
- sessions that match their strengths
- visibility into assignments and conflicts
- a way to handle drop-outs or changes cleanly

Job to be done:

- “Help me understand my assignments and avoid surprises.”

### Secondary user: Learner

Needs:

- a qualified instructor
- stable session quality
- fewer scheduling mistakes that leak into the learning experience

## 5. MVP Scope

### In scope

- ingest a weekly list of sessions and SME pool data
- read synthetic calendar and session inputs shaped like Google Sheets and Calendar exports
- run matching using availability, expertise, tier, historical performance, and rolling fairness
- draft a weekly schedule automatically
- write the draft schedule back into a schedule view that acts like the Sheets output the ops team would review
- persist the draft schedule through an API surface that supports trigger run, fetch draft, and submit approvals
- make LLM calls for tie-break narration, conflict explanation, and unblock suggestions
- structure the input and output data like a small backend service would, even if the source data is synthetic
- flag sessions that are unfilled, conflicted, or unfairly distributed
- explain each issue in plain language
- provide practical unblock suggestions
- support ops review, approve, override, reschedule, and re-run flows
- show an SME-facing view after approval
- use synthetic demo data that proves the key edge cases end to end

### Out of scope

- real OAuth-backed Google Sheets and Calendar credentials
- production hardening of the API surface
- auth, permissions, and audit logs
- notification workflows
- enterprise admin controls
- production-scale job orchestration
- replacing deterministic eligibility rules with LLM-only matching
- hiding the matching logic behind manual-only spreadsheet operations

### Why this scope is right

The assessment is explicitly asking for a working prototype that demonstrates ingest, match, draft, flag, and human approval. That means the core workflow should exist, but it is acceptable to simulate external systems with seed data and lightweight service boundaries. The thing to defer is live enterprise plumbing and production robustness, not the core matching API, draft-write flow, or reasoning loop.

## 6. Product Principles

These are the product choices that should guide the solution:

- prefer explainability over cleverness
- keep ops in control of final approval
- surface the few most useful actions, not every theoretical option
- optimize for fairness over time, not just the current week
- treat the LLM as a reasoning and explanation layer, not the source of truth

This problem should feel like a constrained decision-support product, not an autonomous black box.

## 7. Matching Approach

### Hard constraints

These must hold before a match is considered valid:

- the SME must be available for the session time
- the SME must not already be booked
- the SME must meet the minimum tier
- the SME must satisfy the required expertise or skill gate
- the assignment must not create a double-booking

### Soft preferences

When multiple SMEs are feasible, prefer the one who:

- has the strongest topic fit
- has better historical performance for that topic
- has lower rolling workload
- better matches the session type
- creates fewer downstream scheduling issues

### Role of the LLM

Use the LLM for:

- summarizing why a session is blocked
- suggesting a human-readable unblock path
- explaining why one candidate was chosen over another
- converting scheduling logic into language ops can act on

Do not use the LLM as the only thing deciding a valid assignment.

The best product split here is:

- deterministic rules for eligibility and constraints
- scoring logic for ranking feasible options
- LLM reasoning for tie-breaking narration, conflict explanation, and unblock suggestions

The LLM should be called only after hard constraints are evaluated. If multiple SMEs remain feasible, the deterministic scorer produces the shortlist, and the tie-break rule is highest total score, then lowest rolling 4-week load, then highest topic rating, then deterministic SME name order. The LLM explains that outcome in plain language.

## 8. Conflict Handling

The main product value is not just flagging issues. It is helping ops move from “problem found” to “next action.”

Every issue should show:

- what is wrong
- why it matters
- what ops can do next

### Required conflict types

- unfilled session
- availability conflict
- expertise mismatch
- fairness violation
- timezone warning

### What a good unblock suggestion looks like

A good suggestion is:

- specific to the session
- specific to the actual candidate pool
- reasonable for ops to execute
- safe, meaning it does not create a new obvious conflict

Examples:

- move the session to a nearby free slot for the strongest SME
- reassign to the best available backup
- relax tier only when the topic is not high-risk and a nearby lower-tier SME still has the required core skills
- escalate when no safe unblock exists

These suggestions should be surfaced through the `suggested SME ids` and `remediation options` fields in the conflict model so the UI can show both the recommendation and the rationale in one place.

### When to use lower-tier fallback

Lower-tier fallback should only appear when:

- the session is not a top-priority cohort session with strict coverage requirements
- the lower-tier SME still has the required core skill overlap
- the calendar slot is actually free
- the tradeoff is understandable to ops

If those conditions are not met, the system should leave the session unfilled and explain why.

## 9. Edge Cases the Prototype Must Demonstrate

The assignment explicitly cares about edge-case reasoning. The prototype should make those cases visible, not hidden.

- last-minute SME drop-out
  - an approved assignment gets cancelled
  - the system re-matches the affected session
- no qualified or available SME
  - the session stays unfilled
  - the system explains the bottleneck
- tie between equally good candidates
  - the system breaks the tie using a fair rule
  - the rationale is visible
- timezone handling
  - assignments across timezones are normalized safely
  - timezone risk is flagged clearly
- fairness over a rolling window
  - the same SME should not keep getting selected simply because they are strongest
- lower-tier fallback
  - when acceptable, the system can recommend a reasonable slightly-lower-tier SME instead of leaving the slot empty

## 10. Data Model

This is intentionally lightweight, but the prototype should still have a clear shape so the workflow is understandable and the API surface is coherent.

### Session

- id
- title
- topic
- required skills
- minimum SME tier
- start time
- duration
- mode
- timezone
- priority

### SME

- id
- name
- tier
- skills
- availability slots
- rolling 4-week hours
- historical rating
- topic-specific ratings

### Assignment

- session id
- SME id or null
- score
- score breakdown
- status
- conflict list
- explanation

### DraftSchedule

- id
- week start
- source version
- session assignments
- unfilled sessions
- summary stats
- generated at
- generated by

### Conflict

- type
- severity
- title
- reason
- suggested SME ids
- remediation options

## 11. UX Expectations

### Ops experience

The ops view should be optimized for action:

- schedule first
- issues second
- explanations short and visible
- unblock suggestions grounded in reality
- approve and override actions easy to find

It should feel like a workbench, not a wall of admin cards.

### SME experience

The SME view should be separate from ops and much lighter:

- approved sessions
- upcoming assignments
- calendar conflicts
- cancellation or dropout handling
- personal workload visibility

It should answer the question, “what do I need to know right now?”

## 12. Demo Strategy

The synthetic demo should be designed to prove the product story on purpose. The reviewer should be able to see each important flow without hunting for it.

At minimum, the demo should include:

- one clean successful match
- one no-fit / unfilled session
- one fairness warning
- one tie-break case
- one lower-tier fallback case
- one drop-out / reassignment case
- one timezone-sensitive case

That gives the demo structure and makes the prototype easier to judge.

## 13. What We Are Deferring

These are intentionally not in the prototype:

- live OAuth-backed Google Sheet and Calendar credentials
- production-grade backend hardening
- authentication and permissions
- audit logging
- async orchestration
- notifications

Why defer them:

- they are not required to prove the weekly matching loop
- they add a lot of setup and little additional product signal for this assessment
- the prototype should prove usability, logic, and review flow before production hardening

The core scheduling API and reasoning loop should still exist in prototype form, even if the integrations are simulated.

## 14. Measuring Impact

If this were piloted, we would measure:

- time saved per weekly scheduling cycle
- percentage of sessions auto-matched
- number of manual overrides required
- number of conflicts resolved without escalation
- double-bookings prevented
- fairness spread over 4 weeks
- draft approval rate
- average time to resolve a blocked session
- number of sessions that required a second-pass manual fix

These metrics tell us whether ops is actually being helped.

## 15. Tradeoffs and Risks

### Tradeoffs

- more automation can reduce work, but too much can reduce trust
- more detail can help explain the system, but too much detail can clutter the UX
- more LLM usage can improve language, but it can also make behavior less deterministic

### Risks

- if recommendations feel generic, the product will feel fake
- if the UI is cluttered, non-technical users will struggle
- if the model is opaque, ops won’t trust it
- if the LLM is asked to decide validity instead of explain decisions, the prototype will feel unreliable

### Product stance

The safest and strongest stance for this assignment is to be conservative:

- let rules decide validity
- let the ranking layer suggest the best feasible option
- let the LLM explain clearly
- let ops approve the final call

## 16. What Good Looks Like

This prototype is successful if it demonstrates that:

- a weekly draft can be generated automatically
- blockers are surfaced clearly
- unblock options are practical
- ops can approve confidently
- the scheduling process is visibly faster and safer than doing it manually

That is the right proof point for this assessment.
