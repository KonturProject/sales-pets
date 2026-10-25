"""Рендер 3D-модели в спрайт-листы: N направлений x M кадров на каждую анимацию.
Одна и та же камера, масштаб и свет для всех кадров, поэтому персонаж не «прыгает» между кадрами.
Только CLI: скрипт строит свою сцену и не должен трогать открытую в Blender работу.

  bash tools/blender/run.sh render_sprites.py assets/models/hero.glb --out assets/sprites/hero
  ... --directions 8 --frames 8 --size 128 --elevation 30 --anims Walk,Idle --pixel

Результат: <out>/<anim>.png (строки = направления, столбцы = кадры), <out>/sheet.json, <out>/preview.png
"""
import argparse
import json
import math
import os
import shutil
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (script_args, emit, reset_scene, import_model, mesh_objects,  # noqa: E402
                     world_bbox, assign_action, armature_actions)

DIR_NAMES = {
    8: ["S", "SW", "W", "NW", "N", "NE", "E", "SE"],
    4: ["S", "W", "N", "E"],
    1: ["S"],
}


def pick_engine(name):
    items = {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    want = {
        "eevee": ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"],
        "workbench": ["BLENDER_WORKBENCH"],
        "cycles": ["CYCLES"],
    }[name]
    for w in want:
        if w in items:
            return w
    return "BLENDER_WORKBENCH"


def setup_render(scene, a, engine):
    scene.render.engine = engine
    scene.render.resolution_x = a.size
    scene.render.resolution_y = a.size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # Standard, а не AgX/Filmic: иначе цвета текстур тускнеют
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    if a.pixel:
        scene.render.filter_size = 0.0
    if engine == "CYCLES":
        scene.cycles.samples = 32
        scene.cycles.device = "GPU" if a.gpu else "CPU"
    if engine == "BLENDER_WORKBENCH":
        shading = scene.display.shading
        shading.light = "STUDIO"
        shading.color_type = "TEXTURE"


def setup_light(scene):
    world = bpy.data.worlds.new("SpriteWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (1, 1, 1, 1)
        bg.inputs[1].default_value = 0.6
    scene.world = world
    sun = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)


def setup_camera(scene, lo, hi, a):
    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    el = math.radians(a.elevation)
    center = Vector((0, 0, (lo[2] + hi[2]) / 2))
    radius = max(hi[i] - lo[i] for i in range(3)) * 2 + 1
    direction = Vector((0, -math.cos(el), math.sin(el)))
    cam.location = center + direction * radius
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    # Кадр должен вмещать модель при любом повороте: берём диагональ по XY
    horiz = math.hypot(max(abs(lo[0]), abs(hi[0])), max(abs(lo[1]), abs(hi[1]))) * 2
    vert = (hi[2] - lo[2]) * math.cos(el) + horiz * math.sin(el)
    cam_data.ortho_scale = max(horiz, vert) * a.margin
    cam_data.clip_end = radius * 4
    return cam


def anim_bbox(meshes, arm, actions, samples=6):
    """Габариты с учётом всех анимаций, чтобы размер кадра был одинаковым."""
    lo, hi = world_bbox(meshes)
    for act in actions:
        assign_action(arm, act)
        start, end = act.frame_range
        for k in range(samples):
            bpy.context.scene.frame_set(int(round(start + (end - start) * k / samples)))
            l2, h2 = world_bbox(meshes)
            lo = [min(lo[i], l2[i]) for i in range(3)]
            hi = [max(hi[i], h2[i]) for i in range(3)]
    return lo, hi


def load_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)  # строки снизу вверх, как в Blender


