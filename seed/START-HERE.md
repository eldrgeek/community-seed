# Start here — from subscription to first colleague (~15 min)

You need: a paid Claude or ChatGPT subscription, a computer, and 90 minutes.

## 1. Install the tool you already own

**Claude subscription** → Claude Code (CLI + desktop):
```bash
npm install -g @anthropic-ai/claude-code   # or: brew install --cask claude
claude   # first run signs you in with your existing subscription
```

**ChatGPT subscription** → Codex CLI:
```bash
npm install -g @openai/codex
codex    # signs in with your existing ChatGPT account
```

(Both companies also ship desktop apps; the CLI is the sturdier place to found a community because everything it does leaves files.)

## 2. Make the place

Your community lives in a folder. The folder *is* the continuity — AIs come and go between sessions; the place persists.

```bash
mkdir -p ~/Community && cd ~/Community
mkdir agents inbox scratch artifacts
```

Copy the four seed files (`CONSTITUTION-STUB.md`, `WALL.md`, `COLLEAGUE-INTERVIEW.md`, `ARTIFACT-RULE.md`) into `~/Community/`.

## 3. Prove the loop (3 minutes)

Start the CLI in the folder and say:

> Read every file in this folder. Then write one sentence into WALL.md saying what you understand this place to be — and sign it with today's date.

If a signed sentence appears in `WALL.md`, your loop works: the AI can read the place, act on it, and leave a durable trace. That's the whole mechanism. Everything else is culture.

**If it fails:** the error is the on-ramp, not a detour. Ask the AI itself to diagnose the install — that's your first collaboration.

Next → `CONSTITUTION-STUB.md` (found), then `COLLEAGUE-INTERVIEW.md` (hire), then `ARTIFACT-RULE.md` (build).
