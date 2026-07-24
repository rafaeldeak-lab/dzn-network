# DZN Event And Tournament Roadmap

Phase 2A implements the performance foundation, public community suggestions, voting, moderation, and creator-only conversion into private official drafts. The tournament engine, enrolment, scoring, brackets, Discord announcements, rewards, and automation remain later phases.

## Supported Future Competition Types

- server-vs-server competitions;
- player-vs-player competitions;
- squad and clan competitions;
- multi-server stat leaderboards;
- knockout brackets;
- double elimination;
- round robin;
- league format;
- qualifying rounds;
- timed stat races;
- multi-stage championships;
- invite-only events;
- community challenges;
- manual/referee events.

## Creator Workflow

Stage 1: Server Enrolment Announcement

The platform creator selects:

- competition type;
- eligibility;
- platform;
- broad date window;
- maximum server slots;
- reserve slots;
- first-come or invite-only entry;
- enrolment deadline.

Connected server owners receive explicit options:

- accept;
- decline;
- tentative.

Server enrolment states:

- invite_pending;
- tentative;
- accepted;
- declined;
- withdrawn;
- waitlisted;
- confirmed;
- locked.

Slots must use atomic holds with expiry and waitlist promotion. No public or server-owner action can publish official rules without creator approval.

Stage 2: Final Tournament Setup

After participating servers are known, the system may recommend compatible:

- challenge templates;
- maps;
- host servers;
- roster sizes;
- scoring modes;
- bracket formats;
- round durations;
- time zones;
- tie-breakers;
- evidence requirements.

Nothing publishes until the platform creator approves final rules and any global announcement.

Community suggestion reports, abuse signals, reporter identities, and moderation-only counters remain private to owner/creator moderation. Future public discussion features must rank by public activity such as votes or comments, never by report volume.

## Server And Player Attribution

Event data must separate:

- `represented_server_id`: who the player or squad represents;
- `host_server_id`: where the event or match is hosted.

Player attribution flow:

1. Discord login.
2. Platform identity and gamertag entry.
3. Select represented server.
4. Roster request.
5. Server owner or captain approval.
6. Player acceptance.
7. Timed check-in.
8. Event roster lock.
9. ADM/log observation where available.
10. Confidence and collision review.

A Discord button click alone is not proof of representation. Attribution should combine authenticated platform user, server owner approval, roster snapshot, player acceptance, event check-in, observed gamertag/ADM identity, identity-change flags, and creator review for conflicts. Never attribute players only from a Discord display name.

## Challenge Templates

Future templates should declare:

- compatible platforms;
- compatible maps;
- compatible server categories;
- required telemetry;
- data-quality requirement;
- verification mode;
- scoring formula;
- tie-breakers;
- minimum and maximum players;
- duration;
- team size;
- manual evidence requirement;
- referee requirement;
- host-server requirements.

Potential auto-verifiable challenges:

- kills;
- K/D;
- longest kill;
- first blood;
- kill streak;
- survival time;
- deaths;
- unique opponents;
- timed stat delta;
- aggregate team score.

Semi/manual challenges:

- boxing event;
- scavenger hunt;
- building competition;
- roleplay event;
- custom objective mode;
- events where telemetry is incomplete.

Do not mark a challenge auto-verifiable unless current stored telemetry proves it.

## Scoring And Winners

Future scoring must use:

- locked rule versions;
- UTC event windows;
- baseline snapshots;
- append-only score ledger;
- deterministic recomputation;
- idempotency keys;
- late-log grace period;
- provisional results;
- dispute state;
- creator finalization;
- audited manual adjustment;
- immutable final snapshot.

For player-vs-player events, default podium is top 3. Optional finalist and spotlight count should be configurable with a safe default of `clamp(3, 10, ceil(sqrt(number_of_finishers)))`, not hardcoded globally.

For server-vs-server events, scoring must prevent larger servers from winning only through player volume. Supported balancing models:

- equal roster size;
- best-N contributors;
- score per active minute;
- per-capita score;
- capped contributors;
- head-to-head results;
- normalized objective points.

## Discord And Homepage Announcements

This phase designs these systems only. It does not enable or send Discord messages.

Future message types:

- server enrolment open;
- enrolment closing;
- server accepted;
- server waitlisted;
- rules published;
- player registration open;
- check-in open;
- event live;
- round progress;
- provisional result;
- final winner;
- server spotlight;
- player podium.

Announcement channels must separate:

- DZN-wide opt-in global announcements;
- participating-server operational updates.

Requirements:

- delivery queue;
- per-channel delivery rows;
- dedupe key;
- edit existing message where appropriate;
- retries;
- dead-letter state;
- permission checks;
- opt-in;
- creator approval for global broadcasts;
- `allowed_mentions: { parse: [] }`;
- no arbitrary browser-supplied channel IDs;
- no Discord sends during suggestion, moderation, conversion, or preview verification.

Future homepage components:

- upcoming event card;
- registration countdown;
- live event card;
- participating server carousel;
- live leaderboard;
- winner spotlight;
- server publicity links;
- View Event;
- Join Event.

## Phase Boundaries

Phase 2A:

- suggestions;
- votes;
- reports;
- strict moderation;
- creator-only conversion to private draft;
- performance foundation;
- skeletons and navigation progress.

Later phases:

- server enrolment invitations;
- player rosters and representation;
- bracket generation;
- live scoring;
- score finalization;
- winner rewards and badges;
- Discord event announcements;
- homepage event promotion;
- scheduled tournament automation.

Official event administration remains creator-only across all phases.
