import json
# 
"""
addItentificationTag.py

This script adds item_id tags to the metadata.json file. 
"""
with open("metadata.json", "r") as f:
    data = json.load(f)

for i, item in enumerate(data):
    item["item_id"] = i + 1

with open("metadata.json", "w") as f:
    json.dump(data, f, indent=2)

print(f"Added item_id to {len(data)} items")