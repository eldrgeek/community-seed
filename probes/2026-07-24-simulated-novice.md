# Simulated-novice probe #1 — Pat, ChatGPT-only, no terminal

**⚠️ THIS IS A SIMULATED PROBE.** Both roles (SHERPA and NOVICE) were played by one Claude
instance in a single session, working strictly from the live text of `SHERPA.md` and
`FOUNDING.md` (fetched from https://community-seed.netlify.app/seed/ on 2026-07-24, both
200 OK — a real fetchability check, at least). There was no real stranger, no real terminal,
no real npm, no real error output. **Per `EXTRACTION-LEDGER.md`'s own rule — "a claim moves
to evidence-backed only with a named external community and a dated observation" — nothing
here moves claims 8, 9, or 10 out of `guess`.** This exercise can only do one thing: find
places where the protocol's *literal text* is silent, ambiguous, or wrong for a plausible
real situation, before a real Pat hits them at AGI-26 on July 27.

Model/method: Claude (Sonnet) fetched both protocols live, then wrote a two-voice transcript
— SHERPA constrained to act only on SHERPA.md's literal text (improvising only where the
text is silent, and flagging that improvisation), NOVICE ("Pat": 58, MacBook Air, ChatGPT
Plus only, never opened Terminal, pastes imperfectly, mildly anxious at errors) — with four
scripted failure injections: (1) npm/Node missing, (2) partial error paste, (3) founding
packet lost at the chat→terminal seam, (4) a cost-anxiety question.

---

## Condensed transcript

### Step 1 — logistics (Part A)

> **SHERPA:** First, quick logistics. What computer will this live on — Mac, Windows, Linux, or only a phone?
> **PAT:** MacBook Air, it's from like 2023 I think.
> **SHERPA:** Good, that'll work. Which AI subscriptions do you pay for — Claude, ChatGPT, Gemini, any or several?
> **PAT:** Just ChatGPT Plus. I don't have the other ones.
> **SHERPA:** And have you ever used a terminal — the black text-command window?
> **PAT:** No, never. I've heard of it but never opened it.
> **SHERPA:** No shame in that at all — it just means we go slower and I explain more. That's fine.

### Step 1 — sentiments (Part B), condensed

Four questions asked one at a time, each with one follow-up, per the protocol. Pat's answers
were sincere and brief, e.g. on "what would you never want an AI colleague to do":

> **PAT:** I guess... pretend to know something it doesn't? Or make a decision that affects somebody without telling me first.
> **SHERPA:** Can you say a bit more about the "without telling me first" part — is that about being informed after, or having a say before?
> **PAT:** Before. I want to be asked, not just told what happened.

Consent gate, asked verbatim per the protocol:

> **SHERPA:** May I write a summary of your answers into a founding packet? It stays on your machine, for your community only — shared further only if you ever choose to.
> **PAT:** Sure, okay.

