Check memory system health. $ARGUMENTS

If arguments include "maintain", run the full consolidation cycle by calling `engram-maintain`. Report what changed.

Otherwise show a health overview:
1. Call `engram-stats` for tier/layer/type breakdown
2. Call `engram-rules` for active procedural rule count
3. Call `engram-kg-stats` for knowledge graph size
4. Present a clean summary:
   - Total memories by tier (daily / short-term / long-term / archive)
   - Cognitive layer breakdown (episodic / semantic / procedural)
   - Active procedural rules count
   - Knowledge graph: entities, triples, active vs invalidated
   - Any warnings (high archive count suggests stale data, low procedural rules means the system hasn't learned much yet)
