// Extract Raze 2 catalog tables (guns / kill-bonuses / skins / equipment) from the
// decompiled AS3 into JSON. Handles both clean `addX(...)` calls and the FFDec
// §§push/§§pop stack-op form by folding the latter back into clean calls, then
// evaluates the resulting literals in a vm sandbox where unknown identifiers
// (class refs like Bullet_Line_Basic, sound refs like S_pistolFire) resolve to
// their own name string.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = "C:/Users/Hamdan/Desktop/mc/raze/decompiled_swf/raze 2/scripts";
const OUT = "C:/Users/Hamdan/Desktop/mc/raze/raze-ts/src/assets/raze2";

// positional field maps, from each addX signature body
const FIELDS = {
  addGun: ["type","id","sprite","name","race","cost","dmg","mults","force","splash","splashMult","clipSize","clipMax","range","recoil","autoFire","shootDelay","xOff","yOff","effShoot","effHit","effShell","frameIdle","frameFire","frameReload","shotSound","hitSound","cls","params","extra","special","desc"],
  addSkin: ["frame","id","cost","blood","race","name"],
  addBonus: ["id","worth","name","desc"],
  addEquipment: ["cls","name","type","value","cost","desc"],
};

function initBody(text) {
  const m = text.match(/static function Init\s*\(\s*\)\s*:\s*void\s*\{/);
  if (!m) throw new Error("no Init");
  let i = m.index + m[0].length, depth = 1, start = i;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
  }
  return text.slice(start, i - 1);
}

// remove `if(false){ ... }` guard blocks (their bodies are only return stmts)
function stripDeadIf(body) {
  let out = body, prev;
  do {
    prev = out;
    out = out.replace(/if\s*\(\s*false\s*\)\s*\{[^{}]*\}/g, "");
  } while (out !== prev);
  return out;
}

// split a call's argument list on top-level commas
function splitArgs(s) {
  const args = []; let depth = 0, q = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

// split source into top-level statements (on `;` outside strings/brackets)
function splitStatements(s) {
  const stmts = []; let depth = 0, q = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === ";" && depth === 0) { stmts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts;
}

// fold §§push/§§pop groups into clean calls, statement by statement
function foldStackOps(body) {
  const out = [];
  let pending = null; // captured pushed exprs for the current group
  let temps = {}; // FFDec `dup` temps: value popped off the stack then re-pushed
  for (const raw of splitStatements(body)) {
    const stmt = raw.trim();
    let m;
    if ((m = stmt.match(/^§§push\(§§findproperty\((\w+)\)\)$/))) {
      pending = []; // start group
      temps = {};
      continue;
    }
    // dup: pop the top of the stack into a temp, later re-pushed (often twice)
    if (pending && (m = stmt.match(/^var (_temp_\w+)\s*:\s*\*\s*=\s*§§pop\(\)$/))) {
      temps[m[1]] = pending.pop();
      continue;
    }
    if (pending && (m = stmt.match(/^§§push\((_temp_\w+)\)$/))) {
      pending.push(temps[m[1]]);
      continue;
    }
    if (pending && (m = stmt.match(/^§§push\(([\s\S]*)\)$/))) {
      pending.push(m[1].trim());
      continue;
    }
    if ((m = stmt.match(/^§§pop\(\)\.(\w+)\(([\s\S]*)\)$/))) {
      const name = m[1];
      // Replace every §§pop() (including ones nested in inline array/object
      // literals, e.g. a pushed computed key {(§§pop()):2}) left-to-right with
      // the captured pushes in order.
      const argsStr = m[2].replace(/§§pop\(\)/g, () => pending.shift());
      out.push(`${name}(${argsStr});`);
      pending = null;
      continue;
    }
    // Keep only clean addX(...) calls; drop bookkeeping (var/while/trace, the
    // gunOb/gunAr init, cost-sum loops) which is AS-only and not catalog data.
    if (/^add(Gun|Skin|Bonus|Equipment)\s*\(/.test(stmt)) out.push(raw + ";");
  }
  return out.join("\n");
}

function extract(file, wantFns) {
  const text = fs.readFileSync(path.join(SRC, file), "utf8");
  let folded = foldStackOps(stripDeadIf(initBody(text)));
  // FFDec emits a pushed object key as a parenthesized computed key
  // `{("extraShots"):2}` — invalid JS. These are all plain string keys, so
  // unwrap them back to `{"extraShots":2}`.
  folded = folded.replace(/\(("(?:[^"\\]|\\.)*")\)\s*:/g, "$1:");

  const records = {}; // fnName -> array of {field:value}
  for (const fn of wantFns) records[fn] = [];

  const funcs = {};
  for (const fn of wantFns) {
    funcs[fn] = (...a) => {
      const rec = {};
      FIELDS[fn].forEach((k, i) => (rec[k] = a[i] === undefined ? null : a[i]));
      records[fn].push(rec);
    };
  }

  const sandbox = new Proxy(funcs, {
    has: () => true,
    get: (t, prop) => {
      if (typeof prop === "symbol") return undefined;
      if (prop in t) return t[prop];
      if (prop === "null") return null;
      return String(prop); // class/sound/enum identifier -> its name
    },
  });

  vm.runInNewContext(folded, sandbox, { filename: file });
  return records;
}

fs.mkdirSync(OUT, { recursive: true });

const guns = extract("Stats_Guns.as", ["addGun"]).addGun;
const bonuses = extract("Stats_KillBonuses.as", ["addBonus"]).addBonus;
const skins = extract("Stats_Skins.as", ["addSkin"]).addSkin;
const equipment = extract("Stats_Equipment.as", ["addEquipment"]).addEquipment;

const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 1) + "\n");
  console.log(name, "->", Array.isArray(data) ? data.length + " entries" : "ok");
};
write("weapons.json", guns);
write("killBonuses.json", bonuses);
write("skins.json", skins);
write("equipment.json", equipment);

// quick sanity dump
console.log("\nfirst gun:", JSON.stringify(guns[0]));
console.log("gun ids:", guns.map((g) => g.id).join(", "));
console.log("skin count by race:", skins.reduce((o, s) => ((o[s.race] = (o[s.race] || 0) + 1), o), {}));
console.log("bonus ids:", bonuses.map((b) => b.id).join(", "));
console.log("equip count:", equipment.length, "types:", [...new Set(equipment.map((e) => e.cls))].join(","));
