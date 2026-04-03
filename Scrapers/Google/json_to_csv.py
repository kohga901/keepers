import pandas as pd
from pathlib import Path

src = Path("./shoppingListingJSON")
dst = Path("./shoppingListingCSV")

for file in src.iterdir(): #can also do src.glob("*.json")
    if file.suffix == ".json":
        data = pd.read_json(file)
        output = dst / (file.stem + ".csv")
        data.to_csv(output, index=False)

    