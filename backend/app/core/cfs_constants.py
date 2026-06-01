MATERIAL_MAP = {
    "0e1001": "PLA+",
    "101001": "PLA",
    "001001": "PETG",
    "000001": "ABS",
    "0E1001": "PLA+",
    "0ff614b": "PLA",
    "0C12E1F": "PLA",
    "0FFFFFF": "PLA",
    "000a3ff": "PLA",
    "09ea7ae": "PLA+",
    "0000000": "PLA",
    "01b04ae": "PLA",
    "0fc9da9": "PLA",
}

_COLOR_NAMES: list[tuple[int, int, int, str]] = [
    (0, 0, 0, "Black"),
    (255, 255, 255, "White"),
    (128, 128, 128, "Grey"),
    (192, 192, 192, "Silver"),
    (255, 0, 0, "Red"),
    (139, 0, 0, "Dark Red"),
    (178, 34, 34, "Firebrick"),
    (220, 20, 60, "Crimson"),
    (255, 99, 71, "Tomato"),
    (255, 69, 0, "Orange Red"),
    (255, 140, 0, "Dark Orange"),
    (255, 165, 0, "Orange"),
    (252, 157, 154, "Salmon"),
    (255, 215, 0, "Gold"),
    (255, 255, 0, "Yellow"),
    (255, 253, 208, "Cream"),
    (154, 205, 50, "Yellow Green"),
    (0, 128, 0, "Green"),
    (34, 139, 34, "Forest Green"),
    (0, 100, 0, "Dark Green"),
    (144, 238, 144, "Light Green"),
    (152, 251, 152, "Pale Green"),
    (0, 250, 154, "Medium Spring Green"),
    (9, 234, 174, "Mint"),
    (0, 255, 127, "Spring Green"),
    (0, 128, 128, "Teal"),
    (0, 139, 139, "Dark Cyan"),
    (0, 206, 209, "Dark Turquoise"),
    (0, 255, 255, "Cyan"),
    (127, 255, 212, "Aquamarine"),
    (0, 10, 255, "Blue"),
    (65, 105, 225, "Royal Blue"),
    (30, 144, 255, "Dodger Blue"),
    (70, 130, 180, "Steel Blue"),
    (100, 149, 237, "Cornflower Blue"),
    (135, 206, 235, "Sky Blue"),
    (0, 0, 139, "Dark Blue"),
    (0, 0, 205, "Medium Blue"),
    (25, 25, 112, "Midnight Blue"),
    (75, 0, 130, "Indigo"),
    (138, 43, 226, "Blue Violet"),
    (148, 103, 189, "Purple"),
    (128, 0, 128, "Purple"),
    (186, 85, 211, "Medium Orchid"),
    (218, 112, 214, "Orchid"),
    (255, 0, 255, "Magenta"),
    (199, 21, 133, "Medium Violet Red"),
    (255, 20, 147, "Deep Pink"),
    (255, 105, 180, "Hot Pink"),
    (255, 182, 193, "Pink"),
    (255, 192, 203, "Pink"),
    (245, 222, 179, "Wheat"),
    (210, 180, 140, "Tan"),
    (244, 164, 96, "Sandy Brown"),
    (160, 82, 45, "Sienna"),
    (139, 69, 19, "Saddle Brown"),
    (101, 67, 33, "Brown"),
    (111, 78, 55, "Brown"),
]


def color_name_from_hex(hex_val: str | None) -> str:
    if not hex_val:
        return ""
    h = hex_val.replace("#", "")
    if len(h) == 7 and h.startswith("0"):
        h = h[1:]
    if len(h) != 6:
        return ""
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return ""
    best_name = ""
    best_dist = float("inf")
    for cr, cg, cb, name in _COLOR_NAMES:
        d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
        if d < best_dist:
            best_dist = d
            best_name = name
    return best_name


def normalize_hex(hex_val: str) -> str:
    if not hex_val or hex_val == "-1":
        return ""
    h = hex_val.replace("#", "")
    if len(h) == 7 and h.startswith("0"):
        h = h[1:]
    return f"#{h}" if len(h) == 6 else hex_val


def build_name_map(same_material: list) -> dict[str, str]:
    name_map: dict[str, str] = {}
    for entry in same_material:
        if len(entry) >= 4:
            slots_list = entry[2] if isinstance(entry[2], list) else []
            name = entry[3] or ""
            for sid in slots_list:
                if name:
                    name_map[sid] = name
    return name_map
