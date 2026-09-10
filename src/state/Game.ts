/**
 * Ported from Game.as.
 *
 * Game in the original was the main playable MovieClip: it owned the Arena,
 * Background, Debug, Hud, Match and Player roster, plus a list of per-frame
 * "frameEff" visual effects (the Effect_* classes), the plasma overlay sprite
 * and the death-ragdoll physics. EnterFrame() drove the whole orchestrator
 * (frame count, pause/resume, intro timer, effect bookkeeping, draw).
 *
 * In the TS port the same orchestration lives in `game/GameScreen.ts`:
 *   - Arena             -> game/Arena.ts
 *   - Hud               -> game/Hud.ts
 *   - Match             -> game/Match.ts
 *   - Player + AI       -> game/Player.ts + game/AI.ts
 *   - physics (RdPhys)  -> physics/Phys.ts (planck.js)
 *   - Effects (ring + tracer) are inline in GameScreen.addEffect/addTracer
 *     since the per-weapon AS Effect_* classes were heavily redundant.
 */
export {};
