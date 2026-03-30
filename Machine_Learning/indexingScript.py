import numpy as np
import clip
import torch
import os
import torchvision.transforms as T
from PIL import Image
"""
indexingScript.py gets the folder of scraped clothing, loads OpenAi's clip model from github, gets an embedding for 
each file in the folder of scraped clothing and saves it to an npy
"""
# init, the folder path is the clothing folder
folder_path = "./scrapedClothing" # this is where we would get the clothes we scraped...IF WE HAD ANY
all_files = os.listdir(folder_path)

# turn on metal if u got it
device = "mps" if torch.backends.mps.is_available() else "cpu"

result = clip.load("ViT-B/32", device=device)
model = result[0]
preprocess = result[1]
def get_embedding(image_path):
    img = Image.open(image_path).convert("RGB")

    # Tensor - Prepare the data so the model can see it, make it a tensor first scales the pixel values from the range [0, 255] to [0.0, 1.0]
    # Preprocess - Ensure raw image matches the dimensions that the model expects, resized
    # unsqueeze - add a batch dimension (3,67,68) becomes (1,3,67,68), we are letting model know we batch 1 image
    # to(device) moves data to gpu to make math faster
    img_tensor = T.ToTensor()(preprocess(img)).unsqueeze(0).to(device)
    # put it in good ol' read only mode, this skips the training for backprop/gradients
    with torch.no_grad():
        vector = model.encode_image(img_tensor) # This is where we tell clip, "model", to encode the image and call it vector

    return vector

def is_image(filename):
    return filename.lower.endswith(('.jpg', '.jpeg', '.png'))
# filter = trim the non images from all files
only_images = filter(is_image, all_files)

def to_full_path(filename): 
    return os.path.join(folder_path, filename)

image_paths = list(map(to_full_path, only_images))



# preprocess makes the model understand
                   
# run through the CLIP Encoder (a loop)
all_vectors = []
# for path in image_paths:
#      get_embedding
for path in image_paths:
    print(f"Processing {path}...")
    vector = get_embedding(path)

    # MPS of CPU -> numpy array
    vector_numpy = vector.cpu().numpy()
    all_vectors.append(vector_numpy) # we add on the single row of data that represents one clothing
# We have a bunch of disjunct arrays pretty much, so we need to stack them
# rows are images, columns are 
catalog_embeddings = np.vstack(all_vectors)
np.save("catalog_embeddings.npy", catalog_embeddings) #.npy is like a bunch of numbers loosely formatted to go to ram, bytes go to memory, faster than csv
print("We have our embeddings, we can run startup.py")