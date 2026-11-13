#!/usr/bin/env python3
"""Art pipeline for High Cardinality. Runs ON the GPU pod (SDXL anime, diffusers).

    python3 gen.py candidates sprites 6     # N seeds per character, for picking
    python3 gen.py candidates bgs 3
    python3 gen.py candidates cgs 6
    python3 gen.py finals picks.json        # expressions + matting for sprites, hires bgs/cgs
    python3 gen.py serve                    # HTTP on :8000, no directory listings

Prompts come from docs/characters.md and content/assets.yaml. Outputs go to
/workspace/out/$TOKEN/ (TOKEN is a random path so the public proxy isn't browsable),
each step writing manifest.json there. Every character is an adult; negatives enforce it.
"""
import json
import os
import sys

OUT = f"/workspace/out/{os.environ.get('TOKEN', 'dev')}"
WORK = "/workspace/work"
MODEL = "/workspace/models/animagine-xl-4.0.safetensors"
FACE = "/workspace/models/face_yolov8m.pt"

QUALITY = "masterpiece, high score, great score, absurdres, anime coloring, cel shading, clean lineart, pastel colors, safe"
NEG = ("lowres, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, extra arms, text, error, cropped, "
       "worst quality, low quality, low score, bad score, average score, jpeg artifacts, signature, watermark, username, "
       "blurry, child, loli, shota, young, teenager, school uniform, nsfw, cleavage, multiple views")
SPRITE = "solo, cowboy shot, standing, looking at viewer, simple background, white background, visual novel sprite"
SPRITE_NEG = ", 2girls, 2boys, gradient background, outdoors, scenery"

CHARS = {
    "logs": "1girl, mature female, adult, tall, very long hair, cream hair, gradient hair, black hair tips, wavy hair, amber eyes, freckles, ink on cheek, oversized cardigan, cream cardigan, patterned cardigan, white blouse, long pleated skirt, brown skirt, long scarf, paper scarf, holding notebook, pink hair ribbon",
    "metrics": "1boy, mature male, adult, short hair, silver hair, blue hair, undercut, rectangular glasses, blue eyes, athletic, navy track jacket, striped sleeves, teal accents, smartwatch, wristwatch, lanyard, black pants",
    "traces": "1other, androgynous, adult, short hair, wavy hair, bob cut, lilac hair, purple hair, gradient hair, glowing hair, grey eyes, long coat, white coat, layered coat, glowing embroidery, gold thread, fingerless gloves, string on finger, badges, ethereal",
    "monitoring": "1other, androgynous, adult, short hair, messy hair, dark grey hair, tired eyes, eye bags, headset, lanyard, id card, grey cardigan, polo shirt, holding clipboard, red and green accents, khaki pants",
    "collector": "1other, adult, short hair, messy hair, orange hair, ahoge, antenna hair, headphones around neck, orange bomber jacket, patches, messenger bag, envelope, glowing, cream shirt, charcoal pants, energetic",
    "baggage": "1other, adult, round face, brown hair, short hair, beret, green beret, large backpack, luggage tag, tags on jacket, green jacket, tan pants, rolling suitcase",
    "dba": "1other, adult, mature, round eyewear, glasses, dark hair, messy bun, pencil in hair, navy cardigan, mustard scarf, keyring, keys on belt, holding index cards",
}
MOODS = {
    "neutral": "closed mouth, calm, light smile",
    "happy": "smile, open mouth, happy, :d, sparkling eyes",
    "blush": "blush, embarrassed, shy smile, looking away, nose blush",
    "sad": "sad, frown, teary eyes, looking down",
    "surprised": "surprised, wide-eyed, open mouth, :o",
    "annoyed": "annoyed, pout, frown, narrowed eyes",
}
BG = "no humans, scenery, anime background, detailed background, highly detailed, beautiful lighting"
BGS = {
    "bedroom_night": "bedroom, night, dark room, glowing smartphone on bed, phone screen light, blue light, cozy, posters, window, city lights",
    "ingest_void": "abstract, starry sky, falling through space, glowing lines of text, floating holographic panels, data streams, purple and pink nebula, sparkles, dreamy",
    "registry": "indoors, library, archive, filing cabinets, index cards, bookshelves, pastel colors, warm lighting, wooden desk, rubber stamps, diagrams on wall, cozy office",
    "mesh_plaza": "outdoors, plaza, town square, fantasy city, glowing paths on ground, kiosks, market stalls, blue sky, clouds, sunny, pastel buildings",
    "archive_cafe": "indoors, cafe inside a library, tall bookshelves, scrolls, warm light, coffee cups on table, endless shelves, floating paper, cozy",
    "dashboard_gym": "indoors, modern gym, wall screens with charts and gauges, blue lighting, clean, dumbbells, treadmills, holographic graphs",
    "sampling_cafe": "indoors, quiet cafe, corner table, two coffee cups, window, rain, grey tones, faded tables, dreamy, soft light, lilac tint",
    "noc_room": "indoors, control room, many monitors, red and green status lights, dark room, desks, headset on desk, night",
    "finale_sky": "sky, above the clouds, sunset, glowing platform, stage, stars, pink and gold sky, sparkles, magical, light rays",
}
CG = "highly detailed, beautiful lighting, depth of field, sparkles"
CGS = {
    "polycule": "group, 1girl, 1boy, 1other, cream hair woman with paper scarf, silver hair man with glasses, lilac hair androgynous person in white coat, holding hands, smiling, glowing light, sky, sunset, light particles, adults",
    "logs_end": CHARS["logs"] + ", solo, reading scroll aloud, very long scroll, library, warm light, smile, blush, upper body",
    "metrics_end": CHARS["metrics"] + ", solo, holographic gauge, glowing chart, blush, gentle smile, upper body, blue light",
    "traces_end": CHARS["traces"] + ", solo, glowing golden threads, reaching out, outstretched hand, sparkles, soft smile, blush, upper body",
}
SIZES = {"sprites": (832, 1216), "bgs": (1344, 768), "cgs": (1344, 768)}


