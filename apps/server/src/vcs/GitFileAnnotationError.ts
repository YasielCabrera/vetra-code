export class GitFileAnnotationParseError extends Error {
  readonly _tag = "GitFileAnnotationParseError";
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.detail = detail;
    this.name = "GitFileAnnotationParseError";
  }
}
