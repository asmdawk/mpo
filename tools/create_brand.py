from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

root = Path(__file__).resolve().parents[1]
res = root / 'resources'
res.mkdir(exist_ok=True)
size = 1024
im = Image.new('RGBA', (size,size), (0,0,0,0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((8,8,1016,1016),radius=240,fill='#10172d',outline='#384864',width=8)
glow=Image.new('RGBA',(size,size))
ImageDraw.Draw(glow).ellipse((210,180,810,850),fill=(68,208,211,65))
im=Image.alpha_composite(im,glow.filter(ImageFilter.GaussianBlur(100)))
mask=Image.new('L',(size,size))
ImageDraw.Draw(mask).polygon([(242,280),(773,280),(466,580),(763,580),(418,833),(507,669),(244,669),(550,369),(242,369)],fill=255)
gradient=Image.new('RGBA',(size,size))
gd=ImageDraw.Draw(gradient)
for row in range(size):
    t=row/(size-1)
    gd.line((0,row,size,row),fill=(int(100+88*t),int(255-104*t),int(229+26*t),255))
gradient.putalpha(mask)
im=Image.alpha_composite(im,gradient)
im.save(res/'icon.png')
im.save(res/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
spl=Image.new('RGB',(600,330),'#0b1020')
spl.alpha_composite(im.resize((92,92)),(254,55)) if spl.mode=='RGBA' else spl.paste(im.resize((92,92)),(254,55),im.resize((92,92)))
draw=ImageDraw.Draw(spl)
font_path=root/'renderer/assets/fonts/Manrope.ttf'
font=ImageFont.truetype(str(font_path) if font_path.exists() else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',35)
small=ImageFont.truetype(str(font_path) if font_path.exists() else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
draw.text((300,182),'ZigZak Player',font=font,anchor='mm',fill='#f5f7f6')
draw.text((300,234),'YOUR SOUND. YOUR UNIVERSE.',font=small,anchor='mm',fill='#a9b7d1')
draw.rounded_rectangle((235,281,365,284),radius=2,fill='#80f8e8')
spl.save(res/'splash.bmp')
