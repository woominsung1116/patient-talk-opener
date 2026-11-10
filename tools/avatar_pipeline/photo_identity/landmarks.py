import numpy as np, mediapipe as mp, sys
from PIL import Image
def lm(p):
    img=np.array(Image.open(p).convert('RGB'))
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,refine_landmarks=True,max_num_faces=1,min_detection_confidence=.3) as f: r=f.process(img)
    h,w=img.shape[:2]; return np.array([[q.x*w,q.y*h] for q in r.multi_face_landmarks[0].landmark])
np.savez('fit/lm.npz',Lr=lm('render.png'),Lp=lm('../gen/m60_face.png'))
