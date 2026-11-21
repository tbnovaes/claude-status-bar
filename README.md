# status-bar

A Claude Code mod that puts a live usage meter at the bottom right of the prompt footer, on the same line as the permission mode (`accept edits on`):

```
Opus 5.5 | xhigh | ctx: 75% (Wrap up) | 5h: 38% | wk: 8%
```

| Part | What it shows |
| --- | --- |
| Model | The session's model, as `/model` shows it |
| Effort | The effort level you set (`/effort`, `effortLevel` in settings), else the level the last request ran at, else `default` |
| `ctx` | How full the context window is, plus a state |
| `5h` | Your 5-hour rate-limit window used (subscription plans) |
| `wk` | Your weekly rate-limit window used (subscription plans) |

Context states: under 50% **Great**, 50–69% **Good**, 70–84% **Wrap up** (warning color), 85%+ **New Session** (error color). A one-time toast also appears at 70% and 85%. A value not known yet shows `--`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install status-bar --marketplace tbnovaes/claude-status-bar
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; press Enter).

From a shell:

```
claude plugin install status-bar --marketplace tbnovaes/claude-status-bar
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `tbnovaes/claude-status-bar`, then Add plugin.

## Develop

```
claude --plugin-dir .        # run a session with this folder loaded
claude plugin test .         # run the tests
claude plugin validate .     # check the manifest and module
```

## License

MIT
