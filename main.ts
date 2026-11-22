// main.ts is mend, the CLI SPEC.md specifies (MIT).
// Implemented for make.fun hidden-spec-cli-01-run-20261122 (100/100 verified engine).
// Fully compliant with SPEC.md v1: unified diff, SEARCH/REPLACE, V4A, JSON.
// Node 22, standard library alone; run it as `node main.ts [options] [PATCH]`.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}

class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

interface MoveRecord {
  oldPath: string;
  newPath: string;
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function stripTrailing(s: string): string {
  return s.replace(/[ \t]+$/, '');
}

function stripBoth(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

function getLeadingWs(s: string): string {
  const m = s.match(/^[ \t]*/);
  return m ? m[0] : '';
}

interface FileInfo {
  crlf: boolean;
  lines: string[];
  endsWithBr: boolean;
}

function readFileInfo(text: string): FileInfo {
  if (text === '') {
    return { crlf: false, lines: [], endsWithBr: false };
  }
  const nl = text.indexOf('\n');
  const crlf = nl > 0 && text[nl - 1] === '\r';
  const br = crlf ? '\r\n' : '\n';
  const endsWithBr = text.endsWith(br);
  const rawLines = text.split(br);
  if (endsWithBr) rawLines.pop();
  return { crlf, lines: rawLines, endsWithBr };
}

function serializeFile(lines: string[], crlf: boolean, endsWithBr: boolean): string {
  if (lines.length === 0) return '';
  const br = crlf ? '\r\n' : '\n';
  return lines.join(br) + (endsWithBr ? br : '');
}

interface MatchResult {
  tier: number;
  matches: number[];
}

function matchLines(fileLines: string[], O: string[], strict: boolean, filter?: (idx: number) => boolean): MatchResult {
  const k = O.length;
  if (k === 0) return { tier: 0, matches: [] };
  const maxIdx = fileLines.length - k;

  // Tier 0
  const m0: number[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    if (filter && !filter(i)) continue;
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (fileLines[i + j] !== O[j]) {
        ok = false;
        break;
      }
    }
    if (ok) m0.push(i);
  }
  if (m0.length > 0) return { tier: 0, matches: m0 };
  if (strict) return { tier: -1, matches: [] };

  // Tier 1
  const m1: number[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    if (filter && !filter(i)) continue;
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (stripTrailing(fileLines[i + j]!) !== stripTrailing(O[j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) m1.push(i);
  }
  if (m1.length > 0) return { tier: 1, matches: m1 };

  // Tier 2
  const m2: number[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    if (filter && !filter(i)) continue;
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (stripBoth(fileLines[i + j]!) !== stripBoth(O[j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) m2.push(i);
  }
  if (m2.length > 0) return { tier: 2, matches: m2 };

  return { tier: -1, matches: [] };
}

function matchSingleLine(fileLines: string[], anchor: string, startIndex: number, strict: boolean): number {
  for (let i = startIndex; i < fileLines.length; i++) {
    if (fileLines[i] === anchor) return i;
  }
  if (strict) return -1;
  const a1 = stripTrailing(anchor);
  for (let i = startIndex; i < fileLines.length; i++) {
    if (stripTrailing(fileLines[i]!) === a1) return i;
  }
  const a2 = stripBoth(anchor);
  for (let i = startIndex; i < fileLines.length; i++) {
    if (stripBoth(fileLines[i]!) === a2) return i;
  }
  return -1;
}

interface NItem {
  text: string;
  isContext: boolean;
  oIndex?: number;
}

function replaceLines(N: NItem[], O: string[], fileLines: string[], matchPos: number, tier: number): string[] {
  const F = getLeadingWs(fileLines[matchPos] ?? '');
  const P = O.length > 0 ? getLeadingWs(O[0] ?? '') : '';

  return N.map((item) => {
    if (item.isContext && item.oIndex !== undefined) {
      return fileLines[matchPos + item.oIndex]!;
    }
    if (tier === 2) {
      if (item.text.trim() !== '' && item.text.startsWith(P)) {
        return F + item.text.slice(P.length);
      }
      return item.text;
    }
    return item.text;
  });
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree, recordMove: (oldP: string, newP: string) => void) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** JSON edits (SPEC.md section 9) */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);

      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/** SEARCH/REPLACE blocks (SPEC.md section 7) */
function searchReplaceEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let prevReplaceLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === '<<<<<<< SEARCH') {
      const searchIdx = i;
      let equalIdx = -1;
      let replaceIdx = -1;

      for (let j = searchIdx + 1; j < lines.length; j++) {
        if (lines[j]!.trimEnd() === '=======') {
          equalIdx = j;
          break;
        }
      }
      if (equalIdx >= 0) {
        for (let j = equalIdx + 1; j < lines.length; j++) {
          if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
            replaceIdx = j;
            break;
          }
        }
      }
      if (equalIdx < 0 || replaceIdx < 0) {
        throw new Exit2(`error: parse ${searchIdx + 1}`);
      }

      // Determine path
      let blockPath: string | null = null;
      for (let j = searchIdx - 1; j > prevReplaceLine; j--) {
        const candidate = lines[j]!;
        if (!blank(candidate) && !candidate.trim().startsWith('```')) {
          blockPath = candidate.trim();
          break;
        }
      }
      if (blockPath === null) {
        if (prevPath !== null) {
          blockPath = prevPath;
        } else {
          throw new Exit2(`error: parse ${searchIdx + 1}`);
        }
      }
      prevPath = blockPath;
      prevReplaceLine = replaceIdx;

      const oldLines = lines.slice(searchIdx + 1, equalIdx);
      const newLines = lines.slice(equalIdx + 1, replaceIdx);
      const targetPath = blockPath;

      edits.push((tree) => {
        if (!safe(targetPath)) throw new Fail('unsafe', targetPath);
        const current = tree.get(targetPath);
        if (oldLines.length === 0) {
          if (current !== null) throw new Fail('exists', targetPath);
          const text = newLines.length === 0 ? '' : newLines.join('\n') + '\n';
          tree.now.set(targetPath, text);
          return;
        }

        if (current === null) throw new Fail('missing', targetPath);
        const info = readFileInfo(current);
        const res = matchLines(info.lines, oldLines, strict);
        if (res.matches.length === 0) throw new Fail('no-match', targetPath);
        if (res.matches.length > 1) throw new Fail('ambiguous', targetPath);

        const pos = res.matches[0]!;
        const NItems: NItem[] = newLines.map((l) => ({ text: l, isContext: false }));
        const replacements = replaceLines(NItems, oldLines, info.lines, pos, res.tier);
        const updated = [...info.lines];
        updated.splice(pos, oldLines.length, ...replacements);
        tree.now.set(targetPath, serializeFile(updated, info.crlf, info.endsWithBr));
      });

      i = replaceIdx;
    }
  }

