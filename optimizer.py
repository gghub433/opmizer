#!/usr/bin/env python3
"""Game Optimizer: выбираешь игру, жмёшь «Оптимизировать» - графика становится «картошкой».

Minecraft: low-настройки + ресурспак, где стены/земля/дерево и прочий фон серые
(руды, вода, лава, светящиеся блоки остаются как есть, чтобы можно было играть).
CS2: autoexec.cfg с минимальной графикой.
Любая другая игра: поднимает приоритет процесса.
Перед изменением делается бэкап, кнопка «Откатить» возвращает всё назад.
"""
import os
import platform
import shutil
import struct
import subprocess
import sys
import zlib
import zipfile
from pathlib import Path

PACK_NAME = "PotatoGray.zip"
BACKUP_SUFFIX = ".opt_backup"

# ---------- Minecraft ----------
MC_OPTIONS = {
    "renderDistance": "4",
    "simulationDistance": "5",
    "graphicsMode": "0",
    "ao": "false",
    "renderClouds": '"false"',
    "particles": "2",
    "entityShadows": "false",
    "entityDistanceScaling": "0.5",
    "biomeBlendRadius": "0",
    "mipmapLevels": "0",
    "maxFps": "60",
    "enableVsync": "false",
    "bobView": "false",
    "fancyGraphics": "false",
}

# Фоновые блоки, которые красим в серый. Руды/вода/лава/свет/двери не трогаем.
GRAY_BLOCKS = {
    "stone": 125, "cobblestone": 115, "stone_bricks": 120, "mossy_cobblestone": 110,
    "mossy_stone_bricks": 115, "andesite": 130, "diorite": 150, "granite": 120,
    "dirt": 105, "coarse_dirt": 100, "grass_block_top": 110, "grass_block_side": 110,
    "podzol_top": 100, "mycelium_top": 105, "sand": 150, "red_sand": 140,
    "gravel": 120, "clay": 130, "snow": 200, "netherrack": 100, "deepslate": 85,
    "cobbled_deepslate": 85, "deepslate_bricks": 85, "tuff": 110, "basalt_side": 90,
    "blackstone": 70, "end_stone": 160, "bricks": 130, "sandstone": 150,
    "sandstone_top": 150, "sandstone_bottom": 150, "red_sandstone": 140,
    "oak_planks": 135, "spruce_planks": 125, "birch_planks": 150, "jungle_planks": 130,
    "acacia_planks": 130, "dark_oak_planks": 100, "oak_log": 120, "oak_log_top": 130,
    "spruce_log": 105, "spruce_log_top": 120, "birch_log": 170, "birch_log_top": 150,
    "oak_leaves": 90, "spruce_leaves": 85, "birch_leaves": 95, "jungle_leaves": 90,
    "acacia_leaves": 90, "dark_oak_leaves": 80, "terracotta": 130,
    "white_wool": 190, "bookshelf": 130, "smooth_stone": 140,
}


def _png(size, rgb):
    row = b"\x00" + bytes(rgb) * size
    raw = row * size
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def build_gray_pack(path):
    mcmeta = ('{"pack":{"pack_format":34,"description":"Potato gray textures",'
              '"supported_formats":{"min_inclusive":1,"max_inclusive":999}}}')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("pack.mcmeta", mcmeta)
        for name, g in GRAY_BLOCKS.items():
            z.writestr(f"assets/minecraft/textures/block/{name}.png", _png(16, (g, g, g)))


def minecraft_dir():
    if platform.system() == "Windows":
        return Path(os.environ.get("APPDATA", "~")).expanduser() / ".minecraft"
    if platform.system() == "Darwin":
        return Path("~/Library/Application Support/minecraft").expanduser()
    return Path("~/.minecraft").expanduser()


def _backup(path):
    bak = Path(str(path) + BACKUP_SUFFIX)
    if path.exists() and not bak.exists():
        shutil.copy2(path, bak)


def optimize_minecraft(root=None, log=print):
    root = Path(root) if root else minecraft_dir()
    root.mkdir(parents=True, exist_ok=True)
    opts = root / "options.txt"
    _backup(opts)
    lines = opts.read_text(encoding="utf-8").splitlines() if opts.exists() else []
    seen, out = set(), []
    for line in lines:
        key = line.split(":", 1)[0]
        if key in MC_OPTIONS:
            out.append(f"{key}:{MC_OPTIONS[key]}"); seen.add(key)
        elif key == "resourcePacks":
            val = line.split(":", 1)[1]
            if PACK_NAME not in val:
                val = (val.rstrip("]") + (",", "")[val.strip() in ("[]", "")]
                       + f'"file/{PACK_NAME}"]')
            out.append(f"resourcePacks:{val}"); seen.add(key)
        else:
            out.append(line)
    for key, val in MC_OPTIONS.items():
        if key not in seen:
            out.append(f"{key}:{val}")
    if "resourcePacks" not in seen:
        out.append(f'resourcePacks:["vanilla","file/{PACK_NAME}"]')
    opts.write_text("\n".join(out) + "\n", encoding="utf-8")
    packs = root / "resourcepacks"
    packs.mkdir(exist_ok=True)
    build_gray_pack(packs / PACK_NAME)
    log(f"options.txt обновлён, серый ресурспак: {packs / PACK_NAME}")


