"""Проверка 3D-ассета. Печатает короткий JSON: размеры, полигоны, ошибки.
Ничего не меняет в сцене.

CLI (сцена не трогается, рекомендуемый способ):
  bash tools/blender/run.sh check_asset.py assets/models/hero.glb --height 1.8
Через MCP (проверяет открытую сцену):
  import runpy, sys; sys.argv = ["blender", "--", "--height", "1.8"]
  runpy.run_path("/abs/path/tools/blender/check_asset.py", run_name="__main__")
"""
import argparse
import os
import sys

import bpy
import bmesh  # после bpy: в модуле bpy bmesh доступен только так

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (script_args, emit, reset_scene, import_model, ensure_object_mode,  # noqa: E402
                     mesh_objects, world_bbox, armature_actions, PROCEDURAL)



def main():
    p = argparse.ArgumentParser(prog="check_asset")
    p.add_argument("model", nargs="?", help="GLB/FBX/OBJ/BLEND. Без него проверяется текущая сцена")
    p.add_argument("--height", type=float, help="ожидаемая высота в метрах (персонаж ~1.7-1.8)")
    p.add_argument("--max-tris", type=int, default=20000)
    p.add_argument("--max-texture", type=int, default=2048)
    a = p.parse_args(script_args())

    if a.model:
        if not a.model.lower().endswith(".blend"):
            reset_scene()
        import_model(a.model)
    ensure_object_mode()

    problems, notes = [], []
    meshes = mesh_objects()
    if not meshes:
        emit({"status": "FAIL", "problems": ["В сцене нет мешей"]})
        return

    # Размеры в позе покоя (rest), без анимации
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    saved = [(o, o.data.pose_position) for o in arms]
    for o, _ in saved:
        o.data.pose_position = "REST"
    bpy.context.view_layer.update()
    lo, hi = world_bbox(meshes)
    for o, pos in saved:
        o.data.pose_position = pos
    bpy.context.view_layer.update()
    size = [round(hi[i] - lo[i], 3) for i in range(3)]
    center = [round((hi[i] + lo[i]) / 2, 3) for i in range(2)]

    if a.height:
        ratio = size[2] / a.height if a.height else 0
        if not 0.9 <= ratio <= 1.1:
            problems.append(f"Высота {size[2]} м, ожидалось {a.height} м (x{ratio:.2f}). Масштаб: prepare_glb.py --height")
    elif size[2] > 50 or max(size) < 0.05:
        problems.append(f"Подозрительный масштаб: {size} м. 1 единица Blender = 1 метр")

    longest = max(size)
    if abs(lo[2]) > 0.02 * max(longest, 0.01):
        problems.append(f"Низ модели на z={lo[2]:.3f}, а должен быть на 0 (стоит на полу)")
    if max(abs(center[0]), abs(center[1])) > 0.05 * max(longest, 0.01):
        problems.append(f"Модель не по центру: x,y = {center}. Точка опоры должна быть в (0,0,0)")

    # Трансформации
    for o in bpy.context.scene.objects:
        if o.type not in ("MESH", "ARMATURE"):
            continue
        s = o.scale
        if max(abs(s.x - 1), abs(s.y - 1), abs(s.z - 1)) > 1e-4:
            problems.append(f"{o.name}: не применён масштаб {tuple(round(v, 4) for v in s)}")
        if o.parent is None and max(abs(v) for v in o.rotation_euler) > 1e-4 and o.rotation_mode != "QUATERNION":
            problems.append(f"{o.name}: не применён поворот")
        if o.type == "MESH":
            mods = [m.type for m in o.modifiers if m.type != "ARMATURE"]
            if mods:
                notes.append(f"{o.name}: модификаторы {mods} (применятся при экспорте, проверь результат)")

    # Геометрия
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    ngons = flipped = open_edges = loose = doubles = 0
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()

        bm = bmesh.new()
        bm.from_mesh(o.data)
        ngons += sum(1 for f in bm.faces if len(f.verts) > 4)
        flipped += sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
        open_edges += sum(1 for e in bm.edges if e.is_boundary)
        loose += sum(1 for v in bm.verts if not v.link_edges)
        d = bmesh.ops.find_doubles(bm, verts=bm.verts, dist=1e-5)
        doubles += len(d["targetmap"])
        bm.free()

        if not o.data.uv_layers:
            problems.append(f"{o.name}: нет UV-развёртки, текстуры не лягут")
        if not any(o.material_slots) or not any(s.material for s in o.material_slots):
            problems.append(f"{o.name}: нет материала")

    if tris > a.max_tris:
        problems.append(f"Треугольников {tris}, бюджет {a.max_tris}. Упростить (Decimate) или поднять бюджет")
    if flipped:
        problems.append(f"Перевёрнутые нормали: {flipped} рёбер с несогласованными гранями (Shift+N)")
    if doubles:
        notes.append(f"Дубли вершин: {doubles}. У импортированных GLB/FBX это норма (швы UV, жёсткие рёбра), Merge by Distance их сломает. В своей модели — склеить")
    if loose:
        notes.append(f"Висящие вершины без рёбер: {loose}")
    if open_edges:
        notes.append(f"Открытые края: {open_edges} рёбер. У импортированных моделей часто из-за дублей вершин; для игр обычно не страшно, если нет видимых дыр")
    if ngons:
        notes.append(f"N-гоны: {ngons} (экспортёр триангулирует сам, проверь артефакты)")

    # Материалы и текстуры
    seen = set()
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            if not m or m.name in seen:
                continue
            seen.add(m.name)
            if not m.node_tree:
                continue
            proc = sorted({n.bl_idname for n in m.node_tree.nodes if n.bl_idname in PROCEDURAL})
            if proc:
                problems.append(f"Материал {m.name}: процедурные текстуры {proc} не экспортируются в glTF, нужно запечь в картинку")
            for n in m.node_tree.nodes:
                if n.bl_idname == "ShaderNodeTexImage" and n.image:
                    img = n.image
                    w, h = img.size
                    if max(w, h) > a.max_texture:
                        problems.append(f"Текстура {img.name}: {w}x{h}, лимит {a.max_texture}")
                    if w and (w & (w - 1) or h & (h - 1)):
                        notes.append(f"Текстура {img.name}: {w}x{h} не степень двойки")
                    if not img.packed_file and img.source == "FILE" and not os.path.exists(bpy.path.abspath(img.filepath)):
                        problems.append(f"Текстура {img.name}: файл не найден ({img.filepath})")

    # Риг и анимации
    rig = []
    for arm in [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]:
        acts = armature_actions(arm)
        rig.append({
            "armature": arm.name,
            "bones": len(arm.data.bones),
            "actions": {act.name: [round(act.frame_range[0]), round(act.frame_range[1])] for act in acts},
        })
        if not acts:
            notes.append(f"{arm.name}: риг есть, анимаций нет")
    skinned = [o for o in meshes if any(m.type == "ARMATURE" for m in o.modifiers)]
    for o in skinned:
        if o.parent is None or o.parent.type != "ARMATURE":
            notes.append(f"{o.name}: деформируется арматурой, но не её дочерний объект")

    emit({
        "status": "OK" if not problems else "FAIL",
        "size_m": {"x": size[0], "y": size[1], "z": size[2]},
        "bottom_z": round(lo[2], 4),
        "center_xy": center,
        "tris": tris,
        "meshes": len(meshes),
        "materials": len(seen),
        "rig": rig,
        "problems": problems,
        "notes": notes,
    })


main()
