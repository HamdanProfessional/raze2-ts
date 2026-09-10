/**
 * Ported from GunFall.as.
 *
 * GunFall in the original was the dropped-weapon MovieClip that played an
 * animated bounce/flip cycle as the gun fell from the dead character. It had
 * 10 frame-script hooks that called rdGun.Init() — the physics body wasn't
 * created until frame 2 of the bounce so the visual would settle before
 * getting a body. The frame timing was: every 5th frame of a 50-frame cycle
 * would call Init() (frames 1, 6, 11, 16, …). With 10 of those calls, the
 * decompiler output a frame handler per checkpoint.
 *
 * In the TS port `physics/RdGun.ts` does the equivalent work synchronously:
 * the bounce is faked by applying a strong vertical impulse from the unit's
 * last jump velocity, and the physics body is created right after construction.
 * The visual is a `GunView` returned by the gunArtProvider (set in
 * `assets/Parts.ts` or in `GameScreen.ts`). No per-frame movieclip needed.
 */
export {};
