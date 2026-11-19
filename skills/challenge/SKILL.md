---
name: challenge
description: Do a task completely, then let the user pick the concepts they want to learn from it and censor pieces of the working code into coding challenges that teach them, with explanatory comments, from-scratch documentation, and official docs. Use only when the user asks for a challenge, as in "/challenge <task>".
argument-hint: <any task>
disable-model-invocation: true
---

The user is a developer who uses AI to build faster and wants to keep a real understanding of the code it writes. They learn by writing that code themselves. This skill wraps any task: do the task, let the user choose which concepts in it they want to learn, then turn pieces of the finished, proven code into **challenges** that teach those concepts, guided toward the best-practice solution you already wrote.

The task is the text that came with this skill. Its standards are the usual ones: the repo's agent instructions (AGENTS.md, CLAUDE.md, GEMINI.md, or similar), conventions, and tests apply exactly as they would without this skill.

Treat the user as **new to every topic they pick**. Each brief teaches the concept from the ground up before asking them to write it.

## Where things live

- **The archive**, `~/.didactic/` (or the folder named by `DIDACTIC_HOME`): reference solutions under `challenges/`, the practice log `LOG.md`, and `config.json` for the block settings.
- **The notes folder** in the repo: the folder your instructions name for a repo's local notes, otherwise `.didactic/` at the repo root. It must stay out of git: if `git check-ignore -q <folder>` fails, add the folder to `.git/info/exclude`, which is local and never committed.
- **The block tool**, `scripts/blocks.mjs` in this skill's folder, run with Node 20 or newer. Run it with the full path to this skill's folder; it's written `blocks.mjs` below.

## The repo stays ordinary

Everything committed to the repo reads as normal work by the project's own developers: code, comments, tests, docs, branch names, commit messages, and PR text all describe the software and its behavior, in the project's usual voice. Any test you add is named for the behavior it checks.

The learning layer (briefs, reference solutions, hints, the log) lives only in the archive, the notes folder, and your replies.

Before every commit, scan the diff for anything that mentions challenges, exercises, hints, reference solutions, this skill, or learning, and reword it as plain project language.

## 1. Finish the task, proven

Do the whole task to full functionality. Run every check the repo has (typecheck, lint, unit and browser tests) and exercise the change the way a user would.

Done when: everything passes and you have seen the change working. Challenges are made from code that is already **green**, never from a guess.

## 2. Offer topics, maybe blurs, then pause

Report the task's outcome briefly. Then list the **topics** the work involves, and wait for the user's choice before censoring anything.

Topics span every layer the work touches:
- how the system itself works (its state model, data flow, invariants, algorithms)
- the patterns it uses
- language features
- library or framework APIs
- browser behavior

For framework-free code, the system's own mechanics are usually the richest topics.

For each topic, give:
- one plain line on what it is
- the piece or pieces of code that would teach it
- whether `LOG.md` shows the user has practiced it before

With four topics or fewer, ask with a multiple-choice question tool if you have one (multi-select). Otherwise, give a numbered list and end your turn.

If `config.json` doesn't exist yet, this is the user's first run: along with the topics, explain the blur levels, showing one line of this task's code at each (`low` keeps spaces, `▓` brackets and `░` punctuation; `medium` drops the punctuation; `high` keeps only spaces; `bars` hides everything), and ask which to use by default. Write their choice to `config.json` as `{ "blur": "<level>" }`; if they don't pick one, write `low`. Later runs skip this, and the user can still ask for a different blur on any challenge.

Done when: the user has picked their topics (and, on a first run, a default blur). Topics the user says they already know go into `LOG.md` right away, with the outcome "already known, no challenge", so later lists mark them as practiced.

## 3. Choose the pieces

Plan as many challenges as the chosen topics need, one per piece. A big topic can take several pieces, and one piece can serve two topics. Each piece is one contiguous stretch of the code you wrote, 5–40 lines: a function body, a hook, a CSS rule block, a config section, or a test. A good piece:

- **Teaches its topic directly**, not as a side detail.
- **Goes red without it**: removing it makes a test fail, a type error appear, or a visible behavior break. That gives the user a **red/green** signal for knowing when they're done. If no existing check covers it, write one first, and prove it green as in step 1.
- **Stands alone**: everything around it stays in place, so the challenge is the concept, not reconstructing the surroundings.
- **Sits where a comment can**: in statement or declaration position, not inside JSX children or a string.

Glue code, secrets, and anything whose only "right" answer is memorized trivia make poor challenges. Order the challenges so each one builds on the ones before it, and give each a letter (`A`, `B`, …) and a short name.

## 4. Shape the pieces

Reshape each piece for reading, and prove it green again. Spread it into small functional steps, one idea each (a declaration, a guard, a call, a returned cleanup), with a blank line between steps. Above each step, write a comment explaining what it does and why, as well-written finished code would: generous enough that a reader new to the topic can follow the reasoning, without spelling out the syntax.

Run the project's formatter now, while the code is still whole. Formatters re-indent comments, which moves censored lines off their columns, so nothing formats a file again until its blocks are gone.

## 5. Censor the challenges

Censor each piece with the block tool. It saves the piece as the reference solution, replaces each code line with shading on the same columns, and frames the piece in block markers:

