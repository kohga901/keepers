import clip
import torch
from PIL import Image
import requests

#VIT-b32 model lode
device = "mps" if torch.backends.mps.is_available() else "cpu"
model, preprocess = clip.load("Vit-B/32", device=device)

#def embed_image_from_url(url):
    #download the img, this might be changed since w e are scraping and we already have  folder_path = "./scrapedClothing" # this is where we would get the clothes we scraped...IF WE HAD ANY
    