import type { Page } from '@playwright/test';

import { BAND_DIM, POINTER } from './config.ts';

/**
 * The parts of a demo that are not the app: a cursor and a key hint.
 *
 * Both are page-side, because the alternative is compositing them
 * afterwards and the alternative is worse — a cursor drawn into the video by
 * ffmpeg is a cursor that can disagree with where the click landed, and a
 * demo whose pointer misses the button it presses is a demo nobody believes.
 * So this draws a pointer that is *reactive*: it listens for the real
 * `mousemove` Chrome dispatches and puts itself exactly there. There is one
 * source of truth for where the pointer is, and it is the same one the app
 * reads its hover states from.
 *
 * Injected through `addInitScript`, so it survives the SPA's own navigations
 * and any reload a scene asks for. It attaches to `documentElement` rather
 * than `body`: React hydrates into a container inside the body and diffs what
 * it finds there, and an unexpected sibling in that container is a hydration
 * warning in the console of every scene.
 */
export type OverlaySide = {
  keys(combo: string | null): void;
  visible(on: boolean): void;
  cursorAt(x: number, y: number): void;
  drag(on: boolean): void;
  zoom(
    px: number,
    py: number,
    scale: number,
    ms: number
  ): { tx: number; ty: number; scale: number };
  still(tx: number, ty: number, scale: number): void;
  band(top: number | null, height?: number, left?: number, width?: number): void;
  follow(els: Element[] | null): void;
};

declare global {
  interface Window {
    __demo?: OverlaySide;
  }
}

function overlaySource({ pointer, dim }: { pointer: 'arrow' | 'touch'; dim: number }) {
  const ROOT_ID = 'demo-overlay';

  const css = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: ui-sans-serif, -apple-system, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  contain: layout style;
}
#${ROOT_ID}[data-hidden='true'] { display: none; }

/*
 * Positioned with the translate property, and never with transform.
 *
 * This is the cursor-jumping bug, and it is entirely about the order CSS
 * composites these in: T(origin) . translate . rotate . scale . transform .
 * T(-origin). A transform is applied *inside* the scale, so an element placed
 * with 'transform: translate3d(x, y, 0)' while the press rule sets
 * 'scale: 0.86' has its translation scaled too. The tip did not wobble a
 * couple of pixels, it leapt toward the top-left corner in proportion to how
 * far across the screen it was: fifty pixels near the left edge, closer to
 * three hundred near the right. Every click, and back again on release.
 *
 * The translate property composites *before* scale, so the tip lands at
 * origin + (x, y) whatever the scale is. With the origin on the tip and the
 * box shifted back by the same amount, the arrow shrinks around a point that
 * does not move and sits exactly where the click lands.
 */
#${ROOT_ID} .dc {
  position: absolute;
  top: 0;
  left: 0;
  width: 26px;
  height: 26px;
  margin: -2.2px 0 0 -5px;
  transform-origin: 5px 2.2px;
  will-change: translate, scale;
  translate: -100px -100px;
  transition: scale 120ms cubic-bezier(0.2, 0, 0.2, 1);
  scale: 1;
}
#${ROOT_ID}[data-press='true'] .dc { scale: 0.86; }
#${ROOT_ID} .dc svg { display: block; overflow: visible; }


#${ROOT_ID} .dc-hold {
  position: absolute;
  top: 0;
  left: 0;
  width: 34px;
  height: 34px;
  will-change: translate;
  margin: -17px 0 0 -17px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.22);
  border: 1.5px solid rgba(99, 102, 241, 0.7);
  opacity: 0;
  transition: opacity 140ms ease;
  will-change: opacity;
}
#${ROOT_ID}[data-drag='true'] .dc-hold { opacity: 1; }

/* The key hint, low and centred, where it overlaps nothing worth seeing. */
#${ROOT_ID} .dc-stack {
  position: absolute;
  left: 50%;
  bottom: 34px;
  translate: -50% 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

