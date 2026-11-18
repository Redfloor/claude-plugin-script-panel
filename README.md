# Scripts panel for Claude Code

A mod for Claude Code that keeps the shell commands Claude gives you in one place, so you don't have to scroll back through the chat to run them again.

Every command Claude puts in a fenced `bash` (or `powershell`, `sh`, `cmd`) block is collected into a **Scripts** panel beside the chat, one row per command:

- **▶ Run**: starts the command in a new PowerShell window, in the folder it came from. (It tries the app's Terminal panel first; in auto mode the desktop app keeps that for Claude, so the window is the usual path there.)
- **⧉ Copy**: puts the command on your clipboard.
- **Pin**: keeps a script at the top. Pinned scripts come first, then the rest, newest first.
- **✎ Rename**: click the pencil to change the short label.
- Click a name to expand the full command, highlighted.

The panel opens only once it has something to show, and on the desktop app it starts as a widget you can keep in the column beside the chat.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install scripts-panel --marketplace Redfloor/claude-plugin-script-panel
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it load in every session, the desktop app's included).

From a shell:

```
claude plugin install scripts-panel --marketplace Redfloor/claude-plugin-script-panel
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Redfloor/claude-plugin-script-panel`, then **Add plugin**.

## Using it

- **Names** come from the script's file (`scripts\start_server.ps1` is `start_server`), a Python module and the flag that sets a run apart (`python -m app.run --bot fast` is `app.run-fast`), or the first two words. Taken names get `-2`, `-3`.
- **Project or session**: the ⊕ / ⊖ button at the top switches between every script collected in this project folder and only the ones this session's chat gave. The pane title says which.
- **Duplicates**: the same command written with `/` or `\`, or with different spacing, is one script.

Commands:

| Command | Does |
| --- | --- |
| `/scripts` | Open the panel and list the scripts |
| `/scripts add <name> <command>` | Add a script under a short name |
| `/scripts rm <name>` | Remove a script (it is not collected again) |
| `/scripts rename <name> <new>` | Change a short name |
| `/scripts pin <name>`, `/scripts unpin <name>` | Pin or unpin |

You can also just ask Claude ("add that as `deploy`", "remove the old ones", "pin the logger"): the mod gives Claude a tool for the list.

## Notes

- Scripts are kept per project folder, in the mod's own store, and survive restarts.
- Run uses PowerShell, so it is aimed at Windows today.
- After a Claude Code update the mod checks, without any model call, whether the update added new places a panel can sit, and tells you if it did. `probe/` is a tiny plugin it runs `claude plugin validate` on for that; it is never installed.

## Developing

```
claude plugin validate .
claude plugin test .
```

## License

MIT. The pin icon's outline is from [Lucide](https://lucide.dev) (ISC license).
