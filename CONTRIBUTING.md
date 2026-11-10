# Contributing

Thanks for helping. reelkit is small on purpose: an engine you can read in an afternoon, plus open tools doing what they're best at.

## Ground rules

- **Deterministic frames.** Every frame must be a pure function of time `t`, so renders are exact. No CSS animations or transitions, no `Date.now()`, no unseeded randomness.
- **Licences you can publish with.** reelkit promises people can sell what they make. A new tool or model must allow commercial use of its outputs. Prefer Apache-2.0 / MIT / BSD; GPL tools are fine only as separate programs the user installs, never vendored into this repo. Say which licence in the PR.
- **Local first.** The default path must work with no account and no key. Paid APIs are welcome as optional upgrades.
- **Tests that fail for their own reason.** Each case in `tests/run.mjs` runs the real scripts and asserts on output. Add one with every feature or fix.

## Workflow

1. Open an issue describing the problem or the goal.
2. Branch from `main`, make the change, run `npm test`.
3. Open a PR with What / Why / How you tested it. CI runs the same tests on Linux.

## Good first contributions

- A new score mood in `engine/score-kit.js`
- A new depth camera move in `engine/kit.js` (`DEPTH_MOVES`)
- A scene recipe or theme in `engine/kit.css` with an example
- Pronunciation fixes: words Kokoro gets wrong
- An example reel on a new topic, with public-domain or CC0 media
