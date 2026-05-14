import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "cards.json"


def clean(value):
    if pd.isna(value):
        return ""
    return str(value).strip()


def clean_model(value):
    value = clean(value)
    value = re.sub(r"^型(?:番)?[:：\s]*", "", value)
    return value.strip()


def key_for(name, model):
    normalized_name = unicodedata.normalize("NFKC", clean(name))
    normalized_model = unicodedata.normalize("NFKC", clean_model(model))
    return re.sub(r"\s+", "", f"{normalized_model}_{normalized_name}").lower()


def date_text(value):
    dt = pd.to_datetime(value, errors="coerce")
    if pd.isna(dt):
        return ""
    return dt.strftime("%Y/%m/%d")


def load_cards():
    if DATA_PATH.exists():
        with DATA_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    return []


def upsert_history(history, rows):
    by_date = {}
    for item in history or []:
        if item.get("date"):
            by_date[item["date"]] = int(item.get("price") or 0)
    for date, price in rows:
        by_date[date] = int(price)
    return [{"date": date, "price": by_date[date]} for date in sorted(by_date)]


def recompute_best(card):
    shops = card.get("pricesByShop", {})
    best_id = ""
    best_price = 0
    best_image = card.get("imageId", "")
    for shop_id, shop in shops.items():
        price = int(shop.get("latestPrice") or 0)
        if price > best_price:
            best_id = shop_id
            best_price = price
            best_image = shop.get("imageUrl") or best_image
    card["bestShopId"] = best_id
    card["latestPrice"] = best_price
    card["imageId"] = best_image
    card["history"] = upsert_history(card.get("history", []), [(h["date"], h["price"]) for h in shops.get(best_id, {}).get("history", [])])
    return card


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/import-mercard-history.py mercard-history.xlsx")

    workbook_path = Path(sys.argv[1])
    xls = pd.ExcelFile(workbook_path)
    cards_sheet = pd.read_excel(xls, "Cards")

    card_meta = {}
    for _, row in cards_sheet.iterrows():
        name = clean(row.get("カード名"))
        model = clean_model(row.get("型番"))
        image_id = clean(row.get("画像Drive_ID"))
        if name and model:
            image_url = f"https://drive.google.com/thumbnail?id={image_id}&sz=w400" if image_id else ""
            card_meta[key_for(name, model)] = {"name": name, "modelNo": model, "imageUrl": image_url}

    history_rows = defaultdict(list)
    for sheet_name in xls.sheet_names:
        frame = pd.read_excel(xls, sheet_name)
        if not {"日付", "カード名", "型番", "価格"}.issubset(frame.columns):
            continue
        for _, row in frame.iterrows():
            date = date_text(row.get("日付"))
            name = clean(row.get("カード名"))
            model = clean_model(row.get("型番"))
            price = pd.to_numeric(row.get("価格"), errors="coerce")
            if date and name and model and not pd.isna(price) and int(price) > 0:
                history_rows[key_for(name, model)].append((date, int(price), name, model))

    cards_by_key = {}
    for card in load_cards():
        key = key_for(card.get("name"), card.get("modelNo"))
        card["key"] = key
        cards_by_key[key] = card

    imported = 0
    created = 0
    for key, rows in history_rows.items():
        rows.sort(key=lambda item: item[0])
        by_date = {}
        sample_name = rows[-1][2]
        sample_model = rows[-1][3]
        for date, price, _, _ in rows:
            by_date[date] = price
        history = [{"date": date, "price": by_date[date]} for date in sorted(by_date)]
        meta = card_meta.get(key, {})
        card = cards_by_key.get(key)
        if not card:
            created += 1
            card = {
                "key": key,
                "name": meta.get("name") or sample_name,
                "modelNo": meta.get("modelNo") or sample_model,
                "imageId": meta.get("imageUrl", ""),
                "history": [],
                "pricesByShop": {},
            }
            cards_by_key[key] = card

        shop = card.setdefault("pricesByShop", {}).setdefault("mercard", {"shopName": "メルカード"})
        shop["shopName"] = "メルカード"
        shop["history"] = upsert_history(shop.get("history", []), [(h["date"], h["price"]) for h in history])
        shop["latestPrice"] = shop["history"][-1]["price"]
        if not shop.get("imageUrl"):
            shop["imageUrl"] = meta.get("imageUrl") or card.get("imageId", "")
        if not shop.get("sourceUrl"):
            shop["sourceUrl"] = "https://akihabara-cardshop.com/onepice-kaitori/"
        imported += len(history)

    output = [recompute_best(card) for card in cards_by_key.values()]
    output = [card for card in output if int(card.get("latestPrice") or 0) > 0]
    output.sort(key=lambda card: (-int(card.get("latestPrice") or 0), card.get("modelNo", "")))

    with DATA_PATH.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(json.dumps({"cards": len(output), "historyRowsImported": imported, "cardsCreated": created}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
