"""Готовит модель для игры и экспортирует в GLB:
масштаб под нужную высоту, точка опоры внизу по центру в (0,0,0), применённые трансформации,
анимации сохраняются (сдвиги костей пересчитываются под новый масштаб).

CLI (рекомендуемый способ, открытая сцена не трогается):
  bash tools/blender/run.sh prepare_glb.py raw/hero.fbx --out assets/models/hero.glb --height 1.8
  bash tools/blender/run.sh prepare_glb.py work/hero.blend --out assets/models/hero.glb
Через MCP (меняет открытую сцену, сначала сохрани .blend):
  import runpy, sys; sys.argv = ["blender", "--", "--out", "/abs/assets/models/hero.glb", "--height", "1.8"]
  runpy.run_path("/abs/path/tools/blender/prepare_glb.py", run_name="__main__")
"""
import argparse
import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (script_args, emit, reset_scene, import_model, ensure_object_mode,  # noqa: E402
                     mesh_objects, world_bbox, action_fcurves, armature_actions, PROCEDURAL)


def rest_bbox(meshes):
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    saved = [(o, o.data.pose_position) for o in arms]
    for o, _ in saved:
        o.data.pose_position = "REST"
    bpy.context.view_layer.update()
    box = world_bbox(meshes)
    for o, pos in saved:
        o.data.pose_position = pos
    bpy.context.view_layer.update()
    return box


def flatten_hierarchy():
    """Убирает пустышки-родители (их часто создают импортёры), сохраняя положение объектов."""
    scene = bpy.context.scene
    for o in scene.objects:
        if o.type in ("MESH", "ARMATURE") and o.parent and o.parent.type != "ARMATURE":
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    for o in list(scene.objects):
        if o.type == "EMPTY" and not o.children:
            bpy.data.objects.remove(o, do_unlink=True)


def main():
    p = argparse.ArgumentParser(prog="prepare_glb")
    p.add_argument("model", nargs="?", help="GLB/FBX/OBJ/BLEND. Без него берётся текущая сцена")
    p.add_argument("--out", required=True, help="куда сохранить .glb")
    p.add_argument("--height", type=float, help="высота модели в метрах после масштабирования")
    p.add_argument("--fix-normals", action="store_true", help="развернуть нормали наружу (не для открытых мешей)")
    p.add_argument("--merge", type=float, default=0, help="склеить вершины ближе N метров (не для импортированных GLB)")
    p.add_argument("--max-texture", type=int, default=0, help="уменьшить текстуры больше N пикселей")
    p.add_argument("--no-animations", action="store_true")
    a = p.parse_args(script_args())

    if a.model:
        if not a.model.lower().endswith(".blend"):
            reset_scene()
        import_model(a.model)
    ensure_object_mode()
    flatten_hierarchy()

    meshes = mesh_objects()
    if not meshes:
        raise SystemExit("В сцене нет мешей")
    roots = [o for o in bpy.context.scene.objects if o.parent is None and o.type in ("MESH", "ARMATURE")]

    # 1. Масштаб под нужную высоту
    lo, hi = rest_bbox(meshes)
    factor = 1.0
    if a.height:
        factor = a.height / max(hi[2] - lo[2], 1e-9)
        for o in roots:
            o.location *= factor
            o.scale *= factor
        bpy.context.view_layer.update()
        lo, hi = rest_bbox(meshes)

    # 2. Точка опоры: низ по центру в (0,0,0)
    offset = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2])
    for o in roots:
        o.location.x -= offset[0]
        o.location.y -= offset[1]
        o.location.z -= offset[2]
    bpy.context.view_layer.update()

    # 3. Применяем трансформации; сдвиги костей в анимациях масштабируем вручную,
    #    иначе после применения масштаба арматуры анимация «разлетается»
    arm_scale = {}
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            s = o.matrix_world.to_scale()
            arm_scale[o.name] = (s.x + s.y + s.z) / 3
    bpy.ops.object.select_all(action="DESELECT")
    targets = [o for o in bpy.context.scene.objects if o.type in ("MESH", "ARMATURE")]
    for o in targets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    scaled_actions = set()
    for name, s in arm_scale.items():
        if abs(s - 1) < 1e-6:
            continue
        arm = bpy.data.objects[name]
        for act in armature_actions(arm):
            if act.name in scaled_actions:
                continue
            scaled_actions.add(act.name)
            for fc in action_fcurves(act):
                if fc.data_path.endswith(".location"):
                    for kp in fc.keyframe_points:
                        kp.co.y *= s
                        kp.handle_left.y *= s
                        kp.handle_right.y *= s
                    fc.update()

    # 4. Геометрия (по желанию)
    if a.fix_normals or a.merge:
        for o in meshes:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            if a.merge:
                bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=a.merge)
            if a.fix_normals:
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(o.data)
            bm.free()
            o.data.update()

    # 5. Текстуры
    resized = []
    if a.max_texture:
        for img in bpy.data.images:
            w, h = img.size
            if max(w, h) > a.max_texture:
                k = a.max_texture / max(w, h)
                img.scale(max(1, int(w * k)), max(1, int(h * k)))
                resized.append(f"{img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}")

    # 6. Что экспортёр glTF молча потеряет
    warnings = []
    for m in bpy.data.materials:
        if m.users and m.node_tree:
            proc = sorted({n.bl_idname for n in m.node_tree.nodes if n.bl_idname in PROCEDURAL})
            if proc:
                warnings.append(f"Материал {m.name}: {proc} НЕ попадут в GLB. Запеки в текстуру (Bake) и экспортируй снова")

    # 7. Экспорт
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_animations=not a.no_animations,
    )

    lo, hi = rest_bbox(mesh_objects())
    emit({
        "out": out,
        "size_kb": round(os.path.getsize(out) / 1024, 1),
        "scale_factor": round(factor, 5),
        "size_m": [round(hi[i] - lo[i], 3) for i in range(3)],
        "actions": sorted({act.name for o in bpy.context.scene.objects if o.type == "ARMATURE"
                           for act in armature_actions(o)}),
        "resized_textures": resized,
        "warnings": warnings,
        "next": "проверь результат: run.sh check_asset.py " + out,
    })


main()
