# Graph Report - tamagochi Tver  (2026-10-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 94 nodes · 191 edges · 12 communities (6 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- settings.json
- render_sprites.py
- check_asset.py
- with_server.py
- prepare_glb.py
- _common.py
- setup-assets.sh
- setup.sh
- armature_actions
- filter-test-output.sh
- run.sh

## God Nodes (most connected - your core abstractions)
1. `main()` - 22 edges
2. `main()` - 14 edges
3. `main()` - 11 edges
4. `world_bbox()` - 9 edges
5. `emit()` - 9 edges
6. `armature_actions()` - 9 edges
7. `script_args()` - 8 edges
8. `import_model()` - 7 edges
9. `reset_scene()` - 7 edges
10. `mesh_objects()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `anim_bbox()` --calls--> `world_bbox()`  [EXTRACTED]
  tools/blender/render_sprites.py → tools/blender/_common.py
- `main()` --calls--> `armature_actions()`  [EXTRACTED]
  tools/blender/render_sprites.py → tools/blender/_common.py
- `main()` --calls--> `emit()`  [EXTRACTED]
  tools/blender/render_sprites.py → tools/blender/_common.py
- `main()` --calls--> `import_model()`  [EXTRACTED]
  tools/blender/render_sprites.py → tools/blender/_common.py
- `main()` --calls--> `mesh_objects()`  [EXTRACTED]
  tools/blender/render_sprites.py → tools/blender/_common.py

## Import Cycles
- None detected.

## Communities (12 total, 6 thin omitted)

### Community 0 - "settings.json"
Cohesion: 0.11
Nodes (17): advisorModel, autoCompactWindow, effortLevel, enabledPlugins, andrej-karpathy-skills@karpathy-skills, claude-md-management@claude-plugins-official, code-simplifier@claude-plugins-official, frontend-design@claude-plugins-official (+9 more)

### Community 1 - "render_sprites.py"
Cohesion: 0.22
Nodes (9): assign_action(), anim_bbox(), load_pixels(), main(), pick_engine(), save_sheet(), setup_camera(), setup_light() (+1 more)

### Community 2 - "check_asset.py"
Cohesion: 0.38
Nodes (6): main(), ensure_object_mode(), import_model(), reset_scene(), script_args(), main()

### Community 4 - "prepare_glb.py"
Cohesion: 0.29
Nodes (3): world_bbox(), flatten_hierarchy(), rest_bbox()

### Community 7 - "setup-assets.sh"
Cohesion: 0.70
Nodes (4): find_blender(), need(), run(), setup-assets.sh script

### Community 8 - "setup.sh"
Cohesion: 0.83
Nodes (3): need(), run(), setup.sh script

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `main()` connect `render_sprites.py` to `check_asset.py`, `prepare_glb.py`, `_common.py`, `os`, `armature_actions`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Should `settings.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Why does `world_bbox()` connect `prepare_glb.py` to `render_sprites.py`, `check_asset.py`, `_common.py`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `main()` connect `check_asset.py` to `armature_actions`, `prepare_glb.py`, `_common.py`, `os`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._