def jobs(kind):
    if kind == "sprites":
        return {k: f"{v}, {SPRITE}, {MOODS['neutral']}, {QUALITY}" for k, v in CHARS.items()}
    if kind == "bgs":
        return {k: f"{BG}, {v}, {QUALITY}" for k, v in BGS.items()}
    return {k: f"{v}, {CG}, {QUALITY}" for k, v in CGS.items()}


def neg(kind):
    return NEG + (SPRITE_NEG if kind == "sprites" else ", 1girl, 1boy, people" if kind == "bgs" else "")


_pipe = None
_compel = None


def pipe():
    global _pipe, _compel
    if _pipe is None:
        import torch
        from compel import Compel, ReturnedEmbeddingsType
        from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler
        _pipe = StableDiffusionXLPipeline.from_single_file(MODEL, torch_dtype=torch.float16).to("cuda")
        _pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(_pipe.scheduler.config)
        # CLIP reads 77 tokens; our prompts are longer. Compel chunks them instead of truncating.
        _compel = Compel(tokenizer=[_pipe.tokenizer, _pipe.tokenizer_2], text_encoder=[_pipe.text_encoder, _pipe.text_encoder_2],
                         returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED,
                         requires_pooled=[False, True], truncate_long_prompts=False)
    return _pipe


def emb(prompt, negative):
    pipe()
    c, pooled = _compel(prompt)
    n, npooled = _compel(negative)
    c, n = _compel.pad_conditioning_tensors_to_same_length([c, n])
    return dict(prompt_embeds=c, pooled_prompt_embeds=pooled, negative_prompt_embeds=n, negative_pooled_prompt_embeds=npooled)


def gen(prompt, negative, seed, size, **kw):
    import torch
    return pipe()(**emb(prompt, negative), width=size[0], height=size[1], num_inference_steps=28,
                  guidance_scale=5.0, generator=torch.Generator("cuda").manual_seed(seed), **kw).images[0]


def save_manifest(files):
    path = f"{OUT}/manifest.json"
    old = json.load(open(path)) if os.path.exists(path) else []
    json.dump(sorted(set(old) | set(files)), open(path, "w"), indent=1)


def candidates(kind, n):
    os.makedirs(f"{OUT}/cand/{kind}", exist_ok=True)
    os.makedirs(f"{WORK}/{kind}", exist_ok=True)
    files = []
    for key, prompt in jobs(kind).items():
        for seed in range(1000, 1000 + n):
            png = f"{WORK}/{kind}/{key}_{seed}.png"
            if not os.path.exists(png):
                gen(prompt, neg(kind), seed, SIZES[kind]).save(png)
            from PIL import Image
            rel = f"cand/{kind}/{key}_{seed}.webp"
            Image.open(png).save(f"{OUT}/{rel}", quality=82)
            files.append(rel)
            print("done", rel, flush=True)
    save_manifest(files)


