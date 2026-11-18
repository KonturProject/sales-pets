# Нарезка листа предметов по сетке: python tools/slice-sheet.py <лист> <cols> <rows> <имена через запятую> <папка>
# Каждая клетка обрезается по прозрачности и уменьшается до MAX_SIDE по большей стороне; имя «-» — пустая клетка.
# Фигура, задевшая край клетки, — ошибка: лист не по сетке, его перегенерировать.
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAX_SIDE = 256
FAINT = 8   # прозрачнее этого — фон (у генератора там остаётся мусор в RGB)
SOLID = 40  # плотнее этого — тело фигуры
EDGE = 2    # полоса у края клетки, где фигуры быть не должно


def main() -> None:
    if len(sys.argv) != 6:
        sys.exit(__doc__ or 'usage: slice-sheet.py <лист> <cols> <rows> <имена> <папка>')
    sheet, cols, rows, names, out = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4].split(','), Path(sys.argv[5])
    if len(names) != cols * rows:
        sys.exit(f'имён {len(names)}, клеток {cols * rows}')
    rgba = np.array(Image.open(sheet).convert('RGBA'))
    rgba[rgba[..., 3] < FAINT] = 0
    h, w = rgba.shape[:2]
    out.mkdir(parents=True, exist_ok=True)
    for n, name in enumerate(names):
        if name == '-':
            continue
        r, c = divmod(n, cols)
        cell = rgba[r * h // rows:(r + 1) * h // rows, c * w // cols:(c + 1) * w // cols]
        alpha = cell[..., 3]
        solid = alpha >= SOLID
        if not solid.any():
            sys.exit(f'{sheet.name}: клетка {n + 1} ({name}) пустая')
        if solid[:EDGE].any() or solid[-EDGE:].any() or solid[:, :EDGE].any() or solid[:, -EDGE:].any():
            sys.exit(f'{sheet.name}: {name} задевает край клетки {n + 1} — перегенерировать лист')
        ys, xs = np.nonzero(alpha >= FAINT)
        img = Image.fromarray(cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
        k = min(1, MAX_SIDE / max(img.size))
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        img.save(out / f'{name}.png', optimize=True)
        print(f'{name} {img.width}x{img.height}')


if __name__ == '__main__':
    main()