def restore_minecraft(root=None, log=print):
    root = Path(root) if root else minecraft_dir()
    opts = root / "options.txt"
    bak = Path(str(opts) + BACKUP_SUFFIX)
    if bak.exists():
        shutil.move(str(bak), opts)
        log("options.txt восстановлен")
    else:
        log("бэкап options.txt не найден")
    pack = root / "resourcepacks" / PACK_NAME
    if pack.exists():
        pack.unlink()
        log("серый ресурспак удалён")


# ---------- CS2 ----------
CS2_CFG = """// Potato graphics (Game Optimizer)
fps_max 144
cl_forcepreload 0
r_dynamic 0
cl_ragdoll_physics_enable 0
cl_disable_ragdolls 1
r_drawtracers_firstperson 0
cl_showfps 1
"""


def cs2_cfg_dir():
    cands = [
        Path("C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg"),
        Path("~/.steam/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg").expanduser(),
    ]
    return next((c for c in cands if c.exists()), None)


def optimize_cs2(root=None, log=print):
    cfg = Path(root) if root else cs2_cfg_dir()
    if not cfg or not cfg.exists():
        raise FileNotFoundError("Папка cfg CS2 не найдена, укажи путь вручную")
    f = cfg / "autoexec.cfg"
    _backup(f)
    f.write_text(CS2_CFG, encoding="utf-8")
    log(f"записан {f}. Видео-настройки поставь на Low в самой игре.")


def restore_cs2(root=None, log=print):
    cfg = Path(root) if root else cs2_cfg_dir()
    f = cfg / "autoexec.cfg" if cfg else None
    bak = Path(str(f) + BACKUP_SUFFIX) if f else None
    if bak and bak.exists():
        shutil.move(str(bak), f); log("autoexec.cfg восстановлен")
    elif f and f.exists():
        f.unlink(); log("autoexec.cfg удалён")
    else:
        log("нечего откатывать")


# ---------- Любая игра ----------
def optimize_generic(process_name, log=print):
    if not process_name:
        raise ValueError("Укажи имя процесса игры, например game.exe")
    if platform.system() == "Windows":
        name = process_name.removesuffix(".exe")
        r = subprocess.run(["powershell", "-NoProfile", "-Command",
                            f"Get-Process -Name '{name}' | ForEach-Object {{ $_.PriorityClass='High' }}"],
                           capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr.strip() or "процесс не найден (запусти игру сначала)")
    else:
        r = subprocess.run(["pkill", "-0", "-f", process_name])
        if r.returncode:
            raise RuntimeError("процесс не найден (запусти игру сначала)")
        subprocess.run(f"renice -n -5 -p $(pgrep -f '{process_name}')", shell=True)
    log(f"приоритет {process_name} поднят")


GAMES = {
    "Minecraft": (optimize_minecraft, restore_minecraft, "Папка .minecraft (необязательно)"),
    "Counter-Strike 2": (optimize_cs2, restore_cs2, "Папка cfg (необязательно)"),
    "Другая игра": (optimize_generic, None, "Имя процесса, напр. game.exe"),
}


# ---------- GUI ----------
def main():
    import tkinter as tk
    from tkinter import ttk, messagebox

    root = tk.Tk()
    root.title("Game Optimizer")
    root.geometry("480x340")
    frm = ttk.Frame(root, padding=12)
    frm.pack(fill="both", expand=True)

    ttk.Label(frm, text="Игра:").pack(anchor="w")
    game = ttk.Combobox(frm, values=list(GAMES), state="readonly")
    game.current(0)
    game.pack(fill="x")
    hint = ttk.Label(frm, text=GAMES["Minecraft"][2])
    hint.pack(anchor="w", pady=(8, 0))
    path = ttk.Entry(frm)
    path.pack(fill="x")
    box = tk.Text(frm, height=9, state="disabled")

    def log(msg):
        box.config(state="normal"); box.insert("end", msg + "\n")
        box.config(state="disabled"); box.see("end")

    def on_game(_=None):
        hint.config(text=GAMES[game.get()][2])
    game.bind("<<ComboboxSelected>>", on_game)

    def run(idx):
        fn = GAMES[game.get()][idx]
        if fn is None:
            return log("Откат для этой игры не нужен")
        try:
            fn(path.get().strip() or None, log=log)
            log("Готово!")
        except Exception as e:
            messagebox.showerror("Ошибка", str(e))

    btns = ttk.Frame(frm); btns.pack(fill="x", pady=10)
    ttk.Button(btns, text="Оптимизировать", command=lambda: run(0)).pack(side="left", expand=True, fill="x")
    ttk.Button(btns, text="Откатить", command=lambda: run(1)).pack(side="left", expand=True, fill="x")
    box.pack(fill="both", expand=True)
    root.mainloop()


if __name__ == "__main__":
    main()
