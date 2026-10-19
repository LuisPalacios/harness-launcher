import { describe, expect, test } from "bun:test";
import { ArgsParseError, parseArgs } from "../../src/args";

describe("parseArgs", () => {
  test.each([
    ["", []],
    ["   ", []],
    ["--resume", ["--resume"]],
    ["  --resume   latest  ", ["--resume", "latest"]],
    ['--model "gpt x"', ["--model", "gpt x"]],
    ["--name 'a b'", ["--name", "a b"]],
    ['--name="a b"', ["--name=a b"]],
    ['""', [""]],
    ["''", [""]],
    ['a "" b', ["a", "", "b"]],
    ['"say \\"hi\\""', ['say "hi"']],
    ["'no \\escape'", ["no \\escape"]],
    ["it\\'s", ["it's"]],
    ["C:\\tools\\x.exe --flag", ["C:\\tools\\x.exe", "--flag"]],
    ['"C:\\Program Files\\x"', ["C:\\Program Files\\x"]],
    ['"trailing\\\\"', ["trailing\\"]],
    ["a\tb\nc", ["a", "b", "c"]],
    ["'mixed'\"quotes\"done", ["mixedquotesdone"]],
  ] as const)("%j", (input, expected) => {
    expect(parseArgs(input)).toEqual([...expected]);
  });

  test.each(['"open', "'open", 'a "b \\"'])("rejects unterminated quote in %j", (input) => {
    expect(() => parseArgs(input)).toThrow(ArgsParseError);
  });
});
