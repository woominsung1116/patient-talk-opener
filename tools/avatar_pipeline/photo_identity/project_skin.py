import sys, numpy as np, cv2, mediapipe as mp
from scipy.interpolate import RBFInterpolator
from PIL import Image
photo_p, base_p, out_p = sys.argv[1:4]
TEX=4096
OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
LE=[33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7]
RE=[362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382]
def lm(img):
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,refine_landmarks=True,max_num_faces=1,min_detection_confidence=.3) as f:
        r=f.process(img)
    assert r.multi_face_landmarks,'no face'
    h,w=img.shape[:2]
    return np.array([[p.x*w,p.y*h] for p in r.multi_face_landmarks[0].landmark])
photo=np.array(Image.open(photo_p).convert('RGB')); render=np.array(Image.open('render.png').convert('RGB'))
Lp,Lr=lm(photo),lm(render); print('landmarks',len(Lp),len(Lr))
vis=render.copy(); [cv2.circle(vis,(int(x),int(y)),2,(0,255,0),-1) for x,y in Lr]; vis2=photo.copy(); [cv2.circle(vis2,(int(x),int(y)),2,(0,255,0),-1) for x,y in Lp]
Image.fromarray(np.hstack([vis,vis2])).resize((1600,800)).save('landmarks.png')
d=np.load('mesh.npz'); co,nor,uv,lt,vt,cam=[d[k] for k in ('co','nor','uv','lt','vt','cam')]
cx,cz,sc=cam; W=render.shape[1]
px=np.c_[(co[:,0]-cx)/sc*W+W/2, W/2-(co[:,2]-cz)/sc*W]
# render px -> photo px (thin plate, smoothed so landmark jitter does not ripple skin)
tps=RBFInterpolator(Lr,Lp,kernel='thin_plate_spline',smoothing=0.3)
g=24; ys,xs=np.mgrid[0:W+g:g,0:W+g:g]; q=np.c_[xs.ravel(),ys.ravel()].astype(float)
m=tps(q).reshape(xs.shape+(2,))
mapx=cv2.resize(m[...,0].astype(np.float32),(W,W),interpolation=cv2.INTER_CUBIC); mapy=cv2.resize(m[...,1].astype(np.float32),(W,W),interpolation=cv2.INTER_CUBIC)
warped=cv2.remap(photo,mapx,mapy,cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_REPLICATE)
eyehole=np.zeros((W,W),np.uint8)
for idx in (LE,RE): cv2.fillPoly(eyehole,[Lr[idx].astype(np.int32)],255)
eyehole=cv2.dilate(eyehole,np.ones((9,9),np.uint8))
warped=cv2.inpaint(warped,eyehole,9,cv2.INPAINT_TELEA)
Image.fromarray(np.hstack([warped,render])).resize((1600,800)).save('warped.png')
# mask in render space
mask=np.zeros((W,W),np.uint8); cv2.fillPoly(mask,[Lr[OVAL].astype(np.int32)],255)
mask=cv2.erode(mask,np.ones((5,5),np.uint8))
LIPS=[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185]
keep=np.zeros((W,W),np.uint8)
for idx in (LE,RE):
    e=np.zeros((W,W),np.uint8); cv2.fillPoly(e,[Lr[idx].astype(np.int32)],255)
    keep|=cv2.dilate(e,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(41,71)))