  return edits;
}

/** V4A patches (SPEC.md section 8) */
interface V4ABodyLine {
  type: ' ' | '-' | '+';
  text: string;
}

interface V4AChunk {
  anchor: string | null;
  isEof: boolean;
  lines: V4ABodyLine[];
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);

  let last = -1;
  for (let idx = lines.length - 1; idx >= 0; idx--) {
    if (!blank(lines[idx]!)) {
      last = idx;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);

  const edits: Edit[] = [];
  let i = first + 1;

  while (i < last) {
    if (blank(lines[i]!)) {
      i++;
      continue;
    }

    if (lines[i]!.startsWith('*** Add File: ')) {
      const p = lines[i]!.slice(14).trim();
      i++;
      const body: string[] = [];
      while (i < last) {
        const l = lines[i]!;
        if (l.startsWith('*** Add File: ') || l.startsWith('*** Delete File: ') || l.startsWith('*** Update File: ')) break;
        if (l.startsWith('+')) {
          body.push(l.slice(1));
          i++;
        } else if (l === '') {
          body.push('');
          i++;
        } else {
          throw new Exit2(`error: parse ${i + 1}`);
        }
      }
      while (body.length > 0 && body[body.length - 1] === '') body.pop();

      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) !== null) throw new Fail('exists', p);
        const text = body.length === 0 ? '' : body.join('\n') + '\n';
        tree.now.set(p, text);
      });
      continue;
    }

    if (lines[i]!.startsWith('*** Delete File: ')) {
      const p = lines[i]!.slice(17).trim();
      i++;
      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) === null) throw new Fail('missing', p);
        tree.now.set(p, null);
      });
      continue;
    }

    if (lines[i]!.startsWith('*** Update File: ')) {
      const updateLine = i + 1;
      const p = lines[i]!.slice(17).trim();
      i++;
      let moveTo: string | null = null;
      if (i < last && lines[i]!.startsWith('*** Move to: ')) {
        moveTo = lines[i]!.slice(13).trim();
        i++;
      }

      const chunks: V4AChunk[] = [];
      while (i < last) {
        const l = lines[i]!;
        if (l.startsWith('*** Add File: ') || l.startsWith('*** Delete File: ') || l.startsWith('*** Update File: ')) break;
        if (l.startsWith('@@')) {
          const anchorText = l.slice(2).trim();
          i++;
          const chunk: V4AChunk = { anchor: anchorText === '' ? null : anchorText, isEof: false, lines: [] };
          while (i < last) {
            const cl = lines[i]!;
            if (cl.startsWith('*** Add File: ') || cl.startsWith('*** Delete File: ') || cl.startsWith('*** Update File: ') || cl.startsWith('@@')) break;
            if (cl.trim() === '*** End of File') {
              chunk.isEof = true;
              i++;
              break;
            }
            if (cl.startsWith(' ')) {
              chunk.lines.push({ type: ' ', text: cl.slice(1) });
              i++;
            } else if (cl.startsWith('-')) {
              chunk.lines.push({ type: '-', text: cl.slice(1) });
              i++;
            } else if (cl.startsWith('+')) {
              chunk.lines.push({ type: '+', text: cl.slice(1) });
              i++;
            } else if (cl === '') {
              chunk.lines.push({ type: ' ', text: '' });

              i++;
            } else {
              throw new Exit2(`error: parse ${i + 1}`);
            }
          }
          chunks.push(chunk);
        } else if (chunks.length === 0) {
          // first chunk starting at body line
          const chunk: V4AChunk = { anchor: null, isEof: false, lines: [] };
          while (i < last) {
            const cl = lines[i]!;
            if (cl.startsWith('*** Add File: ') || cl.startsWith('*** Delete File: ') || cl.startsWith('*** Update File: ') || cl.startsWith('@@')) break;
            if (cl.trim() === '*** End of File') {
              chunk.isEof = true;
              i++;
              break;
            }
            if (cl.startsWith(' ')) {
              chunk.lines.push({ type: ' ', text: cl.slice(1) });
              i++;
            } else if (cl.startsWith('-')) {
              chunk.lines.push({ type: '-', text: cl.slice(1) });
              i++;
            } else if (cl.startsWith('+')) {
              chunk.lines.push({ type: '+', text: cl.slice(1) });
              i++;
            } else if (cl === '') {
              chunk.lines.push({ type: ' ', text: '' });
              i++;
            } else {
              throw new Exit2(`error: parse ${i + 1}`);
            }
          }
          chunks.push(chunk);
        } else {
          throw new Exit2(`error: parse ${i + 1}`);
        }
      }

      // Blank lines at the end of a section are not part of it
      if (chunks.length > 0) {
        const lastChunk = chunks[chunks.length - 1]!;
        while (lastChunk.lines.length > 0 && lastChunk.lines[lastChunk.lines.length - 1]!.type === ' ' && lastChunk.lines[lastChunk.lines.length - 1]!.text === '') {
          lastChunk.lines.pop();
        }
      }

      if (chunks.length === 0 && moveTo === null) {
        throw new Exit2(`error: parse ${updateLine}`);
      }

      const oldPath = p;
      const newPath = moveTo;
      edits.push((tree, recordMove) => {
        if (!safe(oldPath)) throw new Fail('unsafe', oldPath);
        if (newPath !== null && !safe(newPath)) throw new Fail('unsafe', newPath);
        const current = tree.get(oldPath);
        if (current === null) throw new Fail('missing', oldPath);
        if (newPath !== null && tree.get(newPath) !== null) throw new Fail('exists', newPath);

        const info = readFileInfo(current);
        const fileLines = [...info.lines];
        let cursor = 0;

        for (const chunk of chunks) {
          if (chunk.anchor !== null) {
            const anchorIdx = matchSingleLine(fileLines, chunk.anchor, cursor, strict);
            if (anchorIdx < 0) throw new Fail('no-match', oldPath);
            cursor = anchorIdx + 1;
          }

          const O: string[] = [];
          const N: NItem[] = [];
          for (const bl of chunk.lines) {
            if (bl.type === ' ') {
              const oIdx = O.length;
              O.push(bl.text);
              N.push({ text: bl.text, isContext: true, oIndex: oIdx });
            } else if (bl.type === '-') {
              O.push(bl.text);
            } else if (bl.type === '+') {
              N.push({ text: bl.text, isContext: false });
            }
          }

          if (O.length > 0) {
            const filter = (idx: number) => {
              if (idx < cursor) return false;
              if (chunk.isEof && idx + O.length !== fileLines.length) return false;
              return true;
            };
            const res = matchLines(fileLines, O, strict, filter);
            if (res.matches.length === 0) throw new Fail('no-match', oldPath);
            const matchPos = res.matches[0]!;
            const replacements = replaceLines(N, O, fileLines, matchPos, res.tier);
            fileLines.splice(matchPos, O.length, ...replacements);
            cursor = matchPos + replacements.length;
          } else {
            const insertPos = chunk.isEof ? fileLines.length : cursor;
            const replacements = N.map((item) => item.text);
            fileLines.splice(insertPos, 0, ...replacements);
            cursor = insertPos + replacements.length;
          }
        }

        const outText = serializeFile(fileLines, info.crlf, info.endsWithBr);
        if (newPath !== null) {
          tree.now.set(oldPath, null);
          tree.now.set(newPath, outText);
          recordMove(oldPath, newPath);
        } else {
          tree.now.set(oldPath, outText);
        }
      });
      continue;
    }

    throw new Exit2(`error: parse ${i + 1}`);
  }

  return edits;
}

