// Python the judge can't compile, spotted before the student finds out the hard way.
//
// The two halves of a code question run different Pythons: "ทดสอบ" runs Pyodide in the
// browser, which is 3.12, and "ส่งคำตอบ" runs Sphere Engine compiler 116, which is 3.5.3
// (January 2017) — the only Python this account's plan actually provides, so it can't be
// swapped for a newer one. An f-string compiles happily in the browser and is a syntax
// error on the judge, and under the current scoring a syntax error is a zero.
//
// So the browser warns about it instead, at "ทดสอบ" time, while there is still time to
// rewrite the line. Shared with api/judge.ts, which adds the same explanation to a
// compilation error, since by then the traceback alone doesn't say why.
//
// This is a warning, never a block: the list below is the common cases, not a Python 3.5
// parser, and it must never stop someone running code that would in fact have worked.

export const JUDGE_PYTHON_VERSION = '3.5.3';

export interface SyntaxWarning {
  feature: string;
  since: string;
  line: number;
  fix: string;
}

// Replaces every string literal and comment with spaces, keeping the text the same length
// and newlines in place, so later matches can't fire inside a string and line numbers stay
// honest. f-strings are collected on the way through: finding one means looking at the
// letters immediately before the quote, which is only possible here.
const blankStringsAndComments = (code: string): { stripped: string; fStrings: number[] } => {
  const out: string[] = [];
  const fStrings: number[] = [];
  let line = 1;
  let i = 0;

  const push = (ch: string) => {
    out.push(ch === '\n' ? '\n' : ' ');
    if (ch === '\n') line++;
  };

  while (i < code.length) {
    const ch = code[i];

    if (ch === '#') {
      while (i < code.length && code[i] !== '\n') push(code[i++]);
      continue;
    }

    if (ch === '"' || ch === "'") {
      // The prefix is the run of letters touching the quote: f"", rf"", b"" and so on.
      let p = out.length - 1;
      let prefix = '';
      while (p >= 0 && /[A-Za-z]/.test(code[p])) {
        prefix = code[p] + prefix;
        p--;
      }
      if (/^(?:[fF][rR]?|[rR][fF])$/.test(prefix)) fStrings.push(line);

      const quote = code.slice(i, i + 3) === ch.repeat(3) ? ch.repeat(3) : ch;
      for (let k = 0; k < quote.length; k++) push(code[i++]);
      while (i < code.length) {
        if (code[i] === '\\') {
          push(code[i++]);
          if (i < code.length) push(code[i++]);
          continue;
        }
        if (code.slice(i, i + quote.length) === quote) {
          for (let k = 0; k < quote.length; k++) push(code[i++]);
          break;
        }
        push(code[i++]);
      }
      continue;
    }

    out.push(ch);
    if (ch === '\n') line++;
    i++;
  }

  return { stripped: out.join(''), fStrings };
};

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

// Everything here is a syntax error on 3.5 — a wrong answer would be the student's problem,
// but this is the toolchain's.
// f-strings aren't here: a prefix letter is only visible while scanning the string itself,
// so they are collected by blankStringsAndComments and added below.
const F_STRING_FIX = 'เปลี่ยน f"ค่า {x}" เป็น "ค่า {}".format(x) หรือ "ค่า " + str(x)';

const PATTERNS: { feature: string; since: string; fix: string; re: RegExp }[] = [
  {
    feature: 'ตัวเลขที่มี _ คั่น',
    since: '3.6',
    fix: 'เขียน 1_000_000 เป็น 1000000',
    re: /\b\d[\d_]*_[\d_]*\d\b/g,
  },
  {
    feature: 'ประกาศชนิดของตัวแปร (x: int = 0)',
    since: '3.6',
    fix: 'ตัดชนิดออก เหลือ x = 0 (การระบุชนิดใน def ยังใช้ได้ตามปกติ)',
    re: /^[ \t]*[A-Za-z_]\w*[ \t]*:[ \t]*[A-Za-z_][\w.]*(?:\[[^\]\n]*\])?[ \t]*=/gm,
  },
  {
    feature: 'walrus operator :=',
    since: '3.8',
    fix: 'แยกเป็นสองบรรทัด กำหนดค่าก่อนแล้วค่อยนำไปใช้',
    re: /:=/g,
  },
  {
    feature: 'ชนิดข้อมูลแบบ list[int] / dict[str, int]',
    since: '3.9',
    fix: 'ใช้ List[int] จาก typing หรือตัดการระบุชนิดออก',
    re: /(?:->|:)[ \t]*(?:list|dict|tuple|set|frozenset|type)[ \t]*\[/g,
  },
  {
    feature: 'คำสั่ง match / case',
    since: '3.10',
    fix: 'เขียนเป็น if / elif แทน',
    re: /^[ \t]*match[ \t]+[^\n=]+:[ \t]*$/gm,
  },
];

export const findUnsupportedSyntax = (code: string): SyntaxWarning[] => {
  const source = String(code || '');
  if (!source.trim()) return [];

  const { stripped, fStrings } = blankStringsAndComments(source);
  const warnings: SyntaxWarning[] = [];

  fStrings.forEach((line) => warnings.push({ feature: 'f-string', since: '3.6', line, fix: F_STRING_FIX }));

  PATTERNS.forEach(({ feature, since, fix, re }) => {
    for (const match of stripped.matchAll(re)) {
      warnings.push({ feature, since, line: lineOf(stripped, match.index ?? 0), fix });
    }
  });

  // One warning per feature per line is enough; a loop printing ten f-strings buries the
  // one sentence that explains what to do.
  const seen = new Set<string>();
  return warnings
    .filter((w) => {
      const key = `${w.feature}:${w.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line);
};

export const describeSyntaxWarnings = (warnings: SyntaxWarning[]): string => {
  if (warnings.length === 0) return '';
  const lines = warnings.map(
    (w) => `  • บรรทัด ${w.line}: ${w.feature} (ต้องใช้ Python ${w.since}+)\n    วิธีแก้: ${w.fix}`
  );
  return (
    `⚠️  ตัวตรวจของ "ส่งคำตอบ" ใช้ Python ${JUDGE_PYTHON_VERSION} ซึ่งไม่รองรับสิ่งที่ใช้ในโค้ดนี้:\n` +
    `${lines.join('\n')}\n` +
    `   โค้ดนี้รันผ่านในช่อง "ทดสอบ" ได้ (เบราว์เซอร์ใช้ Python รุ่นใหม่กว่า) แต่จะ\n` +
    `   compile ไม่ผ่านตอนกด "ส่งคำตอบ" และจะไม่ได้คะแนน\n`
  );
};
