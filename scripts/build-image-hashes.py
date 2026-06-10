# カード画像の知覚ハッシュ(dHash)を計算して data/image-hashes.json にキャッシュする。
#
# ショップごとに画像の出どころが違っても(実物スキャン / 公式画像+SAMPLE透かし)、
# dHash は画像全体の明暗構造を比較するため、同じカードなら高い類似度になる。
# generate-alias-candidates.mjs がこのキャッシュを読み、候補に imageScore を付与する。
#
# 使い方:
#   python scripts/build-image-hashes.py            # alias-candidates.json の画像を処理
#   python scripts/build-image-hashes.py --limit 500  # 新規ダウンロードを500件まで
#   python scripts/build-image-hashes.py --all-cards  # cards.json の全画像も対象にする
#
# 依存: pip install pillow

import argparse
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES_PATH = ROOT / "data" / "alias-candidates.json"
CARDS_PATH = ROOT / "data" / "cards.json"
HASHES_PATH = ROOT / "data" / "image-hashes.json"

HASH_SIZE = 16  # 16x16 → 256bit。SAMPLE透かし程度の差分に埋もれない解像度
REQUEST_INTERVAL = 0.25
USER_AGENT = "Mozilla/5.0 (compatible; OP_TCG_PRICE_CHECKER/1.0)"


def dhash(image: Image.Image, size: int = HASH_SIZE) -> str:
    gray = image.convert("L").resize((size + 1, size), Image.LANCZOS)
    pixels = list(gray.getdata())
    bits = []
    for row in range(size):
        offset = row * (size + 1)
        for col in range(size):
            bits.append(pixels[offset + col] > pixels[offset + col + 1])
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:0{size * size // 4}x}"


def fetch_image(url: str) -> Image.Image:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read()
    return Image.open(io.BytesIO(data))


def collect_urls(include_all_cards: bool) -> list[str]:
    urls: dict[str, None] = {}

    if CANDIDATES_PATH.exists():
        candidates = json.loads(CANDIDATES_PATH.read_text(encoding="utf-8"))
        # 高額な候補から優先的に処理する(--limit 併用時に意味を持つ)
        for candidate in sorted(candidates, key=lambda c: -(c.get("maxPrice") or 0)):
            for record in candidate.get("records", []):
                url = (record.get("imageUrl") or "").strip()
                if url.startswith("http"):
                    urls.setdefault(url)

    if include_all_cards and CARDS_PATH.exists():
        cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
        for card in cards:
            for shop in (card.get("pricesByShop") or {}).values():
                url = (shop.get("imageUrl") or "").strip()
                if url.startswith("http"):
                    urls.setdefault(url)

    return list(urls)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="新規ダウンロード数の上限 (0=無制限)")
    parser.add_argument("--all-cards", action="store_true", help="cards.json の全画像も対象にする")
    args = parser.parse_args()

    hashes = {}
    if HASHES_PATH.exists():
        hashes = json.loads(HASHES_PATH.read_text(encoding="utf-8"))

    urls = collect_urls(args.all_cards)
    pending = [url for url in urls if url not in hashes]
    if args.limit > 0:
        pending = pending[: args.limit]

    print(f"対象URL: {len(urls)} / キャッシュ済み: {len(urls) - len(pending)} / 新規: {len(pending)}")

    processed = 0
    errors = 0
    for url in pending:
        try:
            image = fetch_image(url)
            hashes[url] = {"dhash": dhash(image)}
        except Exception as error:  # noqa: BLE001 - 失敗したURLは記録してスキップ
            hashes[url] = {"error": str(error)[:120]}
            errors += 1
        processed += 1
        if processed % 50 == 0:
            print(f"  {processed}/{len(pending)} 件処理 (エラー {errors})")
            HASHES_PATH.write_text(
                json.dumps(hashes, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
            )
        time.sleep(REQUEST_INTERVAL)

    HASHES_PATH.write_text(json.dumps(hashes, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"完了: {processed} 件処理 (エラー {errors})、合計 {len(hashes)} 件を {HASHES_PATH.name} に保存")


if __name__ == "__main__":
    sys.exit(main())
