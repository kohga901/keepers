import csv
from pathlib import Path

rows = []
ids = set()

input_path = Path(__file__).resolve().parent.parent / "Clothing_rows_no_shoes.csv"
output_path = Path(__file__).resolve().parent.parent / "coordinates.csv"

with input_path.open("r", encoding="utf-8", newline="") as file:
    reader = csv.DictReader(file)

    for row in reader:
        ids.add(row['item_id'])

input_path = Path(__file__).resolve().parent.parent / "coordinates_old.csv"

with input_path.open("r", encoding="utf-8", newline="") as file:
    reader = csv.DictReader(file)

    for row in reader:
        if row['item_id'] in ids:
            rows.append(row)

with output_path.open("w", encoding="utf-8", newline="") as file:
    writer = csv.DictWriter(file, fieldnames=reader.fieldnames)
    writer.writeheader()
    writer.writerows(rows)
