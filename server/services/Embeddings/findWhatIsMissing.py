import csv
import json
# This script is written as a testing script. 
# Ensures that ALL of the JSON is synchronized from the CSV
# Get IDs from CSV
csv_ids = set()
with open("Clothing_rows.csv", "r") as f:
    reader = csv.DictReader(f)
    for row in reader:
        csv_ids.add(int(row["item_id"]))

# Get IDs from metadata.json
with open("metadata.json", "r") as f:
    data = json.load(f)
json_ids = set(item["item_id"] for item in data)

missing_from_json = csv_ids - json_ids
missing_from_csv = json_ids - csv_ids

print(f"CSV has {len(csv_ids)} items")
print(f"JSON has {len(json_ids)} items")
print(f"Missing from JSON: {sorted(missing_from_json)}")
print(f"Missing from CSV:  {sorted(missing_from_csv)}")