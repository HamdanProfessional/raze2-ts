/**
 * Stub modules for the per-part character-limb MovieClips used by the
 * ragdoll's per-frame "drawMe" callback. Each frame of each costume variant
 * was rasterised to a PNG and loaded by assets/Parts.ts; the ragdoll now
 * attaches a Sprite to each RdContainer (see physics/RdContainer.ts +
 * physics/Phys.ts).
 *
 *   decompiled_swf/scripts/SsBody.as        → parts/body/<frame>.png
 *   decompiled_swf/scripts/SsFoot.as        → parts/foot/<frame>.png
 *   decompiled_swf/scripts/SsHand.as        → parts/hand/<frame>.png
 *   decompiled_swf/scripts/SsHead.as        → parts/head/<frame>.png
 *   decompiled_swf/scripts/SsLowerArm.as    → parts/lowerArm/<frame>.png
 *   decompiled_swf/scripts/SsLowerLeg.as    → parts/lowerLeg/<frame>.png
 *   decompiled_swf/scripts/SsNeck.as        → (not used directly in TS — neck
 *                                                is part of the head art)
 *   decompiled_swf/scripts/SsUpperArm.as    → parts/upperArm/<frame>.png
 *   decompiled_swf/scripts/SsUpperLeg.as    → parts/upperLeg/<frame>.png
 *
 * Each AS file was an empty MovieClip shell; the visual lives in
 * public/assets/parts/.
 */
export {};
