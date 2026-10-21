import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tests.support import BackendTest

ROOT = Path(__file__).resolve().parents[2]


def load_script(relative, name):
    path = ROOT / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, "path", [str(path.parent), *sys.path]):
        spec.loader.exec_module(module)
    return module


class PipelineTests(BackendTest):
    def setUp(self):
        super().setUp()
        self.pipeline = load_script("Image_Process_PL/scripts/run_pipeline.py", "pipeline_under_test")

    def run_pipeline(self, args, returncodes):
        with patch.object(sys, "argv", ["run_pipeline.py", *args]), \
                patch.object(self.pipeline, "setup_logging", return_value=Mock()), \
                patch.object(self.pipeline.subprocess, "run", side_effect=[SimpleNamespace(returncode=c) for c in returncodes]) as run:
            self.pipeline.main()
        return [call.args[0] for call in run.call_args_list]

    def test_pipeline_preserves_stage_order_limit_and_batch_options(self):
        self.assertEqual(self.run_pipeline(["--clear", "--limit", "7", "--batch", "3"], [0] * 5), [
            ["python", "clear_data.py"], ["python", "fetch_catalog.py", "--limit", "7"],
            ["python", "download_images.py", "--limit", "7"], ["python", "filter_background.py", "--limit", "7"],
            ["python", "feature_extraction.py", "--batch", "3", "--limit", "7"],
        ])

    def test_stage_failure_stops_before_processing_or_uploading_incomplete_data(self):
        for failed_stage in range(5):
            with self.subTest(failed_stage=failed_stage):
                commands = self.run_pipeline(["--clear"], [0] * failed_stage + [1])
                self.assertEqual(len(commands), failed_stage + 1)
                self.assertTrue(all("upload_embeddings.py" not in command for command in commands))

    def test_normal_run_does_not_clear_existing_data(self):
        commands = self.run_pipeline([], [0] * 4)
        self.assertEqual(commands[0], ["python", "fetch_catalog.py"])
        self.assertEqual(commands[-1], ["python", "feature_extraction.py", "--batch", "32"])
        self.assertEqual(len(commands), 4)


class ScraperTests(unittest.TestCase):
    def test_offline_merchant_cards_keep_each_items_name_price_image_and_product_link_together(self):
        scraper = load_script("Scrapers/Google/pythonScraper/extract_google_listings.py", "scraper_under_test")
        html = '''<div class="mnr-c pla-unit"><div class="gkQHve">Men's Shirt &amp; Jacket</div>
          <a class="plantl" href="https://shop.test/shirt?a=1&amp;b=2">Buy</a>
          <span>$1,234.50</span><img src="https://encrypted-tbn0.gstatic.com/shopping?q=tbn:shirt"></div>
          <div class="mnr-c pla-unit"><div class="gkQHve">Women's Pants</div>
          <a class="plantl" href="https://shop.test/pants">Buy</a><span>$45.00</span>
          <img src="https://encrypted-tbn1.gstatic.com/shopping?q=tbn:pants"></div>'''
        rows = scraper.extract_direct_records(html)
        self.assertEqual(rows, [
            {"item_name": "Men's Shirt & Jacket", "item_price": "$1,234.50", "item_gender": "men",
             "img_url": "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:shirt", "web_listing_url": "https://shop.test/shirt?a=1&b=2"},
            {"item_name": "Women's Pants", "item_price": "$45.00", "item_gender": "women",
             "img_url": "https://encrypted-tbn1.gstatic.com/shopping?q=tbn:pants", "web_listing_url": "https://shop.test/pants"},
        ])

    def test_duplicate_scrapes_prefer_a_direct_merchant_and_export_the_catalog_schema(self):
        scraper = load_script("Scrapers/Google/pythonScraper/extract_google_njfjte_listings.py", "njfjte_under_test")
        records = {}
        fallback = scraper.build_record(" Men's  Jeans ", "$35.00", "https://images.test/1", "https://www.google.com/search?q=jeans")
        merchant = scraper.build_record("Men's Jeans", "$35.00", "https://images.test/1", "https://shop.test/jeans")
        scraper.add_or_update_record_by_name(records, fallback)
        scraper.add_or_update_record_by_name(records, merchant)
        scraper.add_or_update_record_by_name(records, fallback)
        self.assertEqual(list(records.values()), [merchant])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "catalog.json"
            scraper.write_json(list(records.values()), path)
            data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data[0]["item_web_listing"], "https://shop.test/jeans")
        self.assertEqual(set(data[0]), {"item_name", "item_price", "item_gender", "item_img_url", "item_web_listing"})