def face_box(img):
    from ultralytics import YOLO
    r = YOLO(FACE)(img, verbose=False)[0]
    if not len(r.boxes):
        raise RuntimeError("no face found")
    i = int(r.boxes.conf.argmax())
    return [float(v) for v in r.boxes.xyxy[i]]


def expression(base, prompt, seed, box):
    """Redraw only the face region (FaceDetailer-style) so body and framing stay identical."""
    import torch
    from PIL import Image, ImageDraw, ImageFilter
    from diffusers import StableDiffusionXLInpaintPipeline
    x0, y0, x1, y1 = box
    cx, cy, s = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 2.0
    s = max(s, 320)
    crop = (int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2))
    region = base.crop(crop).resize((1024, 1024), Image.LANCZOS)
    k = 1024 / s
    m = Image.new("L", (1024, 1024), 0)
    fx0, fy0, fx1, fy1 = [(v - o) * k for v, o in zip(box, (crop[0], crop[1], crop[0], crop[1]))]
    pad = 0.12 * (fx1 - fx0)
    ImageDraw.Draw(m).ellipse((fx0 - pad, fy0 - pad, fx1 + pad, fy1 + pad), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(24))
    inpaint = StableDiffusionXLInpaintPipeline.from_pipe(pipe())
    out = inpaint(**emb(prompt, NEG), image=region, mask_image=m, strength=0.62, num_inference_steps=30,
                  guidance_scale=5.0, generator=torch.Generator("cuda").manual_seed(seed)).images[0]
    patch = out.resize((crop[2] - crop[0], crop[3] - crop[1]), Image.LANCZOS)
    mask = m.resize(patch.size, Image.LANCZOS)
    result = base.copy()
    result.paste(patch, crop[:2], mask)
    return result


def hires(img, prompt, negative, seed):
    """1.5x upscale + light img2img pass for full-screen art."""
    import torch
    from PIL import Image
    from diffusers import StableDiffusionXLImg2ImgPipeline
    big = img.resize((int(img.width * 1.5) // 8 * 8, int(img.height * 1.5) // 8 * 8), Image.LANCZOS)
    i2i = StableDiffusionXLImg2ImgPipeline.from_pipe(pipe())
    return i2i(**emb(prompt, negative), image=big, strength=0.32, num_inference_steps=30,
               guidance_scale=5.0, generator=torch.Generator("cuda").manual_seed(seed)).images[0]


def finals(picks_path):
    from PIL import Image
    picks = json.load(open(picks_path))
    files = []
    os.makedirs(f"{OUT}/final/sprites", exist_ok=True)
    os.makedirs(f"{OUT}/final/bgs", exist_ok=True)
    os.makedirs(f"{OUT}/final/cgs", exist_ok=True)
    from rembg import remove, new_session
    session = new_session("isnet-anime")
    for key, seed in picks.get("sprites", {}).items():
        base = Image.open(f"{WORK}/sprites/{key}_{seed}.png").convert("RGB")
        alpha = remove(base, session=session).split()[-1]  # one matte from the base: identical edges for every mood
        box = face_box(base)
        for mood, tags in MOODS.items():
            rel = f"final/sprites/{key}_{mood}.webp"
            img = base if mood == "neutral" else expression(base, f"{CHARS[key]}, {SPRITE}, {tags}, {QUALITY}", seed, box)
            rgba = img.convert("RGBA")
            rgba.putalpha(alpha)
            rgba.save(f"{OUT}/{rel}", quality=88)
            files.append(rel)
            print("done", rel, flush=True)
    for kind in ("bgs", "cgs"):
        for key, seed in picks.get(kind, {}).items():
            rel = f"final/{kind}/{key}.webp"
            img = Image.open(f"{WORK}/{kind}/{key}_{seed}.png").convert("RGB")
            hires(img, jobs(kind)[key], neg(kind), seed).save(f"{OUT}/{rel}", quality=85)
            files.append(rel)
            print("done", rel, flush=True)
    save_manifest(files)


def serve():
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class NoListing(SimpleHTTPRequestHandler):
        def list_directory(self, path):
            self.send_error(404)

    os.chdir("/workspace/out")
    ThreadingHTTPServer(("0.0.0.0", 8000), NoListing).serve_forever()


if __name__ == "__main__":
    cmd = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    if cmd == "candidates":
        candidates(sys.argv[2], int(sys.argv[3]))
    elif cmd == "finals":
        finals(sys.argv[2])
    elif cmd == "serve":
        serve()
    else:
        sys.exit(f"unknown command {cmd}")