def save_sheet(grid, path, alpha_threshold):
    """grid[row][col] -> массивы кадров. Ряд 0 будет верхним в итоговом PNG."""
    rows, cols = len(grid), len(grid[0])
    fh, fw = grid[0][0].shape[:2]
    sheet = np.zeros((rows * fh, cols * fw, 4), dtype=np.float32)
    for r in range(rows):
        y = (rows - 1 - r) * fh
        for c in range(cols):
            sheet[y:y + fh, c * fw:(c + 1) * fw] = grid[r][c]
    if alpha_threshold:
        mask = sheet[..., 3] >= alpha_threshold
        sheet[..., 3] = mask.astype(np.float32)
        sheet[~mask] = 0
    img = bpy.data.images.new(os.path.basename(path), cols * fw, rows * fh, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def main():
    p = argparse.ArgumentParser(prog="render_sprites")
    p.add_argument("model", help="GLB/FBX/OBJ/BLEND")
    p.add_argument("--out", required=True, help="папка для спрайт-листов")
    p.add_argument("--directions", type=int, default=8, choices=[1, 4, 8])
    p.add_argument("--frames", type=int, default=8, help="кадров на анимацию")
    p.add_argument("--size", type=int, default=128, help="размер кадра в пикселях")
    p.add_argument("--elevation", type=float, default=30, help="угол камеры: 0 сбоку, 30 изометрия, 90 сверху")
    p.add_argument("--anims", default="all", help="all, none или список через запятую")
    p.add_argument("--engine", default="eevee", choices=["eevee", "workbench", "cycles"])
    p.add_argument("--gpu", action="store_true", help="Cycles на видеокарте")
    p.add_argument("--margin", type=float, default=1.1, help="запас по краям кадра")
    p.add_argument("--pixel", action="store_true", help="пиксель-арт: без сглаживания, жёсткая альфа")
    p.add_argument("--rotate", type=float, default=0, help="доп. поворот модели, если она смотрит не в камеру")
    a = p.parse_args(script_args())

    if bpy.app.background is False:
        raise SystemExit("Запускай через CLI (run.sh), а не через MCP: скрипт перестраивает сцену")

    reset_scene() if not a.model.lower().endswith(".blend") else None
    import_model(a.model)
    scene = bpy.context.scene
    meshes = mesh_objects()
    if not meshes:
        raise SystemExit("В модели нет мешей")

    # Все корневые объекты вешаем на пустышку, её и вращаем
    pivot = bpy.data.objects.new("SpritePivot", None)
    scene.collection.objects.link(pivot)
    for o in list(scene.objects):
        if o.parent is None and o is not pivot:
            mw = o.matrix_world.copy()
            o.parent = pivot
            o.matrix_world = mw
    pivot.rotation_euler.z = math.radians(a.rotate)
    bpy.context.view_layer.update()

    arms = [o for o in scene.objects if o.type == "ARMATURE"]
    arm = arms[0] if arms else None
    actions = armature_actions(arm) if arm else []
    if a.anims == "none":
        actions = []
    elif a.anims != "all":
        wanted = [s.strip() for s in a.anims.split(",")]
        missing = [w for w in wanted if w not in bpy.data.actions]
        if missing:
            raise SystemExit(f"Нет анимаций {missing}. Есть: {[x.name for x in actions]}")
        actions = [bpy.data.actions[w] for w in wanted]

    lo, hi = anim_bbox(meshes, arm, actions) if actions else world_bbox(meshes)
    engine = pick_engine(a.engine)
    setup_render(scene, a, engine)
    setup_light(scene)
    setup_camera(scene, lo, hi, a)

    dirs = DIR_NAMES[a.directions]
    step = -360 / a.directions  # S -> SW -> W ...: модель, смотрящая на камеру, поворачивается по часовой
    tmp = tempfile.mkdtemp(prefix="sprites_")
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    fps = scene.render.fps
    sheet = {"frameWidth": a.size, "frameHeight": a.size, "directions": dirs,
             "elevation": a.elevation, "engine": engine, "animations": {}}

    jobs = [(act.name, act) for act in actions] or [("static", None)]
    try:
        for name, act in jobs:
            if act:
                assign_action(arm, act)
                start, end = act.frame_range
                n = a.frames
                frames = [start + (end - start) * k / n for k in range(n)]  # без последнего: цикл не дублирует кадр
            else:
                frames = [scene.frame_current]
            grid = []
            for d in range(a.directions):
                pivot.rotation_euler.z = math.radians(a.rotate + step * d)
                row = []
                for i, f in enumerate(frames):
                    scene.frame_set(int(f), subframe=f - int(f))
                    path = os.path.join(tmp, f"{name}_{d}_{i}.png")
                    scene.render.filepath = path
                    bpy.ops.render.render(write_still=True)
                    row.append(load_pixels(path))
                grid.append(row)
            fname = f"{name}.png"
            save_sheet(grid, os.path.join(out, fname), 0.5 if a.pixel else 0)
            cycle_sec = (act.frame_range[1] - act.frame_range[0]) / fps if act else 0
            sheet["animations"][name] = {
                "file": fname,
                "frames": len(frames),
                # с этой скоростью цикл длится столько же, сколько в исходной анимации
                "fps": round(len(frames) / cycle_sec, 2) if cycle_sec else 0,
            }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Превью: первый кадр каждой анимации во всех направлениях, одна картинка для проверки глазами
    first = []
    for name in sheet["animations"]:
        img = load_pixels(os.path.join(out, sheet["animations"][name]["file"]))
        fw = a.size
        first.append([img[(len(dirs) - 1 - r) * fw:(len(dirs) - r) * fw, 0:fw] for r in range(len(dirs))])
    save_sheet(first, os.path.join(out, "preview.png"), 0)

    with open(os.path.join(out, "sheet.json"), "w", encoding="utf-8") as fh:
        json.dump(sheet, fh, ensure_ascii=False, indent=1)

    emit({
        "out": out,
        "engine": engine,
        "frame": f"{a.size}x{a.size}",
        "directions": dirs,
        "animations": {k: v["frames"] for k, v in sheet["animations"].items()},
        "preview": os.path.join(out, "preview.png"),
        "next": "посмотри только preview.png (одна картинка), а не каждый кадр",
    })


main()