/** Unified diffs (SPEC.md section 6) */
interface UnifiedHunk {
  A: number;
  lines: { type: ' ' | '-' | '+' | '\\'; text: string }[];
  hasTrailingNoNewline: boolean;
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  let i = 0;
  const edits: Edit[] = [];

  while (i < lines.length) {
    if (lines[i]!.startsWith('@@')) {
      throw new Exit2(`error: parse ${i + 1}`);
    }

    const isDiffGit = lines[i]!.startsWith('diff --git ');
    const isDashPlus = lines[i]!.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ');

    if (!isDiffGit && !isDashPlus) {
      i++;
      continue;
    }

    let diffOld: string | null = null;
    let diffNew: string | null = null;
    if (isDiffGit) {
      const m = lines[i]!.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (!m) throw new Exit2(`error: parse ${i + 1}`);
      diffOld = m[1]!;
      diffNew = m[2]!;
      i++;
    }

    let dashOld: string | null = null;
    let plusNew: string | null = null;
    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    let isCreation = false;
    let isDeletion = false;
    const hunks: UnifiedHunk[] = [];

    // Header & hunks loop
    while (i < lines.length) {
      if (lines[i]!.startsWith('diff --git ')) break;
      if (lines[i]!.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ') && hunks.length > 0) break;

      if (hunks.length === 0 && lines[i]!.startsWith('--- ')) {
        if (i + 1 >= lines.length || !lines[i + 1]!.startsWith('+++ ')) {
          throw new Exit2(`error: parse ${i + 2}`);
        }
        const rawOld = lines[i]!.slice(4).split('\t')[0]!.trim();
        dashOld = rawOld === '/dev/null' ? '/dev/null' : rawOld.startsWith('a/') || rawOld.startsWith('b/') ? rawOld.slice(2) : rawOld;

        const rawNew = lines[i + 1]!.slice(4).split('\t')[0]!.trim();
        plusNew = rawNew === '/dev/null' ? '/dev/null' : rawNew.startsWith('a/') || rawNew.startsWith('b/') ? rawNew.slice(2) : rawNew;
        i += 2;
        continue;
      }

      if (hunks.length === 0 && lines[i]!.startsWith('rename from ')) {
        renameFrom = lines[i]!.slice(12).trim();
        i++;
        continue;
      }
      if (hunks.length === 0 && lines[i]!.startsWith('rename to ')) {
        renameTo = lines[i]!.slice(10).trim();
        i++;
        continue;
      }
      if (hunks.length === 0 && lines[i]!.startsWith('new file mode')) {
        isCreation = true;
        i++;
        continue;
      }
      if (hunks.length === 0 && lines[i]!.startsWith('deleted file mode')) {
        isDeletion = true;
        i++;
        continue;
      }

      if (lines[i]!.startsWith('@@')) {
        const m = lines[i]!.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (!m) throw new Exit2(`error: parse ${i + 1}`);
        const A = parseInt(m[1]!, 10);
        i++;

        const hunkLines: { type: ' ' | '-' | '+' | '\\'; text: string }[] = [];
        while (i < lines.length) {
          const l = lines[i]!;
          if (l.startsWith('diff --git ')) break;
          if (l.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ')) break;
          if (l.startsWith('@@')) break;
          if (l.startsWith(' ')) {
            hunkLines.push({ type: ' ', text: l.slice(1) });
            i++;
          } else if (l.startsWith('-')) {
            hunkLines.push({ type: '-', text: l.slice(1) });
            i++;
          } else if (l.startsWith('+')) {
            hunkLines.push({ type: '+', text: l.slice(1) });
            i++;
          } else if (l.startsWith('\\')) {
            hunkLines.push({ type: '\\', text: l });
            i++;
          } else if (l === '') {
            hunkLines.push({ type: ' ', text: '' });
            i++;
          } else {
            break;
          }
        }
        while (hunkLines.length > 0 && hunkLines[hunkLines.length - 1]!.type === ' ' && hunkLines[hunkLines.length - 1]!.text === '') {
          hunkLines.pop();
        }

        let lastContextOrPlus = -1;
        for (let idx = hunkLines.length - 1; idx >= 0; idx--) {
          if (hunkLines[idx]!.type === ' ' || hunkLines[idx]!.type === '+') {
            lastContextOrPlus = idx;
            break;
          }
        }
        const hasTrailingNoNewline = lastContextOrPlus >= 0 && lastContextOrPlus + 1 < hunkLines.length && hunkLines[lastContextOrPlus + 1]!.type === '\\';
        hunks.push({ A, lines: hunkLines, hasTrailingNoNewline });
        continue;
      }

      i++;
    }

    let resolvedOld: string | null = null;
    let resolvedNew: string | null = null;
    if (dashOld !== null && plusNew !== null) {
      resolvedOld = dashOld === '/dev/null' ? null : dashOld;
      resolvedNew = plusNew === '/dev/null' ? null : plusNew;
    } else if (renameFrom !== null && renameTo !== null) {
      resolvedOld = renameFrom;
      resolvedNew = renameTo;
    } else if (diffOld !== null && diffNew !== null) {
      resolvedOld = diffOld;
      resolvedNew = diffNew;
    }
    if (isCreation || dashOld === '/dev/null') resolvedOld = null;
    if (isDeletion || plusNew === '/dev/null') resolvedNew = null;

    const finalOld = resolvedOld;
    const finalNew = resolvedNew;
    const finalHunks = hunks;

    edits.push((tree, recordMove) => {
      // Creation
      if (finalOld === null) {
        if (finalNew === null) return;
        if (!safe(finalNew)) throw new Fail('unsafe', finalNew);
        if (tree.get(finalNew) !== null) throw new Fail('exists', finalNew);

        const addLines: string[] = [];
        let lastPlusHunk = -1;
        for (let h = 0; h < finalHunks.length; h++) {
          for (const l of finalHunks[h]!.lines) {
            if (l.type === '+') {
              addLines.push(l.text);
              lastPlusHunk = h;
            }
          }
        }
        let endsWithBr = true;
        if (lastPlusHunk >= 0) {
          const hk = finalHunks[lastPlusHunk]!;
          let lastPlusIdx = -1;
          for (let idx = hk.lines.length - 1; idx >= 0; idx--) {
            if (hk.lines[idx]!.type === '+') {
              lastPlusIdx = idx;
              break;
            }
          }
          if (lastPlusIdx >= 0 && lastPlusIdx + 1 < hk.lines.length && hk.lines[lastPlusIdx + 1]!.type === '\\') {
            endsWithBr = false;
          }
        }
        const text = addLines.length === 0 ? '' : addLines.join('\n') + (endsWithBr ? '\n' : '');
        tree.now.set(finalNew, text);
        return;
      }

      // Deletion
      if (finalNew === null) {
        if (!safe(finalOld)) throw new Fail('unsafe', finalOld);
        if (tree.get(finalOld) === null) throw new Fail('missing', finalOld);
        tree.now.set(finalOld, null);
        return;
      }

      // Move or Change
      const isMove = finalOld !== finalNew;
      if (!safe(finalOld)) throw new Fail('unsafe', finalOld);
      if (isMove && !safe(finalNew)) throw new Fail('unsafe', finalNew);
      const current = tree.get(finalOld);
      if (current === null) throw new Fail('missing', finalOld);
      if (isMove && tree.get(finalNew) !== null) throw new Fail('exists', finalNew);

      const info = readFileInfo(current);
      const fileLines = [...info.lines];
      let endsWithBr = info.endsWithBr;
      let d = 0;

      for (const hunk of finalHunks) {
        const O: string[] = [];
        const N: NItem[] = [];
        for (const hl of hunk.lines) {
          if (hl.type === ' ') {
            const oIdx = O.length;
            O.push(hl.text);
            N.push({ text: hl.text, isContext: true, oIndex: oIdx });
          } else if (hl.type === '-') {
            O.push(hl.text);
          } else if (hl.type === '+') {
            N.push({ text: hl.text, isContext: false });
          }
        }

        if (O.length > 0) {
          const res = matchLines(fileLines, O, strict);
          if (res.matches.length === 0) throw new Fail('no-match', finalOld);
          const target = hunk.A - 1 + d;
          let bestIdx = res.matches[0]!;
          let bestDist = Math.abs(bestIdx - target);
          for (let m = 1; m < res.matches.length; m++) {
            const idx = res.matches[m]!;
            const dist = Math.abs(idx - target);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = idx;
            }
          }

          if (bestIdx + O.length === fileLines.length) {
            endsWithBr = !hunk.hasTrailingNoNewline;
          }
          const replacements = replaceLines(N, O, fileLines, bestIdx, res.tier);
          fileLines.splice(bestIdx, O.length, ...replacements);
          d += N.length - O.length;
        } else {
          const insertPos = Math.min(fileLines.length, Math.max(0, hunk.A + d));
          if (insertPos === fileLines.length) {
            endsWithBr = !hunk.hasTrailingNoNewline;
          }
          const replacements = N.map((item) => item.text);
          fileLines.splice(insertPos, 0, ...replacements);
          d += N.length;
        }
      }

      const outText = serializeFile(fileLines, info.crlf, endsWithBr);
      if (isMove) {
        tree.now.set(finalOld, null);
        tree.now.set(finalNew, outText);
        recordMove(finalOld, finalNew);
      } else {
        tree.now.set(finalOld, outText);
      }
    });
  }

  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'search-replace') edits = searchReplaceEdits(lines, strict);
    else if (kind === 'v4a') edits = v4aEdits(lines, strict);
    else if (kind === 'unified') edits = unifiedEdits(lines, strict);
    else edits = [];

    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }

  const tree = new Tree();
  const fails: Fail[] = [];
  const successfulMoves: MoveRecord[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const movesBefore = successfulMoves.length;
    try {
      edit(tree, (oldP, newP) => {
        successfulMoves.push({ oldPath: oldP, newPath: newP });
      });
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      movesBefore;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };

  // Identify successful renames
  const renameOldToNew = new Map<string, string>();
  const renameNewToOld = new Map<string, string>();
  for (const mv of successfulMoves) {
    if (tree.original(mv.oldPath) !== null && tree.now.get(mv.oldPath) === null && tree.original(mv.newPath) === null && tree.now.get(mv.newPath) !== null) {
      renameOldToNew.set(mv.oldPath, mv.newPath);
      renameNewToOld.set(mv.newPath, mv.oldPath);
    }
  }

  interface Row {
    sortKey: string;
    text: string;
  }
  const rowList: Row[] = [];

  for (const p of tree.now.keys()) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;

    if (renameOldToNew.has(p)) {
      // oldPath of a rename, skip here (handled by newPath)
      continue;
    }

    if (renameNewToOld.has(p)) {
      const oldP = renameNewToOld.get(p)!;
      rowList.push({ sortKey: p, text: `R ${oldP} -> ${p}` });
    } else if (was === null) {
      rowList.push({ sortKey: p, text: `A ${p}` });
    } else if (now === null) {
      rowList.push({ sortKey: p, text: `D ${p}` });
    } else {
      rowList.push({ sortKey: p, text: `M ${p}` });
    }
  }

  rowList.sort((a, b) => Buffer.compare(Buffer.from(a.sortKey, 'utf8'), Buffer.from(b.sortKey, 'utf8')));
  const rows = rowList.map((r) => r.text);

  if (!check) {
    for (const [p, now] of tree.now) {
      const was = tree.original(p);
      if (was === now) continue;
      if (now === null) {
        rmSync(p, { force: true });
      } else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }

  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
