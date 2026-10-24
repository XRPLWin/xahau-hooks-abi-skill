"""Builds the four hookStates arrays for the xahauwin manifest form."""
import json, os

OUT = os.path.dirname(os.path.abspath(__file__))


def pad(n):
    return {"type": "Null", "label": "Padding", "byteLength": n, "exclude": True}


def lit(text, label="Kind"):
    return {"type": "VarString", "label": label, "byteLength": len(text), "pattern": text, "exclude": True}


def digits(label, n, description=None):
    s = {"type": "VarString", "label": label, "byteLength": n, "patternRegex": "^[0-9]{%d}$" % n}
    if description:
        s["description"] = description
    return s


def be(type_, label, description=None):
    s = {"type": type_, "label": label, "endianness": "BE"}
    if description:
        s["description"] = description
    return s


def label12(label="Name"):
    """[len:1][text:12], NUL padded. The length byte is the true length."""
    return [
        {"type": "UInt8", "label": "Length", "description": "True length of the name; the rest of the field is NUL padding.", "exclude": True},
        {"type": "VarString", "label": label, "byteLength": 12, "description": "NUL padded to 12 bytes."},
    ]


def setting(key, data, name, description):
    return {
        "name": name,
        "description": description,
        "selector": [pad(32 - len(key)), {"type": "VarString", "label": "Key", "byteLength": len(key), "pattern": key}],
        "data": data,
    }


mint = [
    {
        "name": "Edition counters",
        "description": "Copies minted of each card subject, which is also the edition number the last copy got. Keyed XC-<set>-<subject>, left padded.",
        "selector": [pad(23), lit("XC-", "Prefix"), digits("Set", 2), lit("-", "Separator"), digits("Subject", 3)],
        "data": [be("UInt32", "Copies minted")],
    },
    {
        "name": "Total cards minted",
        "description": "MINTCOUNT: every card this issuer has ever minted. Written once a pack.",
        "selector": [pad(23), lit("MINTCOUNT", "Key")],
        "data": [be("UInt32", "Cards minted")],
    },
]

rarities = ["Common", "Uncommon", "Rare", "Epic", "Legendary"]
shape = []
for r in rarities:
    shape.append(be("UInt16", r + " first id", "First subject id of the " + r.lower() + " block."))
    shape.append(be("UInt16", r + " count", "How many " + r.lower() + " subjects the block holds."))

manager = [
    {
        "name": "Card table: sets",
        "description": "T + set: the set's display name. xahaucards.table.",
        "selector": [pad(29), lit("T"), digits("Set", 2)],
        "data": label12("Set name"),
    },
    {
        "name": "Card table: set shape",
        "description": "D + set: the five rarity blocks the mint rolls a subject from. xahaucards.table.",
        "selector": [pad(29), lit("D"), digits("Set", 2)],
        "data": shape,
    },
    {
        "name": "Card table: on sale",
        "description": "O + set: 1 puts the set on sale. Any other value, or no entry, is closed. Read by the shop only. xahaucards.table.",
        "selector": [pad(29), lit("O"), digits("Set", 2)],
        "data": [{"type": "UInt8", "label": "Open", "description": "1 = on sale; anything else = closed."}],
    },
    {
        "name": "Card table: factions",
        "description": "F + set + faction key: the faction's display name. xahaucards.table.",
        "selector": [pad(25), lit("F"), digits("Set", 2), {"type": "VarString", "label": "Faction key", "byteLength": 4}],
        "data": label12("Faction name"),
    },
    {
        "name": "Card table: subjects",
        "description": "S + set + subject: the card's name and faction. xahaucards.table.",
        "selector": [pad(26), lit("S"), digits("Set", 2), digits("Subject", 3)],
        "data": [
            {"type": "UInt8", "label": "Length", "description": "True length of the name; the rest of the field is NUL padding.", "exclude": True},
            {"type": "VarString", "label": "Card name", "byteLength": 20, "description": "NUL padded to 20 bytes."},
            {"type": "VarString", "label": "Faction key", "byteLength": 4},
        ],
    },
    {
        "name": "Card table: rarities",
        "description": "R + rarity letter (C U R E L): the rarity's display name. xahaucards.table.",
        "selector": [pad(30), lit("R"), {"type": "VarString", "label": "Rarity", "byteLength": 1, "patternRegex": "^[CUREL]$"}],
        "data": label12("Rarity name"),
    },
    setting("PRICE", [be("UInt64", "Drops", "Exact pack price. 1 XAH = 1,000,000 drops.")],
            "Setting: pack price", "PRICE: the exact amount the shop accepts for a pack. xahaucards.settings."),
    setting("BUDGET", [be("UInt64", "Drops", "Forwarded to the issuer per pack. 1 XAH = 1,000,000 drops.")],
            "Setting: mint budget", "BUDGET: what the shop forwards to the issuer each pack to pay for its ten emitted transactions. xahaucards.settings."),
    setting("NEWACCT", [be("UInt64", "Drops", "1 XAH = 1,000,000 drops.")],
            "Setting: new account allowance", "NEWACCT: added to a free pack's budget when the recipient's account does not exist yet. xahaucards.settings."),
    setting("SHOP", [{"type": "AccountID", "label": "Shop"}],
            "Setting: shop account", "SHOP: the only account whose emitted payment the mint acts on. xahaucards.settings."),
    setting("CLAIM", [{"type": "AccountID", "label": "Claim authority"}],
            "Setting: claim authority", "CLAIM: the only account the shop accepts a GRANT Invoke from. xahaucards.settings."),
    setting("DOMAIN", [{"type": "VarString", "label": "Host"}],
            "Setting: card art domain", "DOMAIN: the host every card's image URL points at. xahaucards.settings."),
    {
        "name": "Attestor roll",
        "description": "Accounts that may sign cards, with their slot and display name. xahaucards.attest.",
        "selector": [pad(12), {"type": "AccountID", "label": "Attestor"}],
        "data": [digits("Slot", 2), {"type": "VarString", "label": "Name"}],
    },
    {
        "name": "Signature allowances",
        "description": "SIGS + slot: how many more cards that slot may sign. xahaucards.attest.",
        "selector": [pad(26), lit("SIGS", "Key"), digits("Slot", 2)],
        "data": [be("UInt32", "Signatures left")],
    },
]

shop = [
    {
        "name": "Purchase records",
        "description": "One per pack in flight, keyed by the buyer's Payment txid (or the GRANT Invoke's). Deleted on delivery; P pending, G granted, F failed (refund owed), L lapsed grant.",
        "selector": [{"type": "Hash256", "label": "Txid"}],
        "data": [
            {"type": "AccountID", "label": "Buyer"},
            digits("Set", 2),
            {"type": "VarString", "label": "Status", "byteLength": 1, "patternRegex": "^[PGFL]$",
             "description": "P pending, G granted, F failed, L lapsed."},
        ],
    },
]

doors = [
    {
        "name": "Grant allowance",
        "description": "GRANTS: how many more free packs the GRANT door may deal. Set by an ALLOW Invoke from the shop's own key.",
        "selector": [pad(26), lit("GRANTS", "Key")],
        "data": [be("UInt32", "Grants left")],
    },
]

for name, states in [("mint", mint), ("manager", manager), ("shop", shop), ("doors", doors)]:
    with open(os.path.join(OUT, name + ".abi.json"), "w") as f:
        json.dump(states, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(name, len(states), "projections")