e=np.zeros((W,W),np.uint8); cv2.fillPoly(e,[Lr[LIPS].astype(np.int32)],255); keep|=cv2.dilate(e,np.ones((13,13),np.uint8))
mask[keep>0]=0
mask=cv2.GaussianBlur(mask,(0,0),12)
# rasterize head front into UV: UV texel -> render px + facing
front=(nor[vt,1].mean(1)<-0.15)&(px[vt,1].max(1)<W)&(px[vt,1].min(1)>0)&(px[vt,0].min(1)>0)&(px[vt,0].max(1)<W)&(co[vt,1].mean(1)<np.percentile(co[:,1],50))
print('front tris',front.sum())
UVP=np.full((TEX,TEX,2),-1,np.float32); FACE=np.zeros((TEX,TEX),np.float32)
for tl,tv in zip(lt[front],vt[front]):
    p=np.c_[uv[tl,0]*TEX,(1-uv[tl,1])*TEX]; 
    x0,y0=np.floor(p.min(0)).astype(int); x1,y1=np.ceil(p.max(0)).astype(int)
    x0,y0=max(x0,0),max(y0,0); x1,y1=min(x1,TEX-1),min(y1,TEX-1)
    if x1<x0 or y1<y0: continue
    yy,xx=np.mgrid[y0:y1+1,x0:x1+1]
    A=np.c_[p[1]-p[0],p[2]-p[0]]; det=np.linalg.det(A)
    if abs(det)<1e-9: continue
    r=np.linalg.solve(A,np.stack([xx.ravel()+.5-p[0,0],yy.ravel()+.5-p[0,1]]))
    a,b=r; c=1-a-b; ok=(a>=-.02)&(b>=-.02)&(c>=-.02)
    if not ok.any(): continue
    w=np.c_[c,a,b][ok]; X,Y=xx.ravel()[ok],yy.ravel()[ok]
    UVP[Y,X]=(w[:,None]*px[tv][None]).sum(-1) if False else (w[:,0:1]*px[tv[0]]+w[:,1:2]*px[tv[1]]+w[:,2:3]*px[tv[2]])
    FACE[Y,X]=-(w*nor[tv][:,1].reshape(1,3)).sum(1)
valid=UVP[...,0]>=0
sample=cv2.remap(warped,UVP[...,0],UVP[...,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
alpha=cv2.remap(mask,UVP[...,0],UVP[...,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0).astype(np.float32)/255
alpha*=np.clip((FACE-.3)/.3,0,1); alpha[~valid]=0
inside=cv2.erode(valid.astype(np.uint8),np.ones((7,7),np.uint8))>0
alpha=cv2.GaussianBlur(alpha,(0,0),5)*inside
base=cv2.resize(np.array(Image.open(base_p).convert('RGB')),(TEX,TEX),interpolation=cv2.INTER_CUBIC)
# whole-body tone match so skin exposed during the exam agrees with the new face
core=alpha>.9; print('core texels',core.sum(),'head px wide approx',(np.where(core.any(0))[0].ptp()))
bl=cv2.cvtColor(base,cv2.COLOR_RGB2LAB).astype(np.float32); sl=cv2.cvtColor(sample,cv2.COLOR_RGB2LAB).astype(np.float32)
for c in range(3):
    ms,ss=sl[...,c][core].mean(),sl[...,c][core].std(); mb,sb=bl[...,c][core].mean(),bl[...,c][core].std()
    print('LAB',c,round(float(mb),1),'->',round(float(ms),1))
    bl[...,c]=bl[...,c]+(ms-mb)
matched=cv2.cvtColor(np.clip(bl,0,255).astype(np.uint8),cv2.COLOR_LAB2RGB)
# detail transfer: low frequencies (tone, baked photo lighting) stay with the mesh's own texture
def nblur(img,w,sig):
    a=cv2.GaussianBlur(img*w[...,None],(0,0),sig); b=cv2.GaussianBlur(w,(0,0),sig)[...,None]
    return a/np.maximum(b,1e-3)
sig=48.0; w=((alpha>.02)&inside).astype(np.float32)
mf=matched.astype(np.float32); sf=sample.astype(np.float32)
detail=sf-nblur(sf,w,sig)
out=(mf+detail*alpha[...,None]*0.85).clip(0,255).astype(np.uint8)
Image.fromarray(out).save(out_p,'WEBP',quality=90,method=6)
ys,xs=np.where(alpha>.02); crop=out[ys.min():ys.max(),xs.min():xs.max()]
Image.fromarray(crop).save('uv_face.png'); Image.fromarray(out).resize((1024,1024)).save('uv_all.png'); print('uv bbox',xs.min(),xs.max(),ys.min(),ys.max())
