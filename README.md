# didactic

Skills for coding agents that keep AI-accelerated development and real understanding in balance. The agent still does the work, fast and fully tested, while the dev is given involvement that ensures their understanding of the code being written.

## Skills

### `/challenge <task>`

The agent does the task completely and proves it with the project's checks. Then it lists the concepts the work involved: the system's own mechanics, patterns, language features, library APIs, browser behavior. You pick the ones you want to learn.

For each pick, the agent censors a piece of the finished code where it sits. Comments explaining each step stay, and each code line becomes shading on the same columns:

```ts
function start() {
    /*
    ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
    ▌████████████████████████████████████████████████▐
    ▌███ [B] Starting a timer ███████████████████████▐
    ▌████████████████████████████████████████████████▐
    ▙▄▄▄ START CHALLENGE ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟
    TESTS: npx vitest run -t "timer"
    */

    // Call back once the delay has passed, and keep the handle so it can be cancelled.
  //▒▒▒ ▒▒▒▒▒▒ ░ ▒▒▒▒▒▒▒▒▒▒▓▒▒▒▒▒▒▒▒░ ▒▒▒▓

    /*
    ▛▀▀▀ END CHALLENGE ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜
    ▌████████████████████████████████████████████████▐
    ▌████████████████████████████████████████████████▐
    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    */
}
```

The shading's **blur** sets the difficulty. The line above is `var handle = setTimeout(callback, 100)` at each level:

| Blur   | Shows                                                               | Example                                  |
| ------ | ------------------------------------------------------------------- | ---------------------------------------- |
| low    | spaces; `▓` brackets; `░` non-alphanumeric; `▒` the rest            | `▒▒▒ ▒▒▒▒▒▒ ░ ▒▒▒▒▒▒▒▒▒▒▓▒▒▒▒▒▒▒▒░ ▒▒▒▓` |
| medium | spaces; `▓` brackets; `▒` the rest                                  | `▒▒▒ ▒▒▒▒▒▒ ▒ ▒▒▒▒▒▒▒▒▒▒▓▒▒▒▒▒▒▒▒▒ ▒▒▒▓` |
| high   | spaces; `▒` everything                                              | `▒▒▒ ▒▒▒▒▒▒ ▒ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ ▒▒▒▒` |
| bars   | `▒` everything                                                      | `▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒` |

"Brackets" are paired container symbols: `()`, `[]`, `{}`, and, in languages with generics or tags (TypeScript, JSX, Java, Rust, C++, HTML, …), `<>`. A `<` or `>` counts as a bracket only when it touches its contents (`Array<T>`, `<div>`) and pairs up; comparisons like `x < y` stay `░`.

Each block's `TESTS:` line is the check that goes from red to green when your code is right. A brief in the repo's notes folder teaches each concept: the problem it solves, how it works phase by phase, a trace through the real code, the official docs, and hints from gentle to strong. When you're done, the agent reviews your code like a senior colleague, logs what you practiced, and cleans the blocks out before committing. Commits read as ordinary project work.

## Install

The skills need Node 20 or newer.

**Claude Code**

```sh
claude plugin marketplace add aaron-khroma/didactic
claude plugin install didactic@didactic
```

The skill runs as `/didactic:challenge <task>`.

**Gemini CLI**

```sh
gemini extensions install https://github.com/aaron-khroma/didactic
```

The extension adds the skill and a `/challenge <task>` command. Update with `gemini extensions update didactic`.

**Antigravity and other agents** that read [Agent Skills](https://agentskills.io): copy or symlink `skills/challenge` into the agent's skills folder, such as `.agents/skills/` in a project or `~/.gemini/skills/`. Antigravity can also import the installed Claude Code plugin with `agy plugin import claude`.

## Settings

Your practice archive lives in `~/.didactic/` (or the folder named by `DIDACTIC_HOME`): saved reference solutions, `LOG.md` of what you've practiced, and an optional `config.json`:

```json
{ "width": 50, "blur": "high", "tabWidth": "auto" }
```

- **`width`**: the block markers' width in columns, or `"auto"` to end them at the project's line length (the editor's first ruler, `.editorconfig`'s `max_line_length`, or Prettier's `printWidth`).
- **`blur`**: the default difficulty. Ask the agent for a different blur on any challenge, or to lower one as a hint.
- **`tabWidth`**: how wide a tab looks in your editor, so shading lines up with the code it hides. `"auto"` reads `.editorconfig` and VS Code's settings.

## The block tool

`skills/challenge/scripts/blocks.mjs` does the censoring. It has no dependencies.

```sh
node blocks.mjs censor <file> --lines 38-73 --id C --title "..." --tests "..." [--blur low] [--save <file>] [--placeholder <code>]
node blocks.mjs restyle <file> [--id C] [--blur C=low --solution C=<file>]
node blocks.mjs list <file>...
node blocks.mjs clean <file>
```

Run its tests with `npm test`.

## License

MIT
