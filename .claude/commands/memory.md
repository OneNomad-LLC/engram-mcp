Quick memory operation: $ARGUMENTS

Parse the subcommand from the arguments:

- `save <content>` - Call `engram-check-duplicate` first. If no duplicate, call `engram-ingest` with the content.
- `diary [date]` - Call `engram-diary-read` with the date (or today). Present entries chronologically.
- `diary write <entry>` - Call `engram-diary-write` with the entry content.
- `import <source>` - Ask for file path and format (Claude Code JSONL, ChatGPT JSON, or plain text). Call `engram-import`.
- `rules` - Call `engram-rules`. Show active procedural rules with confidence scores and domains.
- `session [show|clear]` - Call `engram-session` with show or clear.

If no subcommand is given, show this list of available subcommands.
