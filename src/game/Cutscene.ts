import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import MANIFEST from "../assets/raze2/cutscene.json";
import { getCamp } from "./Campaign";
import { SD } from "../state/SD";

/**
 * Ported from `Cutscene.as` + `Stats_Campaign.as`'s `setCutscene()`.
 *
 * The original's story scenes are one 42-frame comic MovieClip. A mission
 * declares `preCutFrames` / `postCutFrames` — arrays of frame indices into that
 * clip — and `Cutscene` walks them with `gotoAndStop`, one panel per click, the
 * mission name in `txt_title` across the top and Previous / Next buttons along
 * the bottom. The last page swaps Next for "Start Game" (pre) or "Back to
 * Campaign" (post). There is no timer: every page is held until the player
 * clicks. `preCutSong` / `postCutSong` set the music for the scene.
 *
 * The panels are baked out of the SWF by `tools/cutscene/build_cutscene.py`
 * into `public/assets/cutscene/<id>.webp` — the full 800x600 stage (painted
 * backdrop, comic panel, border and the frame's narration caption) minus the
 * chrome this module's screen draws live.
 *
 * Panel ids are strings, not numbers, because frame 22 (the Human campaign's
 * finale) carries no still art at all: the SWF plays a 510-frame nested clip
 * that fades four blocks of copy through the empty panel. Those four beats are
 * baked as `22a`..`22d` and the manifest's `expand` table splices them in, so
 * the ending pages the same way every other scene does.
 */

export type CutsceneType = "pre" | "post";

const EXPAND = MANIFEST.expand as Record<string, string[]>;
const CAPTIONS = MANIFEST.captions as Record<string, string>;

/** Native size of one panel — the SWF's Cutscene stage. */
export const PANEL_W = MANIFEST.size[0];
export const PANEL_H = MANIFEST.size[1];

export interface CutsceneReel {
  /** Which side of the match this scene belongs to. */
  type: CutsceneType;
  /** Mission index 1..30, for the return trip to the campaign screen. */
  num: number;
  /** Mission name, shown where the SWF put `txt_title`. */
  title: string;
  /** Panel ids in play order. Never empty. */
  panels: string[];
  /** Music key for `Sound.setMusic`, or null to leave the mix alone. */
  song: string | null;
}

/**
 * `Stats_Campaign.as` stored the frame lists as literal arrays; the extraction
 * captured them as their source text (`"[13,1,2]"`), so accept either.
 */
function parseFrames(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

/** Frame indices -> panel ids, splicing in any expanded multi-page frame. */
function toPanels(frames: number[]): string[] {
  const out: string[] = [];
  for (const f of frames) out.push(...(EXPAND[String(f)] ?? [String(f)]));
  return out;
}

/**
 * `M_Infernal` (the id the mission data uses) -> the audio manifest's `R2_`
 * key, matching how GameScreen resolves a mission's in-match track.
 */
function musicKey(song: unknown): string | null {
  if (typeof song !== "string" || !song) return null;
  return "R2_" + song.replace(/^M_/, "");
}

/** The scene a mission plays before or after its match, or null if it has none. */
export function getCutscene(num: number, type: CutsceneType): CutsceneReel | null {
  const entry = getCamp(num);
  const cut = entry?.cutscene;
  if (!entry || !cut) return null;
  const panels = toPanels(parseFrames(cut[`${type}Frames`]));
  if (panels.length === 0) return null;
  return {
    type,
    num,
    title: entry.settings.matchName ?? `Mission ${num}`,
    panels,
    song: musicKey(cut[`${type}Song`]),
  };
}

/**
 * The scene that follows the match just played, or null to go straight back.
 *
 * `Game.destroy()` shows the post scene on a win, and has one special case for
 * a loss: failing "Final Deployment" — the Human campaign's last mission — is
 * the one defeat with a story beat of its own (frame 18, earth lost), played
 * with no music.
 */
export function endReel(): CutsceneReel | null {
  const m = SD.matchSettings;
  const num = Number(m.campaign);
  if (!num) return null;
  if (m.won) return getCutscene(num, "post");
  if (m.matchName !== "Final Deployment") return null;
  return { type: "post", num, title: String(m.matchName), panels: ["18"], song: null };
}

/** The frame's narration, for tooling / debugging. Baked into the art itself. */
export function panelCaption(id: string): string {
  return CAPTIONS[id] ?? "";
}

// --- art ------------------------------------------------------------------

const cache = new Map<string, Texture>();
const pending = new Map<string, Promise<void>>();

/**
 * Fetch the reel's panels. A scene is 1-6 images of ~60KB, so they are pulled
 * on demand rather than held from boot, and awaited before the screen opens so
 * its constructor stays synchronous like every other Screen.
 */
export function loadPanels(ids: string[]): Promise<void> {
  return Promise.all(ids.map((id) => {
    if (cache.has(id)) return Promise.resolve();
    const inFlight = pending.get(id);
    if (inFlight) return inFlight;
    const job = Assets.load<Texture>(`${ASSET_BASE}/cutscene/${id}.webp?v=${ASSET_V}`)
      .then((t) => void cache.set(id, t))
      .catch(() => {});
    pending.set(id, job);
    return job;
  })).then(() => undefined);
}

/** Cached panel texture, or null when the fetch failed. */
export function getPanel(id: string): Texture | null {
  return cache.get(id) ?? null;
}