```sh
node blocks.mjs censor <file> --lines 38-73 --id C --title "Installing during render" \
  --tests 'npx vitest run -t "GDevice"' \
  --save ~/.didactic/challenges/<repo>/<YYYY-MM-DD>-<slug>/solution.<ext> \
  [--blur low|medium|high|bars] [--placeholder '<code>']
```

- **`--tests`**: the check command that turns this block green.
- **`--blur`**: how much the shading gives away. `bars` shades every character `▒`; `high` keeps spaces; `medium` also shows brackets as `▓`; `low` also shows operators and punctuation as `░`. Brackets are `()`, `[]`, `{}`, and, in languages with generics or tags, `<>` pairs; comparisons and shifts stay operators. Use `config.json`'s default unless the user asks for an easier or harder challenge.
- **`--placeholder`**: the smallest code that keeps the file compiling and the check red (a stub `const` of the right type, a `throw`). The tool puts it at the bottom of the block under a comment saying to delete it once the code above is written. Leave it out when the code around the block already compiles.
- **Title**: the tool rejects one too long for the block's width; shorten it.

Comments and blank lines stay exactly as written, so the user sees the piece's whole shape and spends their effort on what each line says. The tool prints the block's line range for the brief's links; `blocks.mjs list <file>` prints every block's range again.

To change a block after the user has started it (a new width, a new blur, a format change), use `blocks.mjs restyle <file> [--id C] [--blur C=low --solution C=<solution file>]`. It redraws the markers and re-places or re-shades only the censored lines; the user's own code stays as they left it. If a formatter has run over a block, pass its `--solution` so each censored line gets its column back.

Settings: `--width <columns|auto>` (default 50) and `--tab-width <columns|auto>` (default `auto`, read from `.editorconfig` and the editor's settings), with defaults from `config.json`, such as `{ "width": 50, "blur": "low", "tabWidth": "auto" }`. Width `auto` ends the markers at the project's line length.

Then create `brief.md` next to each saved solution: that challenge's brief from step 6, plus the file path, the line range, the blur, and the check command. References live outside the repo, so they never get committed. If a file you're censoring is already committed, tell the user that `git diff` would reveal the answer.

Run the checks again. Done when: they fail exactly where the censored blocks are (the **red** signal), and nowhere else.

Leave the challenge files uncommitted. Commit the rest of the task's work as you normally would, if the task called for commits.

## 6. Brief the user

Write one file, `challenge-<slug>.md` in the notes folder, with a heading for **every** topic from step 2, chosen or not:
- It opens with a short status (what was built, what's committed, what's red), a note on reading a block (the shading at each blur in use, and that formatting waits until a block is done), and a table of the challenges in order, with links, checks, and blur.
- Chosen topics get a full brief, in the planned order.
- Each topic the user didn't choose gets its own heading too, placed where it helps (a topic a later challenge builds on goes just before that challenge). It explains the concepts and summarizes what was built to handle that concern, with links to the code and official docs. When the user asked a question about a topic, the section answers it.

Each brief has these parts:

1. **The challenge**: the file and lines (as a clickable link), and what the code must do, in one or two sentences.
2. **How it works**: documentation that teaches the topic from scratch, tied to this code. Cover:
   - the problem it solves, shown by what goes wrong with the naive approach
   - the mechanism, phase by phase
   - a worked trace through this repo's real functions, using concrete values (a table works well)
   - the edge cases and failure modes the tests check, each named by its test
   - prior art in well-known libraries, where it exists
3. **Concepts**: each language feature or API the user needs, explained in plain terms, with how it applies here. Link the official documentation for each (MDN, react.dev, the library's own docs, the TypeScript handbook).
4. **What best practice looks like here**: the qualities the solution should have (for example, "derives the value instead of storing it", "cleans up its subscription"), never the code.
5. **Hints**, numbered from gentle to strong, under a line telling the user to read them only if stuck. The block already shows the code's shape, so hints are about what the lines say: which value, which call, which argument. The strongest hint still stops short of the answer.
6. **How to check**: the command that turns green, and what to look at in the running app.

Check that every link resolves before you write it.

Done when: the file has a section for every topic, and every saved `brief.md` matches its section.

Your reply then gives:
- the link to the file
- one line per challenge: its name, link, blur, and check command
- the order to do them in

## 7. Review the user's solution

When the user says they're done or asks for a check, run the checks and compare their code with the reference:

- **Green**: say so, then review it like a senior colleague. Note what's idiomatic, and explain any difference from the reference and why one might be preferred. Different but equally good is a pass; say that too.
- **Still red**: show which check fails and what it means, and offer the next hint. If the user is stuck on the concept itself, expand that topic's **How it works** section in both copies of the brief rather than only answering in chat. A lower blur (`restyle --blur`) is a stronger hint the user can ask for. Reveal the reference only when they ask.

For each finished challenge, append a line to `LOG.md` (`date · repo · concept · outcome`), so future challenges build on what the user has practiced. Once every challenge in a file is green, run `blocks.mjs clean <file>`, which removes the markers, any leftover censored lines, and the placeholder. Then pare the step comments down to the ones that explain something non-obvious, run the formatter, and commit if the task called for commits.
