# LinguaQuest — Roadmap v2.0

> **Supersedes:** Original phase-based roadmap (Phase 1–8 era)
> **Session:** 2026-03-13
> **Status:** Full redesign — campaign system + living world architecture

---

## What Changed

The original roadmap assumed a sandbox world-generator. The new vision is a **narrative detective RPG** with AI-driven living NPCs. Every character has a soul document, pursues their own goals, interacts with each other, and moves through the world — whether or not the player is watching. See `SCHEMA.md` for the full data architecture.

---

## Phase 0 — Foundation Cleanup ✅ 2026-03-13
*Prerequisite changes before any new features. Clean slate.*

- [x] **0.1** Remove `#prompt-bar` HTML, CSS, `generateWorld()`, and `T` key shortcut
- [x] **0.2** Remove autogen toggle from menu (`#autogen-toggle-row`, `AUTO_GEN` logic)
- [x] **0.3** Rebuild main menu: `Play Default Campaign` / `Generate Campaign (soon)` / `Continue (soon)`
- [x] **0.4** Create all 7 Supabase tables from SCHEMA.md with proper indexes

---

## Phase 1 — Campaign Bootstrap ✅ 2026-03-13
*Get a playable campaign loading from the database with the main cast alive.*

- [x] **1.1** `createCampaign()` — generates world_state skeleton, writes `lq_campaigns` + `lq_player_state` rows
- [x] **1.2** Main cast soul generation — Template A for all 6 characters (Petra, Ramos, Father Tomás, Mirela, Sonia, Delgado)
- [x] **1.3** Initial planned events — lightweight boot events for each main cast NPC to seed the event queue
- [x] **1.4** Starting chunk — `ARENAS_BLANCAS_WORLD` hardcoded 22×16 tile map with NPC positions from soul documents, saved to `lq_chunks`
- [x] **1.5** Save/load system — `saveGame()` / `loadGame()` using campaign_id in localStorage, auto-save every 30s

---

## Phase 2 — The World Tick
*Get time moving and planned events executing.*

- [ ] **2.1** In-game time system — clock advances at 120 in-game minutes per real minute; display in HUD
- [ ] **2.2** Idle detection — 2-minute threshold; pause overlay on idle or tab/window focus loss (Page Visibility API)
- [ ] **2.3** World Tick loop — `setInterval` every 10 real seconds; queries + advances `lq_planned_events`; writes `lq_world_events`; applies consequences
- [ ] **2.4** Live chunk updates — World Tick pushes notifications to current chunk when events affect it; NPCs visibly arrive/depart

---

## Phase 3 — NPC Reasoning Loop
*The core of what makes characters feel alive.*

- [ ] **3.1** Chunk entry sweep — before rendering NPCs on `loadChunk()`, fire lightweight Template B for each NPC present in parallel
- [ ] **3.2** Encounter reasoning loop — full Template B fires when player presses E; brief "thinking" state in dialogue box; opens with freshly computed current situation
- [ ] **3.3** Cascade write system — after any reasoning loop, extract cascade entries and write to target NPC event logs; queue background soul generation if target has no soul document yet
- [ ] **3.4** Post-conversation record — after dialogue closes: update emotional_state, write event log entry, update player_trust, check discovered_facts, optionally generate new planned event

---

## Phase 4 — Conversation System Upgrade
*Replace current single-context dialogue with full soul-aware system.*

- [ ] **4.1** Template C implementation — rebuild `callClaude()` with soul document, trust level, relationship history, world state, player reputation
- [ ] **4.2** Streaming with soul — NPC "thinks" before speaking; response streams from a character with inner life
- [ ] **4.3** Trust system — extract trust delta from Template C; update `player_trust` and history; trust can decrease; `trust_broken` caps recovery at 0.6
- [ ] **4.4** NPC-initiated conversation — NPC floats a dialogue bubble when player is within 1.5 tiles and their `current_preoccupation` or `emotional_state` makes it plausible
- [ ] **4.5** Strategic lying — post-conversation pass compares NPC statement against world_state objective facts; writes `lie_told` flag to event log if contradiction detected

