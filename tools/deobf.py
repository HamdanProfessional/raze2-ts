#!/usr/bin/env python3
"""Undo FFDec's `§§push` / `§§pop` stack rendering in a decompiled .as file.

When FFDec cannot fold an expression back into AS3 it prints the raw operand
stack instead: a run of `§§push(...)` statements, then a statement that reads
them back as `§§pop()`. The pushes fill a queue and the pops drain it
left-to-right, so

    §§push(game); §§push(746); §§push(505); §§push("fairy");
    §§pop().createParticle(§§pop(), §§pop(), §§pop(), null, "fairy");

is just `game.createParticle(746, 505, "fairy", null, "fairy")`. The obfuscator
also salts the output with `if(false){...}` guards between the pushes and the
pop, which are dead and only there to stop the decompiler folding the run.

LIMIT: the queue is straight-line. Where the pushes sit in mutually exclusive
branches — a `switch` whose every case pushes a constant, feeding a following
`switch(§§pop())` — only one of them runs at a time and a queue models it
wrongly. Slice past that with `--start` and resolve the rest on its own.

    python tools/deobf.py <file.as> [-o out.as] [--start N] [--end N]
"""
import argparse
import re
import sys

PUSH = "§§push"
POP = "§§pop()"
FINDPROP = "§§findproperty"


def match_paren(s, i):
    """`i` indexes the opening paren; return the index just past its match."""
    depth = 0
    in_str = None
    while i < len(s):
        c = s[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == in_str:
                in_str = None
        elif c in "\"'":
            in_str = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced parentheses")


def strip_dead_ifs(s):
    """Drop every `if(false){ ... }` block, however it is spelled."""
    out = []
    i = 0
    pat = re.compile(r"if\s*\(\s*false\s*\)\s*", re.S)
    while True:
        m = pat.search(s, i)
        if not m:
            out.append(s[i:])
            break
        out.append(s[i:m.start()])
        j = m.end()
        if j < len(s) and s[j] == "{":
            depth = 0
            while j < len(s):
                if s[j] == "{":
                    depth += 1
                elif s[j] == "}":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
        else:                              # braceless body: to the semicolon
            j = s.find(";", j) + 1
        # Swallow the now-orphaned blank line.
        while j < len(s) and s[j] in " \t":
            j += 1
        if j < len(s) and s[j] == "\n":
            j += 1
        i = j
    return "".join(out)


def resolve(s, queue, reset=None):
    """Rewrite `s`, draining `queue` for each `§§pop()` and filling it on push.

    `reset` is a compiled pattern matched against each line; where it hits, the
    queue is emptied first. Use it at branch boundaries (`^\\s*case `) so a run
    of pushes cannot leak out of the arm that made them.
    """
    out = []
    i = 0
    while i < len(s):
        if reset and (i == 0 or s[i - 1] == "\n"):
            eol = s.find("\n", i)
            if reset.match(s[i:eol if eol >= 0 else len(s)]):
                queue.clear()
        if s.startswith(POP, i):
            out.append(queue.pop(0) if queue else POP)
            i += len(POP)
            continue
        if s.startswith(PUSH, i) and s[i + len(PUSH):].lstrip().startswith("("):
            op = s.index("(", i + len(PUSH))
            end = match_paren(s, op)
            # The pushed expression may itself pop, so resolve it first —
            # the queue is shared and strictly in order.
            queue.append(resolve(s[op + 1:end - 1], queue, reset).strip())
            # Swallow the statement's trailing `;` and its whole line.
            j = end
            while j < len(s) and s[j] in " \t":
                j += 1
            if j < len(s) and s[j] == ";":
                j += 1
            k = j
            while k < len(s) and s[k] in " \t":
                k += 1
            if k < len(s) and s[k] == "\n":
                # Also drop the indentation we already emitted for this line.
                while out and out[-1] in " \t":
                    out.pop()
                j = k + 1
            i = j
            continue
        if s.startswith(FINDPROP, i) and s[i + len(FINDPROP):].lstrip().startswith("("):
            op = s.index("(", i + len(FINDPROP))
            end = match_paren(s, op)
            out.append(resolve(s[op + 1:end - 1], queue, reset).strip())
            i = end
            continue
        out.append(s[i])
        i += 1
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("-o", "--out")
    ap.add_argument("--start", type=int, default=1, help="first line (1-based)")
    ap.add_argument("--end", type=int, default=0, help="last line, 0 = to EOF")
    ap.add_argument("--reset", help="regex; empty the stack at lines matching it")
    args = ap.parse_args()

    lines = open(args.path, encoding="utf-8").read().splitlines(keepends=True)
    src = "".join(lines[args.start - 1:(args.end or len(lines))])
    reset = re.compile(args.reset) if args.reset else None
    text = resolve(strip_dead_ifs(src), [], reset)
    # `x.prop = v` where x was a findproperty is just `prop = v`.
    text = re.sub(r"\b(\w+)\.\1\s*=", r"\1 =", text)
    text = re.sub(r"\+\+(\w+)\.\1\b", r"++\1", text)

    if args.out:
        open(args.out, "w", encoding="utf-8").write(text)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(text)
    left = text.count(POP) + text.count(PUSH)
    if left:
        print(f"warning: {left} stack ops left unresolved", file=sys.stderr)


if __name__ == "__main__":
    main()
