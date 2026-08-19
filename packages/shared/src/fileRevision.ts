export function fileContentRevision(contents: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash ^= contents.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${contents.length}:${(hash >>> 0).toString(36)}`;
}

/** Counts rendered text lines, treating CRLF as one break and one trailing break as a terminator. */
export function countTextLines(contents: string): number {
  if (contents.length === 0) return 0;

  let lineCount = 1;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents.charCodeAt(index);
    if (character === 13) {
      lineCount += 1;
      if (contents.charCodeAt(index + 1) === 10) index += 1;
    } else if (character === 10) {
      lineCount += 1;
    }
  }

  const finalCharacter = contents.charCodeAt(contents.length - 1);
  return finalCharacter === 10 || finalCharacter === 13 ? lineCount - 1 : lineCount;
}
