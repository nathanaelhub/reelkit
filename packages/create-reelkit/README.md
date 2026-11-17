# create-reelkit

Set up [reelkit](https://github.com/nathanaelhub/reelkit), the open-source reel maker that runs on your own computer, in one command:

```bash
npm create reelkit@latest
```

It downloads the latest reelkit release into a `reelkit` folder (no git needed), installs it, downloads the free voice and a headless browser, and opens reelkit studio in your browser. You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm create reelkit@latest my-reels          # a different folder name
npm create reelkit@latest -- --no-start     # set up, don't open the studio
npm create reelkit@latest -- --ref main     # the latest code instead of the latest release
```

Next time, start it with `cd reelkit && npm start`.
