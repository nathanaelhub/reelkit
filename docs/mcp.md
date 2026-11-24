# reelkit in Claude Desktop and other AI apps (MCP)

reelkit includes an [MCP](https://modelcontextprotocol.io) server. Once it's added, an AI app's own model can make a
reel from start to finish: it writes the script, the scenes and the score, then runs voice, check, render and ship,
looking at the contact sheets as it goes. You talk to the chat app you already use. You don't need a terminal after
setup, and you don't pay for a second agent.

## Add it

```bash
npm run doctor -- --fix   # once, in your reelkit folder: installs the browser, voice models and the rest
npm run mcp -- install    # adds reelkit to every AI app it finds
```

Quit the app fully and open it again. Then ask it something like:

> make a 20-second reel about why octopuses have three hearts, riso style

| App | What `install` does |
|---|---|
| Claude Desktop (macOS, Windows) | Adds `reelkit` to `claude_desktop_config.json`. |
| Cursor | Adds `reelkit` to `~/.cursor/mcp.json`. |
| Claude Code | Runs `claude mcp add --scope user reelkit …`, so reelkit's tools work from any folder. |
| Anything else | `npm run mcp -- --print` shows the JSON to paste into that app's MCP settings. |

- `--app desktop`, `--app cursor` or `--app code` limits `install` to one app.
- `install` keeps every other server already in a config file, saves the original file as `.bak` the first time, and
  changes nothing if you run it twice.
- `npm run mcp -- uninstall` takes reelkit out again.
- If you move the reelkit folder or reinstall Node, run `install` again. `npm run doctor` tells you when that's needed.

## The tools

| Tool | What it does |
|---|---|
| `guide` | How to make a good reel: reelkit's full method, or one topic (`script`, `scenes`, `style`, `feedback`, `languages`, `series`, `score`, `transitions`, `style:<pack>`). |
| `setup` | Checks that everything is installed; `fix: true` installs what's missing. |
| `options` | The style packs, languages, free voices, and any voices you've recorded. |
| `list_reels` | Your reels, and how far along each one is. |
| `new_reel` | Starts a reel in `reels/<slug>/`. |
| `read_file`, `write_file`, `edit_file`, `delete_file` | A reel's own files: script.json, reel.html, score.js, and a series' plan.md. |
| `add_asset` | A picture or sound from a link or from your computer, e.g. `~/Desktop/beach.jpg`. Name it `music` to use your own track. |
| `add_footage` | A video: a talk becomes one scene per sentence; b-roll gets a shot list. |
| `run` | One step: `voice`, `check`, `draft`, `render`, `score`, `ship`, `depth`, `cutout` or `clip`. |
| `wait`, `stop` | Long steps (voice, render, the first download of a model) run as jobs. `wait` checks on a job and returns its result when it's done. |
| `translate` | A copy of a reel in Spanish, French, Italian or Portuguese, for the model to translate. |
| `new_series`, `series_status` | Several reels from one article or set of notes. |
| `show` | Shows you the finished video: it plays right in the chat in apps that support it, otherwise it opens in your video player (`open: true` does both). With `at: [seconds]`, it returns single frames for the model to look at instead. |

The model sees its own work. `check` returns the contact sheets as pictures, `render` returns a strip of frames from
the video, and `ship` returns the cover and the safe-zone frame. Your reels are ordinary folders in `reels/`, so you can
carry on with one in reelkit studio (`npm start`) or in Claude Code.

## Watching the reel in the chat

In apps that can show interactive views (MCP Apps), `show` puts a small player in the conversation, so you watch the
reel without leaving the chat. Claude (desktop and web), ChatGPT and VS Code support this; other apps open the video
in your video player as before.

- The chat plays a 720p preview made from the render (in `out/.chat/`), because apps pass data to the player in
  small pieces. **Open full quality** opens the real file in your video player.
- **Safe zones** shades the areas TikTok, Instagram and Shorts cover with their buttons and captions, the same areas
  as `ship`'s safe-zones.jpg.
- The player is a sandboxed page from reelkit. It loads nothing from the internet and can only ask reelkit for the
  newest video of a reel.

Not available through MCP:
- Taste references (`npm run ref`).
- Recording your voice. Do that in the studio; recorded voices then show up in `options`.

## What it can reach on your computer

- **Files.** It reads and writes text files only inside `reels/<slug>/` and `series/<name>/` in your reelkit folder.
  It refuses paths that go anywhere else, including `..`, absolute paths, hidden files and `.env`.
- **Your own files.** `add_asset` and `add_footage` copy pictures, sound and video from anywhere on your computer.
  Each file is checked by its first bytes and has to really be one of those formats, so a document or a key file
  can't be pulled in. Links must be `https://`.
- **Programs.** It only runs reelkit's own scripts and ffmpeg, plus your video player when you ask for `show`.
- **The player.** The in-chat player reads only the newest video of a reel that exists, and loads nothing from the
  internet.
- **The internet.** A reel rendered from an AI app can't load anything from the internet: pictures and sounds have to
  be added with `add_asset` first. That way a page written by a model can't send anything off your computer. Renders
  from the studio or a terminal work as before.
- **Network ports.** The app talks to reelkit through a pipe, so nothing listens on your network.

This is a fence around reelkit's folders, not a judge of what the model writes: the model in your app decides what
goes into a reel, as it would in any chat.

## Troubleshooting

- **The app doesn't list reelkit's tools.** Quit the app fully and reopen it. Check that `npm run mcp -- status`
  shows the app. On Windows, the Microsoft Store version of Claude Desktop keeps its config somewhere else;
  `install` looks there too.
- **"node: not found", or reelkit stops starting after a Node upgrade.** Run `npm run mcp -- install` again. It
  writes the full path of your Node, which apps started from the Dock or Start menu need.
- **A step says "Still working".** That's normal: rendering takes a minute or two, and the first voice run downloads
  a model. Some apps give up on a tool call after about a minute, so reelkit answers within about 25 seconds and the
  model calls `wait` again.
- **The player stays on "Loading" or shows an error.** Ask the app to show the reel again; if it still fails,
  **Open full quality** (or `show` with `open: true`) opens the file in your video player.
- **Something is missing.** Ask the app to run `setup` with fix, or run `npm run doctor -- --fix` yourself.