---

## Phase 5 — Cross-Chunk Coherence
*Make the world spatially consistent regardless of where the player is.*

- [ ] **5.1** NPC position tracking — `lq_npcs.current_chunk` updated live by World Tick; chunk loading queries this to determine who is present
- [ ] **5.2** Movement event rendering — animate NPCs walking in/out of chunk when movement events resolve; silent DB update if player not present
- [ ] **5.3** Chunk state rendering from world events — `loadChunk()` queries `lq_world_events` for that chunk before rendering; applies damage, absent NPCs, placed items to world_def
- [ ] **5.4** Story gravity for new chunks — chunk generation prompt includes `distance_from_origin` and campaign world_state; story connection probability: 60% (dist 1–3), 30% (dist 4–6), 10% (dist 7+)

---

## Phase 6 — The Case File & Campaign Resolution

- [ ] **6.1** Case file UI — C or Tab opens journal overlay; shows `case_file` entries + `active_leads`; Escape to close
- [ ] **6.2** Automatic case file updates — Template C output includes optional `case_file_entry`; appended automatically; "Journal updated" toast
- [ ] **6.3** Lead tracking — leads added by conversations; marked resolved when completed; player's narrative quest log
- [ ] **6.4** Resolution detection — after each `discovered_facts` update, check against `resolution_conditions`; trigger final scene + end-of-campaign Spanish performance report

---

## Phase 7 — Polish & Language Learning Integration

- [ ] **7.1** Reputation propagation — after significant interactions, update `world_state.player_reputation`; propagate via gossip system; new NPCs read this for first impressions
- [ ] **7.2** Seasonal/environmental world events — World Tick fires world-level events (storms, festivals, droughts) at in-game day thresholds; affects NPC behavior via reasoning loops
- [ ] **7.3** Language difficulty scaling — `spanish_difficulty` + `min_trust_to_advance` create natural curve; Delgado uses formal subjunctive; early NPCs use simple present; Template C calibrates to NPC's `spanish_register`
- [ ] **7.4** End-of-campaign language report — on completion, Claude generates Spanish learning summary: error patterns, vocabulary encountered, trust levels as conversation quality proxy

---

## Future (Not Scheduled)

- **Generate Campaign** — player describes a setting and Claude generates a full campaign from scratch using the default campaign as a template
- **Multiple languages** — Russian, French, etc. Campaign language is a configurable field
- **Multiplayer** — architecture already supports it (player modeled as world entity); two players share world_event_log and world_state
- **School mode** — student accounts, teacher dashboard, progress tracking per student
- **Math mode** — NPCs that quiz on math instead of language

---

## Default Campaign: "La Lengua del Culpable"

**Premise:** You arrive by boat to the coastal village of Arenas Blancas to deliver a letter to Don Esteban Velarde. His door is open. He's gone. The constable suspects you.

**Truth:** Don Esteban was smuggled out alive by Los Silenciosos — a quiet network of merchants and officials who use debt and fear to control what people say. He found proof of their operation. He's being held at a farmhouse two regions east. The letter you're carrying was a warning from his niece: *"They're watching you. Run."* It arrived too late.

**Main Cast:**
- **Doña Petra** — innkeeper, info broker, warm but guarded
- **El Viejo Ramos** — old fisherman who saw something and convinced himself he didn't
- **Father Tomás** — priest who heard a confession he can't reveal; guides indirectly
- **Constable Mirela Fuentes** — young, compromised, not corrupt — just scared
- **Sonia** — Don Esteban's niece; knows more than she told you
- **Capitán Delgado** — port official; the villain's face; charming, never overtly villainous

**World structure:** Arenas Blancas (Act 1) → Road East through 2–3 generated chunks (Act 2) → La Hacienda Roja (Act 3)
