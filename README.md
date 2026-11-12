# shipdemo: product demo videos for every platform

**shipdemo** is an AI agent skill that turns your web app into narrated **product demo videos**. It writes the script, records the screen with voice-over and captions, and exports a version for each place you post: Instagram and Facebook Reels, YouTube Shorts, YouTube, LinkedIn, X and your own website.

It works with Claude Code and other agents that support skills. Everything runs on your own machine.

<!-- TODO before publishing: a 10-second sample video here (framed reel + wide laptop with zoom). -->

## Use it for

- **Product demo videos** for a landing page, a sales call or an investor update
- **Feature launch videos** when you ship something new
- **Video demos and walkthroughs** of a signup, checkout or onboarding flow
- **Social clips**: Reels, Shorts, LinkedIn and X posts, cut from the same recording
- **Product tours** split into chapters, as one long YouTube video
- **Screencasts and explainer videos** with a voice-over and captions you can switch on
- **App screenshots** for your website and store listings, taken at retina size

## How it works

1. **Script.** You say what to show. The agent writes short voice lines: a hook, the steps, the payoff.
2. **Record.** It builds your app, fills it with sample data and records each scene in Chromium, at 60 fps. A cursor moves and a highlight dims everything except the part the voice is talking about.
3. **Voice and captions.** A local text-to-speech voice reads the script. Captions are made from the script itself, so they match the voice word for word (`.srt`, `.vtt` and burned in).
4. **Check.** It checks that the voice says every line, scans the frames for error messages and measures the frame rate.
5. **Variants.** You choose which versions you want, or all of them.

## Variants

Record once, then export the shapes you need.

| Variant | Shape | Made for |
|---|---|---|
| `reel` | 9:16, phone screen in a frame, hook on top, captions under it | Instagram Reels, Facebook Reels, YouTube Shorts |
| `wide-phone` | 16:9, phone on the left, hook and captions on the right | YouTube, X, LinkedIn |
| `wide-laptop` | 16:9, laptop screen in a frame, hook on top | YouTube, X, LinkedIn |
| `wide-laptop-zoom` | the same, zooming in on each highlighted part | YouTube, X, LinkedIn |
| `web` | the plain video with a captions file; your page draws the frame | your website or docs |

Ask for `all`, or for a list such as `reel, wide-laptop-zoom`. A new variant is one entry in a presets file, so adding your own takes a few lines.

## Install

```bash
npx skills add himohitmehta/shipdemo
```

Then ask your agent:

```text
/shipdemo record a demo of https://example.com
/shipdemo record the checkout flow in this project, pay with cash on delivery
/shipdemo make a 60-second product demo of the new invoices page, reel and wide-laptop
/shipdemo film the onboarding on a phone screen and add captions
```

Say as much or as little as you like. You can add notes such as "mention the keyboard shortcut" or "keep it under thirty seconds".

## Change anything

If a take isn't right, say what's wrong and it records again:

- "that line is too long", "say screenshots, not stills"
- "highlight the toolbar", "slow down at the end"
- "record the pricing page too", "try a different voice"
- "make a LinkedIn version", "move the captions up"

## What you get

For each scene: an mp4 with voice-over, a captioned mp4, `.srt` and `.vtt` captions, a poster, retina screenshots and the script with timings. For the whole run: a full tour with chapters, a manifest and an `index.html` to watch everything. Variants go in their own folders beside the originals.

## Requirements

Node 22.18 or newer and ffmpeg. The skill installs Chromium (about 250 MB) and, if you want a voice, a local text-to-speech model (about 350 MB). It asks before installing anything.

## Credits

shipdemo's recording engine started from [video-demo](https://github.com/nilbuild/video-demo) by [Kamran Ahmed](https://kamran.fyi), released under the MIT licence. shipdemo adds scripts, captions, checks and the platform variants.

## Licence

MIT. See [LICENSE](LICENSE).

<!-- Keywords: product demo video, video demo, demo video maker, product video, product walkthrough, screencast, screen recording, explainer video, feature launch video, app demo, SaaS demo, product tour, Instagram Reels, YouTube Shorts, LinkedIn video, X video, captions, voice-over, Claude Code skill, AI agent skill, Playwright. -->
