"""Render one action's 4x4 frames, cropped and zoomed, with a ground line at the feet row."""
import sys
from PIL import Image, ImageDraw
from render import grid_img
from poses import ACTIONS, build
name = sys.argv[1]; Z = 6
rows = build(ACTIONS[name]())
crop = (18, 0, 78, 46)
cw, ch = (crop[2]-crop[0])*Z, (crop[3]-crop[1])*Z
sheet = Image.new('RGBA', (4*(cw+8)+8, 4*(ch+8)+8), (96,120,84,255))
d = ImageDraw.Draw(sheet)
for r, frames in enumerate(rows):
    for c, f in enumerate(frames):
        img = grid_img(f).crop(crop).resize((cw, ch), Image.NEAREST)
        x, y = 8 + c*(cw+8), 8 + r*(ch+8)
        d.rectangle([x, y, x+cw-1, y+ch-1], fill=(110,136,96,255))
        d.line([x, y+(39-crop[1])*Z+Z, x+cw, y+(39-crop[1])*Z+Z], fill=(80,100,70,255))
        sheet.alpha_composite(img, (x, y))
sheet.save(f'p-{name}.png'); print('ok')
