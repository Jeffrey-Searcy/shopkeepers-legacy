"""
Keeper palette, sampled from the ChatGPT poster (k-means over the male figures) and grouped by material.
Every material owns unique exact RGB values, so the game's recolor system can find hair, skin, shirt,
pants and boots by color alone. One character per palette entry is used in the ASCII pixel maps.
"""
PAL = {
    '.': None,
    'o': 0x1c0f10,  # outline
    # hair: darkest -> highlight
    '1': 0x2e1713, '2': 0x4d251b, '3': 0x6a3826, '4': 0x84492f, '5': 0xa0603e,
    # skin: shadow -> highlight
    'a': 0xb8613f, 'b': 0xd98660, 'c': 0xeba57a, 'd': 0xf6cfa0,
    # eyes and mouth
    'e': 0x1b1730, 'w': 0xfaf0d3, 'm': 0xa8483a,
    # shirt (blue work shirt): darkest -> highlight
    'n': 0x121831, 'B': 0x1d2d4d, 'C': 0x2a4a73, 'D': 0x3f6890, 'E': 0x6d8fae,
    # neckerchief
    'r': 0x8e2a24, 'R': 0xc4483a,
    # belt and buckle
    'k': 0x4a2a1d, 'L': 0x6e4128, 'y': 0xc9a24a,
    # trousers (blue-grey denim)
    'p': 0x222a40, 'P': 0x36435f, 'Q': 0x4f5f7d,
    # boots
    'v': 0x4c1d17, 'V': 0x7e3526, 'W': 0xa8573a,
    # --- tools (never recolored; none of these values appear on the keeper) ---
    # wood handles: dark, mid, light
    'h': 0x553620, 'H': 0x86562f, 'u': 0xb47c48,
    # steel: dark, mid, light, shine
    'g': 0x3a4552, 'G': 0x67798b, 'M': 0xa6b6c3, 'N': 0xe8f0f4,
    # brass guard / ferrule
    'A': 0x8f6418, 'Y': 0xdcae46,
    # broom straw and its red binding
    's': 0x9c7a32, 'S': 0xd2b158, 't': 0xf0da8c, 'I': 0xa3342a,
    # watering can (blue enamel)
    'f': 0x234a7a, 'F': 0x3f78b0, 'l': 0x7fb2d9,
    # effects: water, dirt, grass, swoosh
    'q': 0x5fa8e8, 'z': 0xc6e6ff, 'K': 0x5a3a24, 'J': 0x8a6040, 'T': 0x4f8a3a, 'U': 0x86bf55,
    'X': 0xfff6d8, 'Z': 0xbfe0ff,
    # --- garments (garments.py; fixed colors the wardrobe never recolors) ---
    # linen apron: shadow, mid, light
    'i': 0x8f8068, 'j': 0xc4b593, 'x': 0xe8dcbf,
    # smith leather: dark, mid, light
    '6': 0x3a2117, '7': 0x5c3622, '8': 0x834f2e,
    # vest wool (forest green): dark, mid, light
    '9': 0x1f3327, 'O': 0x2f4e3a, '0': 0x467052,
    # guard tabard: crimson dark, mid, light; gold dark, light (the gold light also makes brass buttons)
    '!': 0x561620, '#': 0x86232e, '$': 0xb03a3f, '%': 0x9c7222, '&': 0xe2bb4c,
}
MATERIALS = {
    'outline': 'o', 'hair': '12345', 'skin': 'abcd', 'eye': 'ew', 'mouth': 'm', 'shirt': 'nBCDE',
    'scarf': 'rR', 'belt': 'kLy', 'pants': 'pPQ', 'boots': 'vVW',
    'tool': 'hHugGMNAYsStIfFl', 'fx': 'qzKJTUXZ',
    'linen': 'ijx', 'leather': '678', 'wool': '9O0', 'tabard': '!#$%&',
}
def rgb(ch):
    """Return the (r, g, b) tuple for one palette key; raises KeyError on an unknown key."""
    v = PAL[ch]; return (v >> 16, (v >> 8) & 255, v & 255)
