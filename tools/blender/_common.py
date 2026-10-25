"""Общие функции для скриптов asset-kit. Работает в Blender 4.2+ и 5.x."""
import bpy
import sys
import json
import os

RESULT_MARK = "=== RESULT ==="

# Процедурные текстуры Blender: в glTF не экспортируются, их надо запекать
PROCEDURAL = {
    "ShaderNodeTexNoise", "ShaderNodeTexVoronoi", "ShaderNodeTexWave", "ShaderNodeTexMagic",
    "ShaderNodeTexGradient", "ShaderNodeTexBrick", "ShaderNodeTexChecker", "ShaderNodeTexMusgrave",
    "ShaderNodeTexWhiteNoise", "ShaderNodeTexGabor",
}


def script_args():
    """Аргументы после `--`. Из CLI: blender -b -P script.py -- args.
    Через MCP: sys.argv = ["blender", "--", *args]; runpy.run_path(script, run_name="__main__")."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def emit(data):
    """Печатает короткий JSON-итог. run.sh показывает только то, что после метки."""
    print(RESULT_MARK)
    print(json.dumps(data, ensure_ascii=False, indent=1))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(path):
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise SystemExit(f"Файл не найден: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        raise SystemExit(f"Неизвестный формат: {ext}")


def ensure_object_mode():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]


def world_bbox(objs, evaluated=True):
    """Габариты всех мешей в мировых координатах (с учётом позы арматуры, если evaluated)."""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for o in objs:
        src = o.evaluated_get(dg) if evaluated else o
        me = src.to_mesh()
        mw = o.matrix_world
        for v in me.vertices:
            p = mw @ v.co
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
        src.to_mesh_clear()
    if lo[0] == float("inf"):
        return None
    return lo, hi


def action_fcurves(act):
    """F-кривые экшена: слоистые экшены Blender 4.4+ и старый API."""
    layers = getattr(act, "layers", None)
    if layers:
        for layer in layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    yield from bag.fcurves
    elif hasattr(act, "fcurves"):
        yield from act.fcurves


def assign_action(obj, act):
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = act
    # Blender 4.4+: у экшена есть слоты, без слота анимация не играет
    if hasattr(obj.animation_data, "action_slot") and obj.animation_data.action_slot is None:
        slots = [s for s in getattr(act, "slots", []) if s.target_id_type == "OBJECT"]
        if slots:
            obj.animation_data.action_slot = slots[0]


def armature_actions(arm):
    """Экшены, которые относятся к арматуре (анимируют её кости)."""
    bone_names = {b.name for b in arm.data.bones}
    result = []
    for act in bpy.data.actions:
        for fc in action_fcurves(act):
            if fc.data_path.startswith('pose.bones["'):
                name = fc.data_path.split('"')[1]
                if name in bone_names:
                    result.append(act)
                    break
    return result


def root_objects():
    return [o for o in bpy.context.scene.objects if o.parent is None]