#${ROOT_ID} .dc-keys {
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 120ms ease, translate 160ms cubic-bezier(0.2, 0, 0.2, 1);
  translate: 0 6px;
}
#${ROOT_ID} .dc-keys[data-on='true'] { opacity: 1; translate: 0 0; }
#${ROOT_ID} .dc-keys kbd {
  min-width: 34px;
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 15px;
  font-weight: 560;
  line-height: 1;
  text-align: center;
  color: #f8fafc;
  background: rgba(15, 18, 26, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-bottom-color: rgba(0, 0, 0, 0.6);
  box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
}


`;

  /*
   * A phone has no arrow: a fingertip, centred on the tap, that dips and
   * darkens while pressed. Same translate-before-scale rule as the arrow,
   * with the origin at the dot's centre.
   */
  /*
   * The band: a window onto the subject, everything around it dimmed. Full
   * width on a phone; on a wider screen it frames the subject on all sides. A box-shadow larger than any screen is the scrim, so the
   * window itself is a plain transparent box that can glide between subjects.
   */
  const BAND_CSS = `
#${ROOT_ID} .dc-band {
  position: fixed;
  left: 0;
  width: 100%;
  top: 0;
  height: 0;
  border-radius: 0;
  box-shadow: 0 0 0 200vmax rgba(17, 17, 17, ${dim});
  opacity: 0;
  transition: opacity 320ms ease, top 420ms cubic-bezier(0.33, 0, 0.22, 1),
    height 420ms cubic-bezier(0.33, 0, 0.22, 1),
    left 420ms cubic-bezier(0.33, 0, 0.22, 1),
    width 420ms cubic-bezier(0.33, 0, 0.22, 1);
}
#${ROOT_ID} .dc-band[data-box='true'] { border-radius: 14px; }
#${ROOT_ID} .dc-band[data-on='true'] { opacity: 1; }
`;

  const TOUCH_CSS = `
#${ROOT_ID} .dc {
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  transform-origin: 15px 15px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
  border: 2px solid rgba(17, 17, 17, 0.42);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  transition: scale 120ms cubic-bezier(0.2, 0, 0.2, 1), background 120ms ease;
}
#${ROOT_ID}[data-press='true'] .dc { scale: 0.8; background: rgba(17, 17, 17, 0.28); }
`;

  const ARROW = `
<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
  <path d="M5 2.2 5 20.4 9.9 15.9 13.1 23.4 16.4 22 13.2 14.6 20 14.2Z"
        fill="#fff" stroke="rgba(0,0,0,0.55)" stroke-width="1.3"
        stroke-linejoin="round"/>
