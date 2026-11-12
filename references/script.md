# Writing the script

Read this before writing or editing any narration: the `actor.say` and
`actor.spotlight` lines in a scene, and the hook each variant shows. It sits
on top of [narration.md](narration.md) and [scenes.md](scenes.md); follow
those too.

Product details come from the workspace's `profile.json` (copy
`template/profile.json`): the product's name, who the videos are for, the
closing line, words never to say and words that must never appear on screen.
Fill it in before writing the first line. If you can't, ask the user for those
four things in one message.

## Who is talking, and to whom

- **The narrator** is a friendly guide sitting beside the viewer, showing
  them their own screen. Calm and clear. Not a salesperson, not a lecturer.
- **The listener** is the profile's `audience`: busy, often not technical,
  often watching on a phone with the sound low.
- **The goal of every video:** the viewer understands one job they can do in
  the product, and how it helps them, in under a minute or two.

## The voice in five rules

1. **Talk, don't read.** Every line has to sound natural said aloud to one
   person. Read it aloud before keeping it.
2. **Guide, step by step.** Say what is happening and why it matters, one step
   at a time.
3. **Plain English.** Everyday words, short sentences, no jargon or slang.
4. **Show, don't sell.** Describe what happens on screen and what changes for
   the viewer. No hype.
5. **The same voice in every video:** same narrator, same words for the same
   things, same opening and closing shape.

## Line rules

- One idea per line, about one thing on screen, so the highlight lands on the
  right thing.
- 6 to 14 words per line. Never more than 18.
- Do the gesture first, then say the line over the result.
- "You" and "your" for the viewer; "your customer" or "your client" for the
  people they serve; "let's" for doing a step together. "I" rarely.
- Contractions: it's, you'll, that's, don't.
- Vary how lines start: So, Now, Here, Next, And, Then.
- Use the exact button and screen names the product shows. If the button says
  "Add service", say "Add service".
- Say why a step matters at least once per video, in the viewer's terms:
  fewer no-shows, no chasing payments, no typing it twice.
- Show the options, not only the happy path: when a choice has three
  answers, show and say all three.

## Words to avoid

Never: powerful, seamless, effortless, revolutionary, robust, leverage,
utilize, cutting-edge, game-changer, simply, easily, "in just a few clicks",
and everything in the profile's `neverSay`. Avoid "just" where it makes a
step sound trivial.

Never invent numbers, customers, results or features. Narrate only what the
product does on screen today. Sample businesses are samples: "our sample
bakery", never a real customer. Don't promise what only happens sometimes
(a payment that is charged on its own only when the customer set it up is
not "charged automatically").

## The shape of every video

1. **Hook (one line, first two seconds):** the viewer's problem in their own
   words, or the result. This line is also the clip's `hooks.json` entry,
   shown above the video in every framed variant, so keep it under about 45
   characters.
   - "People book a slot and don't turn up. Let's fix that."
   - "Still tracking monthly fees in a notebook?"
2. **Steps (one line each):** what to tap, and what happens.
3. **Payoff (one or two lines):** what changes for the viewer.
4. **Close (one line, always the profile's `closing`).** For a help page with
   no selling, close on the result instead: "That's it. Your deposits are set
   up."

Length: 30 to 60 seconds for Reels and Shorts (about 6 to 12 lines); up to
two minutes for YouTube and help pages.

## Written to be spoken

- Money as words the voice reads well: "1,500 rupees", "fifteen dollars".
- Websites as said: "acme dot com".
- Short forms spelled where the voice needs it (G S T, U P I). Add them to
  `voice.saidAs` in `demo.config.ts` only after hearing the voice get them
  wrong (`scripts/say.sh`).
- A line written `caption || spoken` shows the first half as the caption and
  speaks the second, for when the screen's spelling and the spoken form
  differ.

## What the script step hands on

- The scene file's `say` and `spotlight` lines.
- `hooks.json` in the output folder: `{ "<scene>": "<hook line>" }`, which
  `scripts/variants.mjs` puts above the video.

## Check before filming

- [ ] The hook names a real problem or result, in under about 45 characters
- [ ] Every line has one idea and is 18 words or fewer
- [ ] Every line sounds natural read aloud
- [ ] Button and screen names match the product exactly
- [ ] At least one line says why it matters
- [ ] No banned words, no invented numbers or claims
- [ ] Money, websites and short forms written to be spoken
- [ ] Ends with the profile's closing line
- [ ] New or tricky words auditioned with `scripts/say.sh`
