/**
 * Line numbering for the read-only Powerhouse code surfaces. Shiki keeps a
 * trailing empty line for code that ends in a newline, so counting separators
 * matches what the highlighter renders.
 */
export function countCodeLines(code: string): number {
  let lines = 1;
  let index = code.indexOf("\n");
  while (index !== -1) {
    lines += 1;
    index = code.indexOf("\n", index + 1);
  }
  return lines;
}

/**
 * The whole gutter as one newline-joined string. A single text node keeps the
 * numbers off the layout budget for schemas that run to thousands of lines.
 */
export function lineNumberGutterText(lineCount: number): string {
  let text = "1";
  for (let line = 2; line <= lineCount; line += 1) text += `\n${line}`;
  return text;
}
