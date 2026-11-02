# Нарезка листов «Рост» из ChatGPT на картинки стадий: python tools/slice-pets.py
# Берёт assets/_raw/<группа>-rost.png (5 стадий в ряд, прозрачный фон), пишет public/assets/pets/<группа>-<1..5>.png
# и превью work/pets-preview.png. Каждая стадия обрезана по себе, ноги на нижнем краю; рост задаёт игра (petScale).
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets/_raw'
OUT = ROOT / 'public/assets/pets'
PREVIEW = ROOT / 'work/pets-preview.png'
GROUPS = ['sr1', 'sr2', 'sr3', 'sr5', 'sr6', 'sr9']
STAGES = 5
# питомец на экране не выше ~190 px (PET_SIZE × камера); берём с запасом ×2 под чёткость
MAX_SIDE = 384
SOLID = 40   # пиксели плотнее этого — тело фигуры
FAINT = 8    # прозрачнее этого — фон (у ChatGPT там остаётся мусор в RGB)
OPAQUE = 250  # плотнее этого — заливка и контур фигуры
PAD = 2


def slice_sheet(path: Path) -> list[Image.Image]:
    rgba = np.array(Image.open(path).convert('RGBA'))
    alpha = rgba[..., 3]
    rgba[alpha < FAINT] = 0
    labels, n = ndimage.label(alpha >= SOLID)
    sizes = ndimage.sum(np.ones_like(alpha), labels, range(1, n + 1))
    boxes = ndimage.find_objects(labels)
    # фигуры — крупные куски; остальное (искры, пятнышки) отдаём фигуре, в чью полосу по x попал центр куска
    big = [i + 1 for i, s in enumerate(sizes) if s >= 0.15 * sizes.max()]
    if len(big) != STAGES:
        sys.exit(f'{path.name}: найдено фигур {len(big)}, ждали {STAGES} — лист не по сетке?')
    big.sort(key=lambda i: boxes[i - 1][1].start)
    heights = [boxes[i - 1][0].stop - boxes[i - 1][0].start for i in big]
    if heights != sorted(heights):
        sys.exit(f'{path.name}: высоты фигур слева направо {heights} не растут — стадии не по порядку?')
    owner = np.zeros_like(labels)
    for stage, i in enumerate(big, 1):
        owner[labels == i] = stage
    bands = [(boxes[i - 1][1].start, boxes[i - 1][1].stop) for i in big]
    for i in set(range(1, n + 1)) - set(big):
        cx = (boxes[i - 1][1].start + boxes[i - 1][1].stop) / 2
        owner[labels == i] = 1 + int(np.argmin([max(a - cx, 0, cx - b) for a, b in bands]))
    # полупрозрачные края отдаём ближайшему уже распределённому пикселю
    _, (iy, ix) = ndimage.distance_transform_edt(owner == 0, return_indices=True)
    owner = np.where(alpha >= FAINT, owner[iy, ix], 0)
    # светлая кайма от вырезанного белого фона: полупрозрачный край у контура берёт цвет ближайшего плотного пикселя
    # (дальше 2 px — сияние вокруг предмета, его не трогаем)
    dist, (iy, ix) = ndimage.distance_transform_edt(alpha < OPAQUE, return_indices=True)
    rim = (alpha >= FAINT) & (alpha < OPAQUE) & (dist <= 2)
    rgba[rim, :3] = rgba[iy[rim], ix[rim], :3]
    # непрозрачная белая обводка «наклейкой» (бывает у ChatGPT): светлый внешний пиксель контура красим цветом
    # фигуры чуть глубже; тонкие светлые детали (меч, искры) без глубины рядом не трогаем
    solid = alpha >= OPAQUE
    lum = rgba[..., :3].astype(float) @ [0.299, 0.587, 0.114]
    dist, (iy, ix) = ndimage.distance_transform_edt(~ndimage.binary_erosion(solid, iterations=3), return_indices=True)
    stroke = solid & ~ndimage.binary_erosion(solid, iterations=2) & (lum > 200) & (dist <= 4)
    rgba[stroke, :3] = rgba[iy[stroke], ix[stroke], :3]
    stages = []
    for stage in range(1, STAGES + 1):
        mask = owner == stage
        ys, xs = np.nonzero(mask)
        part = np.where(mask[..., None], rgba, 0).astype(np.uint8)
        part = part[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        img = Image.fromarray(part, 'RGBA')
        k = min(1, MAX_SIDE / max(img.size))  # мелкие фигуры не растягиваем: впишет object-fit
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        canvas = Image.new('RGBA', (img.width + 2 * PAD, img.height + PAD), (0, 0, 0, 0))
        canvas.paste(img, (PAD, PAD))  # снизу без отступа: ноги на нижнем крае
        stages.append(canvas)
    return stages


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for g in GROUPS:
        stages = slice_sheet(RAW / f'{g}-rost.png')
        for n, img in enumerate(stages, 1):
            img.save(OUT / f'{g}-{n}.png', optimize=True)
        rows.append(stages)
        print(g, ' '.join(f'{im.width}x{im.height}' for im in stages))
    # превью: шесть рядов по пять стадий на клетчатом фоне, рост как в игре (petScale)
    cell = 200
    sheet = Image.new('RGBA', (cell * STAGES, cell * len(rows)), (255, 255, 255, 255))
    for y in range(0, sheet.height, 20):
        for x in range(0, sheet.width, 20):
            if (x // 20 + y // 20) % 2:
                sheet.paste((225, 225, 225, 255), (x, y, x + 20, y + 20))
    for r, stages in enumerate(rows):
        for c, img in enumerate(stages):
            h = round((cell - 10) * (0.55 + 0.45 * c / (STAGES - 1)))
            im = img.resize((max(1, round(img.width * h / img.height)), h), Image.LANCZOS)
            sheet.alpha_composite(im, (c * cell + (cell - im.width) // 2, (r + 1) * cell - im.height - 4))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert('RGB').save(PREVIEW)
    print(f'превью: {PREVIEW.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
