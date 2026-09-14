/**
 * Ported from the Raze 2 blood effect path, and deliberately just a re-export.
 *
 * Raze 2 has no persistent splatter: every effect — blood included — is one
 * `Effect` blitted by `BitScreen.paint`, and `BitScreen.EnterFrame` clears the
 * whole bitmap (`data.fillRect(rect, 0)`, BitScreen.as:29-32) before anything
 * paints. A corpse's blood is the ordinary `bloodHuman`/skinned `blood*` clip
 * fired by `Bullet.as`, not a decal.
 *
 * The port plays the real thing: `GameScreen.addEffect(x, y, skin.blood)` looks
 * the name up in the baked `BH` atlas (`tools/fx/bake_bh.py`), where the five
 * recoloured splatters are one white mask under five tints, and rolls one of
 * its three rotations per spawn. Nothing accumulates, exactly as in the SWF.
 */
export {};
