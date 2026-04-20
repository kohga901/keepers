import argparse
import csv
import json
from pathlib import Path


FIELDS = ("tsne_x", "tsne_y", "item_id")


def extract_xy_records(input_path: Path) -> list[dict]:
	"""Load metadata and keep only tsne_x, tsne_y, and item_id fields."""
	with input_path.open("r", encoding="utf-8") as f:
		data = json.load(f)

	if not isinstance(data, list):
		raise ValueError("metadata.json must contain a top-level JSON array.")

	records = []
	for idx, item in enumerate(data):
		if not isinstance(item, dict):
			continue

		missing = [field for field in FIELDS if field not in item]
		if missing:
			# Skip malformed entries rather than failing the whole export.
			continue

		records.append({field: item[field] for field in FIELDS})

	if not records:
		raise ValueError(
			"No valid records were found with fields: tsne_x, tsne_y, item_id."
		)

	return records


def write_json(records: list[dict], output_path: Path) -> None:
	with output_path.open("w", encoding="utf-8") as f:
		json.dump(records, f, indent=2)


def write_csv(records: list[dict], output_path: Path) -> None:
	with output_path.open("w", newline="", encoding="utf-8") as f:
		writer = csv.DictWriter(f, fieldnames=list(FIELDS))
		writer.writeheader()
		writer.writerows(records)


def main() -> None:
	parser = argparse.ArgumentParser(
		description="Extract tsne_x, tsne_y, item_id from metadata.json to CSV and JSON."
	)
	parser.add_argument(
		"--input",
		type=Path,
		default=Path(__file__).resolve().parent / "metadata.json",
		help="Path to input metadata.json (default: ./metadata.json)",
	)
	parser.add_argument(
		"--json-output",
		type=Path,
		default=Path(__file__).resolve().parent / "metadata_xy.json",
		help="Path to output JSON file (default: ./metadata_xy.json)",
	)
	parser.add_argument(
		"--csv-output",
		type=Path,
		default=Path(__file__).resolve().parent / "metadata_xy.csv",
		help="Path to output CSV file (default: ./metadata_xy.csv)",
	)
	args = parser.parse_args()

	records = extract_xy_records(args.input)
	write_json(records, args.json_output)
	write_csv(records, args.csv_output)

	print(f"Extracted {len(records)} records")
	print(f"JSON written to: {args.json_output}")
	print(f"CSV written to: {args.csv_output}")


if __name__ == "__main__":
	main()
