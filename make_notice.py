#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from PIL import Image, ImageDraw, ImageFont

# ---- brand tokens (web page와 동일) ----
PRIMARY      = (0x33, 0x66, 0xFF)
PRIMARY_DARK = (0x25, 0x4E, 0xDB)
PRIMARY_LT   = (0xEB, 0xF0, 0xFF)
BLACK        = (0x11, 0x11, 0x11)
GRAY7        = (0x66, 0x66, 0x66)
GRAY3        = (0xC9, 0xCF, 0xDA)
CARD_BG      = (0xF7, 0xF8, 0xFB)
WHITE        = (0xFF, 0xFF, 0xFF)

PRE = "/tmp/Pretendard-{}.otf"
ROUND_B = "/usr/share/fonts/truetype/nanum/NanumSquareRoundB.ttf"

def f_pre(w, s):  return ImageFont.truetype(PRE.format(w), s)
def f_round(s):   return ImageFont.truetype(ROUND_B, s)

# scale 2x for crispness
S = 2
W = 1080 * S
PAD = 64 * S

fonts = {
    "title":   f_round(60 * S),
    "brand":   f_pre("SemiBold", 28 * S),
    "tagline": f_pre("Medium", 30 * S),
    "step":    f_round(38 * S),
    "num":     f_round(40 * S),
    "body":    f_pre("SemiBold", 31 * S),
    "sub":     f_pre("Medium", 28 * S),
    "footer":  f_pre("Regular", 25 * S),
}

# ---- content ----
STEPS = [
    {
        "title": "음악 취향 작성하기",
        "body": "합주하고 싶은 장르와 좋아하는 가수를\n웹페이지 [마이페이지]에서 작성해 주세요.",
        "subs": [
            "마이페이지에서 '수정' 클릭 후 작성",
            "신규 가입자는 가입 시 함께 작성",
        ],
    },
    {
        "title": "팀 구성하고 등록하기",
        "body": "하단 자유게시판과 사담 톡방으로 구인하여\n팀을 구성합니다.",
        "subs": [
            "팀 구성 시 반드시 웹페이지 팀목록에 등록",
            "한 사람당 1팀씩만 소속",
            "인원 부족으로 인한 복수팀 활동은 세션장에게 문의",
            "비기너팀은 각 팀으로 계속 활동",
            "기존 메인세션 외 원하는 세션 참여 가능",
        ],
    },
    {
        "title": "정기합주 참여신청하기",
        "body": "팀 등록 후 정기합주 참여를 신청합니다.",
        "subs": [
            "참여신청은 웹페이지 상단 배너에서 확인",
            "팀원 전원 '참여신청' 클릭 필수",
        ],
    },
]

# ---- text wrap by pixel width ----
_meas = ImageDraw.Draw(Image.new("RGB", (1, 1)))
def wrap(text, font, max_w):
    out = []
    for raw in text.split("\n"):
        words = raw.split(" ")
        line = ""
        for wd in words:
            trial = wd if not line else line + " " + wd
            if _meas.textlength(trial, font=font) <= max_w:
                line = trial
            else:
                if line:
                    out.append(line)
                # single token too long -> char break
                if _meas.textlength(wd, font=font) > max_w:
                    cur = ""
                    for ch in wd:
                        if _meas.textlength(cur + ch, font=font) <= max_w:
                            cur += ch
                        else:
                            out.append(cur); cur = ch
                    line = cur
                else:
                    line = wd
        out.append(line)
    return out

def line_h(font, mult=1.42):
    asc, desc = font.getmetrics()
    return int((asc + desc) * mult)

