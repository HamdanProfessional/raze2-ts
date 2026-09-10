/**
 * Ported from SoundHandler.as.
 *
 * SoundHandler was the Flash-side audio helper: a static playDistantSound()
 * computed volume falloff and stereo pan from the call site distance to the
 * arena centre, plus setBgMusic() / stopMusic() / changeVolume() looped the
 * background track on a SoundChannel with a SoundTransform.
 *
 * In the TS port those responsibilities are in `audio/Sounds.ts` — `play`,
 * `playAt`, `setMusic`, `stopMusic`, `resume` — implemented over the Web
 * Audio API.
 *
 * The distance maths deliberately differs: Flash had no camera, so the arena
 * centre *was* the listener. This port scrolls the view with the player, so
 * `Sound.playAt` spatialises against a listener position that GameScreen
 * updates from the player each frame. `playDistant` survives as a deprecated
 * alias.
 */
export {};
