import numpy as np
import clip
import torch
import os
import torchvision.transforms as T
from PIL import Image
#$from embedder import embed_image_from_url


folder_path = "./scrapedClothing" # this is where we would get the clothes we scraped...IF WE HAD ANY
all_files = os.listdir(folder_path)

def get_embeddings(image_path):
    img = Image.open(image_path).convert("RGB")

    # Use eyes to fix the image, make it a tensor first
    img_tensor = T.ToTensor()(preprocess(img)).unsqueeze(0).to(device)
    # put it in good ol' read only mode, this skips the training for backprop/gradients
    with torch.no_grad():
        vector = model.encode_image(img_tensor)

    return vector

def is_image(filename):
    return filename.lower.endswith(('.jpg', '.jpeg', '.png'))

only_images = filter(is_image, all_files)

def to_full_path(filename): 
    return os.path.join(folder_path, filename)

image_paths = list(map(to_full_path, only_images))

device = "mps" if torch.backends.mps.is_available() else "cpu"
model, preprocess = clip.load("Vit-B/32", device=device)
# Load all the paths: This means the jpg or pngs
# for all images in scrapedNikeFolder 
# image_path+=
# image path will hve nike_1.jpg, adidas_2.jpg etc
#image_paths = [os.path.join(folder_path,f) for f in os.listdir(folder_path) if f.endswith(('jpg', '.png'))]



                   
# run through the CLIP Encoder (a loop)
all_vectors = []
# for path in image_paths:
#      get_embedding
for path in image_paths:
    print(f"Processing {path}...")
    vector = get_embeddings(path)

    # MPS of CPU -> numpy array
    vector_numpy = vector.cpu().numpy()
    all_vectors.append(vector_numpy) # we add on the single row of data that represents one clothing
# Stack em and weep
catalog_embeddings = np.vstack(all_vectors)
np.save("catalog_embeddings.npy", catalog_embeddings)
print("We have our embeddings, we can run startup.py")