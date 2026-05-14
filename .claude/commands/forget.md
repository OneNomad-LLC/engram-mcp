Remove or correct memories about: $ARGUMENTS

1. Search for memories matching what the user wants removed using `engram-search`
2. Show the user what was found and confirm before taking action
3. For corrections: use `engram-outcome` with type "corrected" on the wrong memory, then `engram-ingest` the corrected version
4. For deletions: use `engram-outcome` with type "irrelevant" to heavily demote the memory. Mark it multiple times if needed to push it toward archival.
5. For knowledge graph facts that are wrong: use `engram-kg-invalidate` to mark the fact as no longer valid, then `engram-kg-add` the correct fact if applicable
6. For procedural rules that are wrong: note the contradiction so the rule's confidence drops

Always confirm with the user before acting. Show them exactly which memories you found so they can pick which ones to remove or correct. Don't delete blindly.
