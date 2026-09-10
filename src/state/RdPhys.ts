/**
 * Ported from RdPhys.as.
 *
 * RdPhys was the original AS3 wrapper around Box2D 2.0.x: it created the world
 * (with a b2AABB and gravity (0,10)), the static ground body (one big shape
 * per wall rectangle from arena.rdWall), and spawned death ragdolls (RdActor)
 * and dropped weapons (RdGun). EnterFrame stepped the world, synced every
 * body's userData (a Sprite) to its b2Body position, and garbage-collected
 * sleeping actors/guns.
 *
 * In the TS port that class is `physics/Phys.ts` (built on planck.js — the
 * modern Box2D 2.3 fork). Same step semantics (1/30s fixed step), same PTM
 * (30 px/m), same wall layout (from Arena.walls), same ragdoll/gun physics.
 */
export {};
