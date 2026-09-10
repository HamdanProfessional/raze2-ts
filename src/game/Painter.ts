/**
 * Ported from Painter.as.
 *
 * Painter in the original was a Sprite that owned a BitmapData the size of
 * the arena's paintBox, scaled by Level.getPaintSize(level). On every
 * character death the ragdoll limbs and the splatter MovieClip (Splat) were
 * drawn into that BitmapData with an AffineTransform so blood smears
 * persisted on the walls/floor between matches.
 *
 * In the TS port this wall-painting step is intentionally not reproduced: the
 * death ragdoll and weapon are full physics objects that bounce around the
 * arena for a few seconds before settling, and the splatter effect is just
 * a temporary Graphics ring. Persistent blood on walls was a fun flavour
 * touch but is not part of the playable game-state model.
 *
 * If persistent blood ever needs to come back, the right place is a
 * RenderTexture that Ragdoll and Splat are rendered into each frame, sized
 * to the arena's bounds and composited under the gameplay layer.
 */
export {};
