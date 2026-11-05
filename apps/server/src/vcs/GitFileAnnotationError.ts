import * as Schema from "effect/Schema";

export class GitFileAnnotationParseError extends Schema.TaggedError<GitFileAnnotationParseError>()(
  "GitFileAnnotationParseError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
