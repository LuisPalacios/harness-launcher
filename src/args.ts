// Parses an arguments setting (one string) into argv. The result is passed to
// the shell as separate, quoted arguments, never as a raw command line.
//
// Rules:
// - Whitespace separates arguments; an empty or blank string gives no arguments.
// - "double quotes" group text; inside them, \" is a quote and \\ a backslash.
// - 'single quotes' group text literally, with no escapes.
// - Outside quotes, a backslash escapes only a following quote or backslash, so
//   Windows paths such as C:\tools\x stay intact.
// - Adjacent pieces join: --name="a b" gives `--name=a b`; "" gives an empty argument.

export class ArgsParseError extends Error {
  override name = "ArgsParseError";
}

export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inArg = false;
  let i = 0;

  while (i < input.length) {
    const ch = input.charAt(i);

    if (/\s/.test(ch)) {
      if (inArg) {
        args.push(current);
        current = "";
        inArg = false;
      }
      i++;
      continue;
    }

    inArg = true;

    if (ch === '"') {
      const close = scanDoubleQuoted(input, i + 1);
      current += close.text;
      i = close.end + 1;
      continue;
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) {
        throw new ArgsParseError(`unterminated single quote at position ${i + 1}`);
      }
      current += input.slice(i + 1, end);
      i = end + 1;
      continue;
    }

    if (ch === "\\" && isEscapable(input.charAt(i + 1))) {
      current += input.charAt(i + 1);
      i += 2;
      continue;
    }

    current += ch;
    i++;
  }

  if (inArg) {
    args.push(current);
  }
  return args;
}

function isEscapable(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === "\\";
}

function scanDoubleQuoted(input: string, start: number): { text: string; end: number } {
  let text = "";
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '"') {
      return { text, end: i };
    }
    const next = input.charAt(i + 1);
    if (ch === "\\" && (next === '"' || next === "\\")) {
      text += next;
      i += 2;
      continue;
    }
    text += ch;
    i++;
  }
  throw new ArgsParseError(`unterminated double quote at position ${start}`);
}