*(Flag, not improvisation — see Finding 5: at this exact moment nothing is "on your machine"; the packet exists only in this browser chat, which lives on OpenAI's servers.)*

### Step 2 — the founding packet

Sherpa produced the fenced `FOUNDING PACKET` block per spec (logistics, four sentiment answers
in Pat's words, closing line "Interviewed by ChatGPT on 2026-07-24, before any tools were
installed"), then said, per the protocol's exact instruction: "Keep this chat open, or copy the
packet somewhere safe — you'll hand it to your first colleague in a few minutes." Pat did
neither concretely — no explicit action was named for Pat to confirm.

### Step 3 — install

> **PAT:** Okay so is this going to cost me extra somehow? Like on top of my ChatGPT bill?

*(Injected failure 4.)* SHERPA.md and FOUNDING.md contain **no text anywhere** addressing
subscription cost. The sherpa has nothing literal to act on and must improvise entirely:

> **SHERPA:** *(improvised, not in protocol)* "The Codex CLI itself is included with your ChatGPT Plus sign-in — installing and running it doesn't charge you separately the way, say, buying an app would. I'd still keep an eye on your account's usage page the first few times, since some plans meter CLI/API usage differently from the chat website — I don't have that specific number for your plan in front of me."

Pat: "Okay... I guess let's try it." (Anxiety not fully resolved — see Finding 4.)

Sherpa proceeds per the routing table (ChatGPT → Codex) and the protocol's instruction to
check `node --version` first:

> **SHERPA:** Open Terminal — Cmd+Space, type "Terminal," hit Enter. Then type `node --version` and paste what it says.
> **PAT:** it says
> `zsh: command not found: node`

*(Injected failure 1 — npm/Node missing.)* Protocol text: *"check `node --version` first (if
missing, walk them through installing Node from nodejs.org)."* That's the **entire**
instruction — no concrete steps. Sherpa must invent the walkthrough wholesale:

> **SHERPA:** *(fully improvised)* "No Node yet — normal, let's install it. Go to nodejs.org, click the big green button (LTS version), open the downloaded .pkg file, click through the installer with defaults. When it's done, **close this Terminal window and open a new one** — that matters, it won't see Node until you do."

Pat does this, opens a new Terminal, `node --version` now returns `v22.x.x`. Sherpa gives the
install command from the table: `npm install -g @openai/codex`.

> **PAT:** it printed a bunch of stuff and then this at the end:
> `npm error code EACCES`

*(Injected failure 2 — partial paste.)* This is a real, common macOS failure mode (global npm
installs need write access to a system directory) — and Pat, anxious, pasted only the last
line, not the path or the preceding lines that would tell a real assistant what's actually
broken. The protocol's only instruction here is *"paste me what it printed... do not proceed
on 'it seemed to work.'"* It says nothing about what to do when what's pasted is **visibly
incomplete**. Sherpa has to notice and ask:

> **SHERPA:** *(improvised — protocol doesn't instruct this)* "That's just the last line — can you scroll up and paste everything from the `npm install` command you typed down to the next `$` prompt? I need the part that says which folder it was trying to write to."
> **PAT:** *(pastes the full block)*

Full output resolves it (a `sudo`-vs-`brew` fork the protocol also doesn't cover — see Finding
2). Install eventually succeeds; `codex` gate is met with pasted proof.

### Step 4 — the handoff

> **SHERPA:** Now let's make the place: `mkdir -p ~/Community && cd ~/Community`, then run `codex`. Once it starts, paste this as your first message — I'll give you the founding packet to include.
> **PAT:** wait — where'd that packet thing go? I think I closed the other tab by accident when I was downloading Node, and now this chat looks different, like a new conversation?

*(Injected failure 3 — packet lost at the chat→terminal seam, the exact scenario Ledger claim
#10 names as the weakest link.)* This is the sharpest finding of the run. SHERPA.md's only
safeguard was the soft line in Step 2 ("keep the chat open, or copy the packet somewhere
safe") — never confirmed, never gated. Once the tab/session is gone, **the sherpa itself has
no durable copy**, because nothing in the protocol ever told it to produce one outside the
chat transcript. Two branches were played out:

**Branch A — Pat starts a fresh sherpa chat and re-answers.** This works mechanically, but the
new answers are no longer "the version of them that has never used these tools" — Node and
Codex are now installed, the whole rationale Step 2 gives for interviewing *before* install is
silently gone, and nothing anywhere flags that this run's packet is now second-generation.

**Branch B — Pat just proceeds into the CLI without a packet at all.** FOUNDING.md Step 0 has
literal text for this: *"If there is no packet (they came without a sherpa), conduct the
interview yourself..."* But that branch was written for someone who **never had a sherpa**,
not for someone whose packet was **lost in transit**. A literal-text CLI agent cannot tell the
difference — it just silently falls into the "no sherpa" path, and nobody ever records that a
packet existed and was lost. The failure is invisible to everyone except this probe.

---

## Findings — protocol bugs, located in the literal text

1. **SHERPA.md Step 3, "walk them through installing Node from nodejs.org"** — zero concrete
   steps given (which installer, restart-terminal requirement). *Fix: inline the actual
   3-step Node install + "open a new Terminal window afterward" note, so the sherpa doesn't
   have to invent it from general knowledge.*
2. **SHERPA.md Step 3 has no mention of macOS `npm install -g` permission errors (EACCES)** —
   an extremely common first-Node-install failure on exactly this population. *Fix: add one
   contingency line, e.g. "if you see `EACCES` or `permission denied`, that's a common
   Mac-only snag — the safe fix is reinstalling Node via `brew install node` rather than using
   `sudo`."*
3. **SHERPA.md Step 3, "paste me what it printed"** has no instruction for handling a visibly
   partial/truncated paste. *Fix: "if what they paste looks like just the last line or two,
   ask them to paste everything from the command they typed down to the next empty prompt."*
4. **Nowhere in SHERPA.md or FOUNDING.md is subscription cost addressed** — a first-time
   terminal user paying for a subscription is very likely to pause here, and the sherpa
   currently has nothing literal to reassure them with. *Fix: add one line to Step 3's intro,
   e.g. "this CLI is part of the subscription you already pay for — say so plainly, and note
   that usage limits can differ from the chat website, so it's worth them checking their
   account's usage page once."*
5. **SHERPA.md Step 2's consent-gate line — "It stays on your machine"** — is not true at the
   moment it is said; before Step 3 the packet exists only inside the web chat, i.e. on the AI
   provider's servers, not the human's machine. Minor honesty/floor tension. *Fix: reword to
   "it stays in this conversation, then moves onto your machine once you copy it in a few
   minutes."*
6. **SHERPA.md Step 2's only safeguard against losing the packet is a soft, unverified
   suggestion** ("keep the chat open, or copy the packet somewhere safe") — no gate, no
   confirmation. This is the direct mechanical cause behind Ledger claim #10's fragility.
   *Fix: make saving the packet a real, verified sub-step — "paste it into Notes / email it to
   yourself right now, before we touch the terminal — tell me once you've done it."*
7. **SHERPA.md Step 4 has no paste-back verification gate** before the sherpa signs off,
   contradicting the protocol's own opening principle ("you do not proceed until what they
   paste shows the step worked"). Every earlier step has a gate; the handoff — arguably the
   highest-stakes step — does not. *Fix: add "Gate for this step: have them paste back what
   the CLI colleague said before you say your goodbye."*
8. **FOUNDING.md Step 0's "no packet" fallback conflates two different situations**: a human
   who never had a sherpa, and a human whose packet was lost in transit. The literal text
   treats both identically and silently, so a lost-packet event is never recorded anywhere as
   a degraded run. *Fix: add a branch — "if a packet was promised but is missing, say so
   honestly (on the wall or in the interview) rather than silently treating this as the
   no-sherpa case."*
9. **SHERPA.md Part A Q2 explicitly allows "any or several" subscriptions**, but Step 3's
   routing table and Step 4's template assume exactly one tool was chosen, with no guidance
   for someone who has to pick between two. *Fix: one line — "if they have more than one,
   let them choose; mention they can hire a colleague under the other subscription later."*
10. **SHERPA.md Step 3 says "tell them exactly how [to open a terminal] on their OS"** but
    supplies no actual per-OS text — the sherpa has to generate Mac/Windows/Linux
    terminal-opening steps from general knowledge every time. Low-severity, but it's exactly
    the kind of "improvise beyond the protocol" the probe was designed to catch. *Fix:
    optionally inline a 3-line per-OS cheat sheet.*

---

## Verdicts on Extraction Ledger claims 8, 9, 10

**Claim 8** — *"A web-chat AI can sherpa a novice through CLI install via paste-back gates
alone."* **Simulation modestly lowers confidence**, specifically in the word "alone." Paste-back
gates worked well for the two failures that are close to the text (npm/Node missing, partial
paste) — but only because this simulated sherpa was willing to improvise generously past silent
gaps (Findings 1–3, 10). The literal protocol text does not actually instruct a sherpa to catch
a truncated paste, invent Node-install steps, or handle the EACCES fork — success currently rides
on the underlying model's general competence, not on the protocol. **A real probe should watch:**
does a live sherpa actually notice and reject an incomplete paste, or does it optimistically
proceed on "it seemed to work" — that's the single highest-risk behavior for an LLM playing this
role.

**Claim 9** — *"A pre-install sentiment interview improves founding."* The simulation can't test
the causal claim at all (no outcome, no control) — genuinely out of scope for this method, so it
neither raises nor lowers confidence in the underlying hypothesis. It does, however, **lower
confidence that the mechanism reliably fires**: if the packet is lost before Step 2 of
FOUNDING.md (as simulated), the pre-tool interview never reaches the constitution at all, so
claim 9's precondition silently fails more often than the ledger's phrasing implies. **A real
probe should watch:** does the packet's actual wording show up recognizably in
`CONSTITUTION-STUB.md`'s three standards, or does the CLI agent draft generic-sounding standards
regardless of what's in the packet.

**Claim 10** — *"The founding packet survives the chat→CLI handoff."* **Simulation lowers
confidence directly** — this was the failure deliberately injected, and the protocol's only
defense (a soft, unverified suggestion in Step 2) did not hold under a plausible, mundane loss
event (an accidentally closed tab). Worse, the failure degrades **silently**: FOUNDING.md's
existing fallback path absorbs a lost packet as if no sherpa had ever been involved, so nobody
downstream — not Pat, not the CLI agent, not this ledger — would know it happened without a
probe explicitly looking for it, exactly as Finding 8 describes. **A real probe should watch:**
the actual rate at which a stranger's packet survives the seam unprompted, and whether a
recovered/re-interviewed packet is visibly thinner or more generic than a preserved one.

---

*Probe run 2026-07-24 by Claude (Sonnet), single session, no external human. Findings are
protocol-bug candidates only — no changes were made to `seed/SHERPA.md` or `seed/FOUNDING.md`
in this pass.*