</svg>`;

  function build() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.textContent = (pointer === 'touch' ? css + TOUCH_CSS : css) + BAND_CSS;

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="dc-band"></div>
      <div class="dc-hold"></div>
      <div class="dc">${pointer === 'touch' ? '' : ARROW}</div>
      <div class="dc-stack">
        <div class="dc-keys"></div>
      </div>`;

    document.documentElement.append(style, root);

    const cursor = root.querySelector('.dc') as HTMLElement;
    const hold = root.querySelector('.dc-hold') as HTMLElement;
    const keys = root.querySelector('.dc-keys') as HTMLElement;
    const band = root.querySelector('.dc-band') as HTMLElement;
    let following: Element[] | null = null;

    function place(nx: number, ny: number) {
      const shift = `${nx}px ${ny}px`;
      cursor.style.translate = shift;
      hold.style.translate = shift;
    }

    addEventListener(
      'mousemove',
      (event) => place(event.clientX, event.clientY),
      { capture: true, passive: true }
    );

    addEventListener(
      'mousedown',
      () => {
        root.dataset.press = 'true';
      },
      { capture: true, passive: true }
    );

    addEventListener(
      'mouseup',
      () => {
        root.dataset.press = 'false';
      },
      { capture: true, passive: true }
    );

    const api = {
      keys(combo: string | null) {
        if (!combo) {
          keys.dataset.on = 'false';
          return;
        }
        keys.replaceChildren(
          ...combo.split('+').map((part) => {
            const key = document.createElement('kbd');
            key.textContent = part;
            return key;
          })
        );
        keys.dataset.on = 'true';
      },
      visible(on: boolean) {
        root.dataset.hidden = on ? 'false' : 'true';
      },
      /**
       * Pushes in on a point, by scaling the body rather than the document.
       *
       * The body is the app; the overlay is the body's sibling. Scaling the
       * document would take the cursor and the key hint with it, which is
       * both wrong and ugly: the pointer is at a real screen position and
       * should stay the size of a pointer. Scaling the body moves the app
       * under a cursor that keeps pointing at the same place on screen.
       *
       * It is a transition rather than a crop in post for one reason: the
       * browser re-rasterises text at the scale it ends up drawn at, so a
       * push-in stays as sharp as the rest of the corpus. Cropping a 4K frame
       * and blowing it back up to 4K cannot.
       *
       * The origin is only ever set while the body is unscaled. Moving the
       * origin of an already-scaled element makes it leap, so the actor
       * always comes back to 1 before it picks a new point.
       */
      /**
       * A view on the app, expressed so that any two views can glide between.
       *
       * The first version scaled about the subject, which meant the
       * transform-origin moved every time the subject did. Two consequences,
       * both of which the user saw: moving an origin while a transform is
       * applied makes the page jump, so every beat had to return to 1x first
       * and the film spent its life zooming out and back in; and a point
       * measured before a push-in is somewhere else afterwards, so clicks and
       * the cursor aimed at where things used to be.
       *
       * Pinning the origin to the top-left and carrying the framing entirely
       * in translate+scale fixes both. A view is now two numbers and a scale,
       * every view is reachable from every other in one transition, and the
       * mapping from app coordinates to screen coordinates is arithmetic the
       * actor can do without asking the page.
       *
       * The clamp keeps the scaled app covering the window, so bringing an
       * edge-dwelling subject toward the middle never opens a gap beside it.
       */
      zoom(px: number, py: number, scale: number, ms: number) {
        const app = document.body;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const span = scale - 1;

        const tx = Math.min(0, Math.max(-span * width, width / 2 - scale * px));
        const ty = Math.min(
          0,
          Math.max(-span * height, height / 2 - scale * py)
        );

        /**
         * Promoted to its own layer while it moves, and only while it moves.
         *
         * Scaling text means re-rasterising every glyph at the new size, and
         * at 3840x2160 Chrome cannot do that every frame: the push-in painted
         * at single-figure frame rates and looked like it was stepping rather
         * than gliding. `will-change` hands the whole app to the compositor
         * for the duration, which transforms one raster instead of redrawing
         * the page thirty times a second.
         *
         * Dropped again on `transitionend`, which is the part that matters for
         * a 4K corpus: holding the hint would leave every held frame showing a
         * texture scaled up rather than type drawn at its real size. So the
         * motion is smooth and the frames a viewer actually pauses on are
         * sharp.
         */
        app.style.willChange = 'transform';
        app.style.transformOrigin = '0 0';
        app.style.transition = `transform ${ms}ms cubic-bezier(0.33, 0, 0.22, 1)`;
        app.style.transform =
          scale === 1 ? 'none' : `translate(${tx}px, ${ty}px) scale(${scale})`;

        app.addEventListener(
          'transitionend',
          () => {
            app.style.willChange = 'auto';
          },
          { once: true }
        );

        return scale === 1 ? { tx: 0, ty: 0, scale: 1 } : { tx, ty, scale };
      },

      /**
       * Sets the framing outright, for a change the film must not see.
       *
       * A still is taken while the screencast is stopped, so the camera can
       * be somewhere else for it and be put back before capture resumes: the
       * viewer sees one continuous shot, and the still keeps whatever framing
       * the scene asked for. None of `zoom`'s machinery applies here and all
       * of it would hurt. A transition is a second of motion that would have
       * to happen on film. `will-change` would be left switched on, because a
       * zero-length transition never fires the `transitionend` that drops it,
       * and a held frame under that hint shows scaled texture instead of type
       * at its real size. Reading `offsetHeight` forces the style to land
       * before the screenshot rather than at the next animation frame, which
       * is after it.
       */
      still(tx: number, ty: number, scale: number) {
        const app = document.body;

        app.style.transition = 'none';
        app.style.willChange = 'auto';
        app.style.transformOrigin = '0 0';
        app.style.transform =
          scale === 1
            ? 'none'
            : `translate(${tx}px, ${ty}px) scale(${scale})`;

        void app.offsetHeight;
      },
      /** Shows the band over a strip of the screen, or fades it with null. */
      band(top: number | null, height = 0, left?: number, width?: number) {
        if (top === null) {
          band.dataset.on = 'false';
          band.dataset.at = '';
          return;
        }
        const key = `${top}|${height}|${left}|${width}`;
        if (band.dataset.on === 'true' && band.dataset.at === key) return;
        band.dataset.at = key;
        const put = () => {
          band.style.top = `${top}px`;
          band.style.height = `${height}px`;
          band.style.left = left === undefined ? '0px' : `${left}px`;
          band.style.width = width === undefined ? '100%' : `${width}px`;
          band.dataset.box = left === undefined ? 'false' : 'true';
        };
        // Appearing, it starts where it lands; only a move between two
        // subjects should glide.
        if (band.dataset.on !== 'true') {
          band.style.transition = 'none';
          put();
          void band.offsetHeight;
          band.style.transition = '';
        }
        put();
        band.dataset.on = 'true';
      },
      /**
       * Keeps the band on an element every frame until told otherwise, so a
       * section that moves after it was measured (data arriving above it, a
       * sheet settling) stays framed instead of leaving the band behind.
       */
      follow(els: Element[] | null) {
        following = els;
        if (!els || els.length === 0) {
          following = null;
          api.band(null);
          return;
        }
        // Several elements make one band from the top of the first to the
        // bottom of the last: a choice and the detail it reveals, together.
        const tick = () => {
          if (following !== els) return;
          const live = els.filter((el) => el.isConnected);
          if (live.length === 0) {
            following = null;
            api.band(null);
            return;
          }
          const rects = live.map((el) => el.getBoundingClientRect());
          const top = Math.max(0, Math.min(...rects.map((r) => r.top)) - 12);
          const bottom = Math.min(
            window.innerHeight,
            Math.max(...rects.map((r) => r.bottom)) + 12
          );
          // A phone gets the full width; wider, the box hugs the subject.
          if (window.innerWidth <= 640) {
            api.band(top, Math.max(0, bottom - top));
          } else {
            const left = Math.max(0, Math.min(...rects.map((r) => r.left)) - 12);
            const right = Math.min(window.innerWidth, Math.max(...rects.map((r) => r.right)) + 12);
            api.band(top, Math.max(0, bottom - top), left, Math.max(0, right - left));
          }
          requestAnimationFrame(tick);
        };
        tick();
      },
      cursorAt(nx: number, ny: number) {
        place(nx, ny);
      },
      drag(on: boolean) {
        root.dataset.drag = on ? 'true' : 'false';
      },
    };

    (window as unknown as { __demo: typeof api }).__demo = api;
  }

  if (document.documentElement) {
    build();
  } else {
    addEventListener('DOMContentLoaded', build, { once: true });
  }

  addEventListener('DOMContentLoaded', build);
}

export function installOverlay(page: Page) {
  return page.addInitScript(overlaySource, { pointer: POINTER, dim: BAND_DIM });
}
