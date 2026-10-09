# opencodeignore-v2

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.com)
[![OpenCode V2](https://img.shields.io/badge/OpenCode-V2_plugin-7c3aed)](https://opencode.ai/v2/docs/)
[![Effect](https://img.shields.io/badge/Effect-peer_dep-red)](https://www.npmjs.com/package/effect)

OpenCode V2 Effect plugin. It reads `.agentignore` files and keeps matching paths away from the agent through permission enforcement, search filtering, and script commands.

## Features

- Guard files with gitignore-style syntax, nested overrides, and `!` negation.
- Hard enforcement for `read` and `edit`, configurable as `ask` or `deny`.
- Post-filtering of `glob` and `grep` results plus prompt attachment stripping.
- Optional system prompt injection with a compact rule list and a loadable policy skill.
- Script commands (`/ignore-init`, `/ignore-on`, `/ignore-off`, `/ignore-switch`, `/ignore-status`) that edit files and config without involving the agent.
- RPC contract (`isIgnored`, `listRules`, `updated` event) for other plugins and clients.

## Install

### Local

Run the plugin from source, no registry needed.

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/DotBlood/opencodeignore-v2.git
cd opencodeignore-v2
bun install
```

2. Register the plugin in the project config (`opencode.jsonc` at the project root or `.opencode/opencode.jsonc`), with the path pointing at the checkout:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencodeignore-v2",
      "options": {
        "enabled": true,
        "effect": "deny",
        "skill": { "enabled": true, "compactLimit": 2000 },
        "shellScan": false,
        "gitHistory": false,
        "respectGitignore": false
      }
    }
  ]
}
```

Relative paths resolve from the config file holding the entry, so `"./"` works when the config sits at the checkout root.

3. Restart the service and confirm the plugin loads:

```bash
opencode service restart
```

Then run `/ignore-status` in any session. It prints guard state, scope (`local`), rule counts, and the config entry in use.

4. Create the guard file:

```text
/ignore-init
```

This writes the project root `.agentignore` with commented starter templates. Uncomment what applies; the watcher picks up edits on its own.

Local installs read only the project `.agentignore` chain.

### Global

Install once, guard every project from a single base file.

1. Install the package globally:

```bash
opencode plugin add opencodeignore-v2
```

2. Create the base file at `$XDG_CONFIG_HOME/opencode/.agentignore` (default `~/.config/opencode/.agentignore`):

```text
# base rules apply to every project
*.key
.env
```

Only uncommented lines count, same syntax as project files. A missing base file means no base rules.

3. Tune options in the global config (`~/.config/opencode/opencode.jsonc`) when the defaults do not fit:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencodeignore-v2",
      "options": { "effect": "deny" }
    }
  ]
}
```

`opencode plugin add` registers the entry; edit the file to change options.

4. Restart the service and confirm:

```bash
opencode service restart
```

Run `/ignore-status` in any session. It reports scope `global (base + local)` plus rule counts.

Project `.agentignore` files keep working on top of the base: create one with `/ignore-init`. Local rules override base rules, identical repeats collapse to one.

## Layering and precedence

- Local mode (plugin directory inside the project): project files only.
- Global mode (plugin directory outside the project): base file first, project chain after.
- Inside the project, files apply from the root down into subdirectories. Later sources override earlier ones, so project rules beat base rules and deeper files beat shallower ones.
- Identical rules (same scope and pattern) are deduplicated. The first occurrence wins, repeats drop out of matching, listings, and injected text.

## `.agentignore` syntax

One pattern per line, as in `.gitignore`:

```text
# comments start with #
dist/
*.log
!important.log
/secrets.txt
sub/tmp/
```

`dir/` matches a directory and everything under it, `!` re-includes, a leading `/` anchors to the file location. Each file's patterns are relative to the directory holding that file.

## Commands

Each command runs as plain script steps and takes no arguments. Confirmations use a non-resuming message, so no model turn starts:

- `/ignore-init` creates the project root `.agentignore` with commented starter templates. An existing file stays untouched.
- `/ignore-on` and `/ignore-off` enable or disable the guard.
- `/ignore-switch` flips the effect between `ask` and `deny`.
- `/ignore-status` reports the current state:

```text
.agentignore guard: on
effect: deny
scope: local
root: <project-root>
rules: 12 (2 files)
config: <project-root>/opencode.jsonc [#0]
commands: /ignore-init | /ignore-on | /ignore-off | /ignore-switch | /ignore-status
```

`scope` reads `global (base + local)` for global installs.

`on`, `off`, and `switch` rewrite the plugin options in the `opencode.json(c)` file that declares the plugin entry. Formatting and comments survive through JSONC edits. In-memory state refreshes at once and on every config update.

## Options

| Key | Default | Meaning |
| --- | ------- | ------- |
| `enabled` | `true` | Master switch for every hook and injection |
| `effect` | `"deny"` | `"ask"` or `"deny"` when the agent touches a guarded path |
| `skill.enabled` | `true` | Register the policy skill and inject the compact rule list into the system prompt |
| `skill.compactLimit` | `2000` | Character budget for the injected rule list, max `20000` |
| `shellScan` | `false` | Opt-in heuristic check of shell commands for guarded path tokens (tripwire, not a boundary) |
| `gitHistory` | `false` | Opt-in git history reader checks: `rev:path` references and bare content-emitting forms |
| `respectGitignore` | `false` | Also load project `.gitignore` files with the same matcher |

## Enforcement

- `read` and `edit` on guarded paths resolve to the configured effect with a reason.
- `glob` and `grep` results lose guarded paths after execution. Grep still scans file contents first, only the reported paths drop out.
- Guarded file attachments come off incoming prompts.
- Shell scanning is token based and best effort. `shellScan` catches direct references such as `git add secrets/key`. `gitHistory` additionally covers git history readers: guarded paths in `rev:path` form (`git show HEAD:secrets/key`) plus bare content-emitting forms (`git log -p`, `git show`, `git diff`) while rules exist. Both still miss `git add .`, globs like `*.log`, name-only output (`status`, `log --stat`), and variable indirection. Mirror sensitive entries in `.gitignore`: committed history sits outside this guard. For real shell control use the native `shell` permission allowlist in `opencode.jsonc`, for example `{ "action": "shell", "resource": "git add *", "effect": "ask" }`.
- An explicit configured `deny` stays final. The hook only refines `allow` and `ask`.

## RPC

`./rpc` exports the `opencodeignore` contract: `isIgnored` and `listRules` methods plus the `updated` event, validated with Effect Schema. Other Effect plugins call it through their plugin context. HTTP clients use the generated client with the same contract module.

## Project structure

```text
src/
  index.ts          plugin entry: lifecycle, hooks, command registration
  rpc.ts            public RPC contract (exports map)
  guard/
    matcher.ts      .agentignore chain loading, dedup, path matching
    decide.ts       permission decisions per action and resource
    result-filter.ts  glob/grep result and prompt attachment filtering
  options/
    config.ts       option parsing with safe defaults
    config-file.ts  locate and patch the plugin entry in opencode.json(c)
  commands/
    actions.ts      /ignore-* business logic with injected dependencies
    definition.ts   action types, starter template, effect toggle, usage text
  skill/
    policy-text.ts  compact policy text for prompts and the skill
test/               mirrors src/, one file per module
opencode.jsonc      local plugin entry for development
```

Imports use path aliases (`@`, `@guard`, `@options`, `@commands`, `@skill`, `@rpc`) mapped in `tsconfig.json`. Bun resolves them at runtime.

## Development

```bash
bun test
bun run typecheck
```

`effect` stays pinned to the exact version the plugin types were built against (`4.0.0-rc.112`). Keep the pin while developing. Broaden the peer range only when publishing, then re-run both commands.

## Publishing checklist

- Set a registry name, remove `private`, keep the license file.
- Keep `exports` for `.` and `./rpc`. Keep `effect` and `@opencode/plugin` out of the bundle.
- Pack and install the tarball in a clean directory, then repeat the smoke checks there instead of trusting a workspace-linked copy.
- Test global installs with and without the base file, and confirm `/ignore-status` reports the expected scope.

## Limitations

- A path is tested both as given and with a trailing slash, so a file whose name matches a `dir/` rule counts as ignored.
- Grep output filters by path. Matches inside guarded files still get scanned, just never reported.
- Shell scanning matches explicit path tokens only. It cannot see through variables, pipes, or generated paths.
- The base file applies to every project for global installs. No per-project exclusion from the base layer exists.
