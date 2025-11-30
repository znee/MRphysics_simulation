import cv2
import numpy as np
import base64
import json

def image_to_base64(img):
    _, buffer = cv2.imencode('.png', img)
    return base64.b64encode(buffer).decode('utf-8')

# Load image
img = cv2.imread('brain_slice.png', cv2.IMREAD_GRAYSCALE)

# Create masks
# Thresholds (Adjusted for typical T1)
# Background: < 15
# CSF: 15 - 60
# GM: 60 - 130
# WM: > 130

# Initialize masks (transparent background)
# We need 4-channel images for PNG (BGRA)
h, w = img.shape
mask_wm = np.zeros((h, w, 4), dtype=np.uint8)
mask_gm = np.zeros((h, w, 4), dtype=np.uint8)
mask_csf = np.zeros((h, w, 4), dtype=np.uint8)
mask_skull = np.zeros((h, w, 4), dtype=np.uint8) # Optional

for y in range(h):
    for x in range(w):
        val = img[y, x]
        
        if val > 15: # Not background
            if val > 130:
                # WM
                mask_wm[y, x] = [0, 0, 0, 255] # Solid black (for mask)
            elif val > 60:
                # GM
                mask_gm[y, x] = [0, 0, 0, 255]
            else:
                # CSF
                mask_csf[y, x] = [0, 0, 0, 255]

# Encode
output = {
    'wm': image_to_base64(mask_wm),
    'gm': image_to_base64(mask_gm),
    'csf': image_to_base64(mask_csf)
}

with open('masks.json', 'w') as f:
    json.dump(output, f)

print("Masks generated successfully.")
