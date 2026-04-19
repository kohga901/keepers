import pandas as pd
from pathlib import Path

src = Path("./")
dst = Path("./JSON")

dst.mkdir(parents=True, exist_ok=True)

for file in src.iterdir():  # can also do src.glob("*.csv")
    if file.suffix == ".csv":
        data = pd.read_csv(file)
        output = dst / (file.stem + ".json")
        data.to_json(output, orient="records", indent=2, force_ascii=False)