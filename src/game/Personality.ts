/**
 * Bot personality chatter table. Ported (in spirit) from Personality.as'
 * `speak()` switchboard, which mapped a unit's `pers` string and a game event
 * to a pool of flavour lines. The original tracked ~20 event categories; this
 * keeps the set the AI actually needs: spawn, kill, death, taunt and low
 * health.
 *
 * Usage:
 *   const pers = Personality.pick();       // random archetype for a new bot
 *   unit.say(Personality.line(pers, "kill"));
 */

export type PersId =
  | "gamer"
  | "military"
  | "alien"
  | "zombie"
  | "robot"
  | "angry"
  | "leetnoob";

export type PersEvent = "spawn" | "kill" | "death" | "taunt" | "lowHealth";

const ARCHETYPES: PersId[] = [
  "gamer",
  "military",
  "alien",
  "zombie",
  "robot",
  "angry",
  "leetnoob",
];

/** Lines per archetype per event, drawn from / in the voice of Personality.as. */
const LINES: Record<PersId, Record<PersEvent, string[]>> = {
  gamer: {
    spawn: ["You're all going down!", "You're gonna feel my wrath!", "Ready!"],
    kill: ["Take that!", "Got one!", "More where that came from!"],
    death: ["Ouch man!", "Hey, quit it!", "Aw, come on!"],
    taunt: ["I can see your insides!", "Eat lead!", "This'll come in handy."],
    lowHealth: ["Note to self: Ouch!", "Ohh, this hurts!", "I need to be careful."],
  },
  military: {
    spawn: ["Lets do this.", "Lets get tactical!", "Hoorah!"],
    kill: ["Target down!", "Enemy down!"],
    death: ["Medic!", "Taking damage!", "Need assistance!"],
    taunt: ["Supressing fire!", "Take it.", "Target sighted!"],
    lowHealth: ["I better watch my fire.", "This is painful.", "Requesting backup."],
  },
  alien: {
    spawn: ["Wort thrak gluk", "Yarp dark dungo", "Glap trag snork!"],
    kill: ["Hsss", "Wort wort!"],
    death: ["Glargg!!", "Ahck"],
    taunt: ["Raggggtalli", "Garrss", "HSSSS"],
    lowHealth: ["Glaag!", "Grantuthul Garkpit!!"],
  },
  zombie: {
    spawn: ["Braaaaaains...", "BRAAAAAINS"],
    kill: ["BraInssz!", "MmmmMm, guts"],
    death: ["Gnuuuuugh..", "Ahhg"],
    taunt: ["Bulllleeets", "BRAIINSSSSSSS", "OGGGG"],
    lowHealth: ["Grrnnnn", "No my brains.. other brains!"],
  },
  robot: {
    spawn: ["Battle algorythems initiated.", "Targets: Locked and readied."],
    kill: ["Target nutralized.", "Target eliminated."],
    death: [
      "Why was I programmed to feel pain?",
      "ERROR: CPU damage sensed",
      "ERROR: CPU Malfunction",
    ],
    taunt: ["Elimination in progress.", "Removing target.", "Target locked."],
    lowHealth: ["ERROR: Damage to self = POSITIVE", "ERROR: Self damage"],
  },
  angry: {
    spawn: ["YOURE ALL GOIN DOWN!", "NO ONE STANDS A CHANCE"],
    kill: ["AWW POOR BABY", "TAKE IT!!", "YEAH EAT THAT!", "HOW YOU LIKE THAT?"],
    death: ["What?!?", "Stop that!!!", "ARRGGG!!!"],
    taunt: ["EAT IT", "YOU LIKE THE TASTE OF BULLETS?", "GOTCHA"],
    lowHealth: ["AHHHHHHHH", "I GOTTA STOP HURTING MYSELF"],
  },
  leetnoob: {
    spawn: [
      "Prepare to be owned.",
      "I'ma own this place up!",
      "dis is my first time lolz",
      "how do i shot web?? :o",
    ],
    kill: ["PWND", "owned.", "lololz u lik dat? ;)", "omg i killd 1 XD"],
    death: ["I was typing!", "That was lag!!", "oww wtf??", "zomggg D:"],
    taunt: ["Check out this hot aim.", "Perfect accuracy baby!", "lol i no im a nub ;D"],
    lowHealth: ["I'm hurting myself.. damn lag!", "OMG ouch :(", "oww why i do dat??"],
  },
};

export const Personality = {
  /** Pick a random archetype for a new bot. */
  pick(): PersId {
    return ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
  },

  /** A random line for `pers` reacting to `event`. Falls back to "gamer". */
  line(pers: string, event: PersEvent): string {
    const table = LINES[pers as PersId] ?? LINES.gamer;
    const pool = table[event] ?? table.taunt;
    return pool[Math.floor(Math.random() * pool.length)];
  },
};
