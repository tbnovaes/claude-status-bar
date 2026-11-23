# status-bar

A Claude Code mod that puts a live usage meter at the bottom right of the prompt footer, on the same line as the permission mode (`accept edits on`):

```
Opus 5.5 | xhigh | ctx: 62% 124k (Compact) | 5h: 38% (2h 13m) | wk: 8% (4d 3h)
```

| Part | What it shows |
| --- | --- |
| Model | The session's model, as `/model` shows it |
| Effort | The effort level you set (`/effort`, `effortLevel` in settings), else the level the last request ran at, else `default` |
| `ctx` | How full the context window is, the tokens in it, and a state, all in the state's color |
| `5h` | Your 5-hour rate-limit window used, and the time left until it resets (subscription plans) |
| `wk` | Your weekly rate-limit window used, and the time left until it resets (subscription plans) |

Context states: under 20% **Great** (green), 20–49% **Good** (yellow), 50–59% **Wrap up** (orange), 60–74% **Compact** (purple), 75%+ **Degraded** (red). A one-time toast also appears at 50%, 60% and 75%. The time left reads `4d 3h`, `2h 13m`, `12m` or `<1m`, counts down every minute, and shows `reset` once a window has passed its reset time. A value not known yet shows `--`.

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
