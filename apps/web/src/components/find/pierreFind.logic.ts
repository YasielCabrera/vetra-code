/** Source lines as Pierre numbers them: `\r\n`, `\r`, and `\n` each end a line. */
export function fileFindLines(contents: string): string[] {
  return contents.split(/\r\n|\r|\n/);
}