# ---- layout + render in one pass (draw=None => measure only) ----
def build(draw):
    y = PAD
    x = PAD
    inner = W - PAD * 2

    # header band
    brand_f = fonts["brand"]
    title_f = fonts["title"]
    tag_f = fonts["tagline"]

    # small primary pill "GatheO"
    pill_txt = "Gather all around · GatheO"
    if draw:
        pw = _meas.textlength(pill_txt, font=brand_f)
        ph = line_h(brand_f, 1.0) + 16 * S
        draw.rounded_rectangle([x, y, x + pw + 44 * S, y + ph], radius=ph // 2, fill=PRIMARY_LT)
        draw.text((x + 22 * S, y + 8 * S), pill_txt, font=brand_f, fill=PRIMARY_DARK)
    y += line_h(brand_f, 1.0) + 16 * S + 28 * S

    # main title (2 lines)
    for ln in ["게더링 멤버", "합주팀 활동 안내"]:
        if draw:
            draw.text((x, y), ln, font=title_f, fill=BLACK)
        y += line_h(title_f, 1.18)
    y += 6 * S

    tag = "아래 3단계로 합주를 시작해요!"
    if draw:
        draw.text((x, y), tag, font=tag_f, fill=GRAY7)
    y += line_h(tag_f, 1.2)

    y += 30 * S
    # divider
    if draw:
        draw.line([x, y, W - PAD, y], fill=GRAY3, width=2 * S)
    y += 44 * S

    # step cards
    step_f = fonts["step"]; body_f = fonts["body"]; sub_f = fonts["sub"]; num_f = fonts["num"]
    badge = 70 * S
    card_pad = 40 * S
    text_x = x + card_pad + badge + 28 * S
    text_w = (W - PAD) - text_x - card_pad

    for i, st in enumerate(STEPS, 1):
        card_top = y
        cy = y + card_pad

        # title
        title_lines = wrap(st["title"], step_f, text_w)
        # body
        body_lines = []
        for bl in st["body"].split("\n"):
            body_lines += wrap(bl, body_f, text_w)
        # subs
        sub_blocks = [wrap(s, sub_f, text_w - 26 * S) for s in st["subs"]]

        # measure content height
        ch = 0
        ch += line_h(step_f, 1.15) * len(title_lines)
        ch += 12 * S
        ch += line_h(body_f, 1.34) * len(body_lines)
        ch += 16 * S
        for sb in sub_blocks:
            ch += line_h(sub_f, 1.3) * len(sb) + 6 * S
        content_h = ch
        card_h = max(content_h + card_pad * 2, badge + card_pad * 2)

        if draw:
            draw.rounded_rectangle([x, card_top, W - PAD, card_top + card_h],
                                   radius=28 * S, fill=CARD_BG)
            # number badge
            bx, by = x + card_pad, card_top + card_pad
            draw.ellipse([bx, by, bx + badge, by + badge], fill=PRIMARY)
            nb = _meas.textbbox((0, 0), str(i), font=num_f)
            nw = nb[2] - nb[0]; nh = nb[3] - nb[1]
            draw.text((bx + (badge - nw) / 2 - nb[0], by + (badge - nh) / 2 - nb[1]),
                      str(i), font=num_f, fill=WHITE)

        ty = cy
        for ln in title_lines:
            if draw:
                draw.text((text_x, ty), ln, font=step_f, fill=PRIMARY_DARK)
            ty += line_h(step_f, 1.15)
        ty += 12 * S
        for ln in body_lines:
            if draw:
                draw.text((text_x, ty), ln, font=body_f, fill=BLACK)
            ty += line_h(body_f, 1.34)
        ty += 16 * S
        for sb in sub_blocks:
            first = True
            for ln in sb:
                if draw:
                    if first:
                        # bullet dot
                        dot_r = 5 * S
                        draw.ellipse([text_x, ty + line_h(sub_f) * 0.30,
                                      text_x + dot_r * 2, ty + line_h(sub_f) * 0.30 + dot_r * 2],
                                     fill=PRIMARY)
                    draw.text((text_x + 26 * S, ty), ln, font=sub_f, fill=GRAY7)
                ty += line_h(sub_f, 1.3)
                first = False
            ty += 6 * S

        y = card_top + card_h + 30 * S

    y += 8 * S
    # footer
    foot_f = fonts["footer"]
    foot = "문의: 세션장 · gatherallaround.co.kr"
    if draw:
        draw.line([x, y, W - PAD, y], fill=GRAY3, width=2 * S)
        draw.text((x, y + 26 * S), foot, font=foot_f, fill=GRAY7)
    y += 26 * S + line_h(foot_f, 1.2)

    return y + PAD

# pass 1: measure
H = build(None)
# pass 2: render
img = Image.new("RGB", (W, H), WHITE)
d = ImageDraw.Draw(img)
build(d)

out = "/home/user/gatherallaround/notice_guide.png"
img.save(out, "PNG")
print("saved", out, img.size)
