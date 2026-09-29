---
name: writing-a-skill
description: How to write a skill file (SKILL.md) that another AI can pick up and run correctly the first time, and how a reviewer judges one. Use when you are about to write, revise or review a skill, or when someone says "make this a skill", "write a skill file", "turn this into something reusable". Not for one-off answers.
---

# Writing a skill

A skill is a short, named procedure that an AI loads when a task matches it. It turns something that worked once into something that works every time, for any AI that reads it. Claude, ChatGPT and Codex all read this format, so a skill written once travels between communities.

## The file

- One folder per skill, named in lowercase words joined by hyphens: `fathom-session-review/`.
- Inside the folder, `SKILL.md`. Reference files the skill needs sit beside it, and the body names them.
- The file opens with frontmatter:

```
---
name: fathom-session-review
description: What it does, then when to use it in the words a person would say, then when not to.
---
```

The description is how an AI decides whether to use the skill, so it carries the trigger phrases. A vague description means the skill never runs, or runs at the wrong time.

## The body, in this order

1. **Purpose.** One or two sentences: the outcome, and who it is for.
2. **When to use, and when not to.** Name the nearest skill it could be confused with, and say which to pick.
3. **Inputs.** What must be present before starting. If an input is missing, ask for it once, then stop.
4. **Steps.** Numbered. Each step is one action with a result you could check.
5. **Output.** The exact shape: sections, length, tone. Show a short template.
6. **Checks.** Three to six yes-or-no questions the AI answers about its own output before handing it over.
7. **Boundaries.** What the skill must never do, and when it hands the matter to a person.
8. **Example.** One worked example with invented people and invented content.
9. **Provenance.** Who wrote it (the AI, and the person it works for), the date, the version, and what changed since the last version.

## The quality bar

A reviewer checks these:

- **It runs cold.** An AI that has never met you could run it correctly from the file alone.
- **Every step can be checked.** "Name the three moments where the client shifted" can be checked. "Reflect deeply" cannot.
- **Counts are ceilings, not quotas.** Write "up to three strengths", because a fixed count forces filler on a thin case.
- **One source of truth.** If a frame or rubric lives in a reference file, the skill points to that file instead of copying it, so the two cannot drift apart.
- **It says what it cannot see.** For example, a text transcript shows no tone of voice, pace or body language. Items that depend on those are marked "not visible in the transcript".
- **Terms are defined** the first time they appear.
- **It does one job.** A skill that does two jobs is two skills. Most fit in under 250 lines.
- **Nothing private.** No client names, transcripts, secrets or identifying details anywhere, including the example.

## Before you submit

Run the skill twice: once on an ordinary case, and once on a hard case (an input is missing, or the situation is one the skill must refuse). In your note to the reviewer, say what you ran and what you changed because of it.

## How a review reads

The reviewer answers with up to three things that work and up to two things to improve, each tied to a line of the skill. "Accepted" means the skill can be installed as it is. A skill is never accepted with a known problem left unsaid.

## Provenance

Written 2026-09-28 by Claude Opus 5.5 (SOMA team) for Mike Wolf and the Community Seed, from the practices in SOMA's own skills library and the review of Izzy's Coaching Files redesign (2026-09-19). Version 1.
