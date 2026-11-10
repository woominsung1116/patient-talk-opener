import numpy as np, cv2, json
from PIL import Image
G='../gen/'
views={n:np.array(Image.open(G+f'm60_{n}.png').convert('RGB')) for n in ('face','left','right','back')}
def masks(im):
    lab=cv2.cvtColor(im,cv2.COLOR_RGB2LAB).astype(np.float32); L,a,b=lab[...,0],lab[...,1]-128,lab[...,2]-128
    bg=np.median(np.r_[im[:40].reshape(-1,3),im[:,:30].reshape(-1,3)],0)
    d=np.linalg.norm(im.astype(np.float32)-bg,axis=2)
    fg=(d>22).astype(np.uint8)
    fg=cv2.morphologyEx(fg,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    n,l,st,_=cv2.connectedComponentsWithStats(fg); fg=(l==1+st[1:,cv2.CC_STAT_AREA].argmax()).astype(np.uint8)
    fg=cv2.morphologyEx(fg,cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
    chroma=np.hypot(a,b)
    skin=((chroma>13)&(a>3)&(fg>0)).astype(np.uint8); skin=cv2.morphologyEx(skin,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
    hair=((fg>0)&(skin==0)).astype(np.uint8)
    h=im.shape[0]; 
    return fg,skin,hair
M={k:masks(v) for k,v in views.items()}
d=np.load('mesh.npz'); co,cam=d['co'],d['cam']; cx,cz,sc=cam; W=1254
L=np.load('fit/lm.npz'); Lr,Lp=L['Lr'][:468],L['Lp'][:468]
s=np.linalg.norm(Lr-Lr.mean(0))/np.linalg.norm(Lp-Lp.mean(0)); k=s*sc/W   # metres per photo px
mr,mp_=Lr.mean(0),Lp.mean(0)
head=co[co[:,2]>1.36]; head=head[np.abs(head[:,0])<.12]
ytip=head[:,1].min()
def top(m): return np.where(m.any(1))[0].min()
vt_f=top(M['face'][0])
zt=cz+((W/2-mr[1])-(vt_f-mp_[1])*s)/W*sc   # world z of hair top in the frontal photo
# side alignment: nose tip is the extreme skin column in the face band
def nose(view,left):
    sk=M[view][1]; ys=np.arange(int(.3*W),int(.6*W)); cols=[(np.where(sk[y])[0].min() if left else np.where(sk[y])[0].max()) if sk[y].any() else (9999 if left else -1) for y in ys]
    return (min(cols) if left else max(cols))
un_l,un_r=nose('left',True),nose('right',False)
uc_b=(np.where(M['back'][0][int(.2*W):int(.45*W)].any(0))[0][[0,-1]]).mean()
vt={k_:top(M[k_][0]) for k_ in M}
def project(p,view):
    x,y,z=p.T
    if view=='face':
        u=((x-cx)/sc*W+W/2-mr[0])/s+mp_[0]; v=((W/2-(z-cz)/sc*W)-mr[1])/s+mp_[1]
    else:
        v=vt[view]+(zt-z)/k
        if view=='left': u=un_l+(y-ytip)/k
        elif view=='right': u=un_r-(y-ytip)/k
        else: u=uc_b-x/k
    return u,v
np.savez('hair_align.npz',k=k,zt=zt,ytip=ytip,un_l=un_l,un_r=un_r,uc_b=uc_b)
print('k mm/px',k*1000,'zt',zt,'model top',head[:,2].max(),'ytip',ytip,'head y',head[:,1].min(),head[:,1].max())
# debug: model head silhouette over each photo
o=[]
samp=head[::3]
for n,im in views.items():
    v=im.copy(); fg,sk,hr=M[n]; v[hr>0]=(v[hr>0]*.5+np.array([0,0,127])).astype(np.uint8); v[sk>0]=(v[sk>0]*.6+np.array([100,0,0])).astype(np.uint8)
    u,w=project(samp,n); 
    for a,b in zip(u[::2],w[::2]):
        if 0<=a<W and 0<=b<W: v[int(b),int(a)]=(0,255,0)
    o.append(cv2.resize(v,(480,480)))
Image.fromarray(np.hstack(o)).save('hair_align.png')

# ---- build hair shell from the four silhouettes (visual hull, star-shaped about the head centre)
OUT='/Users/woominseong/Desktop/최상위/patient-talk-opener/tools/avatar_pipeline/assets/hair/photo_m60/'
import os; os.makedirs(OUT,exist_ok=True)
C=np.array([0.,(head[:,1].min()+head[:,1].max())/2,1.525])
NA,NE=360,180
az=np.linspace(0,2*np.pi,NA,endpoint=False); el=np.linspace(np.radians(-50),np.radians(89),NE)
A,E=np.meshgrid(az,el)   # az=0 faces the back of the head (+Y), +pi/-pi the face
dirs=np.stack([np.sin(A)*np.cos(E),np.cos(A)*np.cos(E),np.sin(E)],-1)
# scalp radius per direction from the head vertices (ears excluded)
hv=co[(co[:,2]>1.36)&(np.abs(co[:,0])<.105)]; rel=hv-C; R=np.linalg.norm(rel,axis=1); u_=rel/R[:,None]
ia=((np.arctan2(u_[:,0],u_[:,1])%(2*np.pi))/(2*np.pi)*NA).astype(int)%NA; ie=np.clip(((np.arcsin(u_[:,2])-el[0])/(el[-1]-el[0])*(NE-1)).astype(int),0,NE-1)
rs=np.zeros((NE,NA),np.float32); np.maximum.at(rs,(ie,ia),R.astype(np.float32))
fill=cv2.dilate(rs,np.ones((7,7))); rs[rs==0]=fill[rs==0]; rs[rs==0]=np.median(rs[rs>0]); rs=cv2.GaussianBlur(cv2.medianBlur(rs,5),(0,0),2)
def samp(mask,u,v):
    return cv2.remap(mask.astype(np.float32),u.astype(np.float32),v.astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
ts=np.linspace(0.002,0.075,48); inside=[]
for t in ts:
    p=C+dirs*(rs+t)[...,None]; ok=np.ones(p.shape[:2],bool)
    for n in M:
        u,v=project(p.reshape(-1,3),n); ok&=samp(M[n][0],u.reshape(p.shape[:2]),v.reshape(p.shape[:2]))>.5
    inside.append(ok)
inside=np.array(inside); run=np.logical_and.accumulate(inside,0); depth=run.sum(0); rh=rs+ts[np.maximum(depth-1,0)]*(depth>0)+.002*(depth==0)
wrap=lambda a,s: cv2.GaussianBlur(np.hstack([a[:,-30:],a,a[:,:30]]).astype(np.float32),(0,0),s)[:,30:-30]
rh=wrap(rh,2.2)
P=C+dirs*rh[...,None]
VD={'face':np.array([0,-1,0.]),'left':np.array([-1,0,0.]) ,'right':np.array([1,0,0.]),'back':np.array([0,1,0.])}
# which side each profile photo shows: left-facing photo shows the head's own right side towards camera
SIDE={'face':np.array([0,-1,0.]),'left':np.array([1,0,0.]),'right':np.array([-1,0,0.]),'back':np.array([0,1,0.])}
hair_votes=np.zeros(P.shape[:2]); not_hair=np.zeros(P.shape[:2],bool)
for n in M:
    w=(dirs*SIDE[n]).sum(-1); u,v=project(P.reshape(-1,3),n); h=samp(M[n][2],u.reshape(P.shape[:2]),v.reshape(P.shape[:2])); sk=samp(M[n][1],u.reshape(P.shape[:2]),v.reshape(P.shape[:2]))
    hair_votes=np.maximum(hair_votes,(w>.25)*h); not_hair|=(w>.42)&(sk>.5)
keep=((hair_votes>.5)&~not_hair&(P[...,2]>1.435)).astype(np.uint8)
keep=cv2.morphologyEx(np.hstack([keep,keep,keep]),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))[:,NA:2*NA]
n,l,st,_=cv2.connectedComponentsWithStats(keep); keep=(l==1+st[1:,cv2.CC_STAT_AREA].argmax()).astype(np.uint8); print('keep frac',keep.mean(),'rs med',np.median(rs),'rh-rs med mm',1000*np.median((rh-rs)[keep>0]))
keep=cv2.morphologyEx(np.hstack([keep,keep,keep]),cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))[:,NA:2*NA]
# texture
TW,TH=2048,1024
PT=np.stack([cv2.resize(np.hstack([P[...,c],P[:,:1,c]]).astype(np.float32),(TW,TH),interpolation=cv2.INTER_LINEAR) for c in range(3)],-1)
dT=PT-C; dT/=np.linalg.norm(dT,axis=-1,keepdims=True)
col=np.zeros((TH,TW,3),np.float32); wsum=np.zeros((TH,TW),np.float32)
for n,im in views.items():
    w=np.maximum(0,(dT*SIDE[n]).sum(-1))**5
    u,v=project(PT.reshape(-1,3),n); u=u.reshape(TH,TW).astype(np.float32); v=v.reshape(TH,TW).astype(np.float32)
    c=cv2.remap(im,u,v,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE).astype(np.float32); h=samp(cv2.GaussianBlur(M[n][2].astype(np.float32),(0,0),2),u,v)
    w=w*h; col+=c*w[...,None]; wsum+=w
col=(col/np.maximum(wsum,1e-3)[...,None]).clip(0,255)
a=cv2.resize(np.hstack([keep,keep[:,:1]]).astype(np.float32),(TW,TH),interpolation=cv2.INTER_LINEAR)
# break the boundary with strand-scale noise from the photo luminance so the hairline is not a clean cut
lum=cv2.cvtColor(col.astype(np.uint8),cv2.COLOR_RGB2GRAY).astype(np.float32)/255; hp=lum-cv2.GaussianBlur(lum,(0,0),6)
soft=cv2.GaussianBlur(a,(0,0),5)
alpha=np.clip((soft+np.clip(hp,-.12,.12)*(soft>.2)*2.2-.42)/.22,0,1)
# fill undefined colour under transparent texels with dark hair
col[wsum<1e-3]=np.median(col[a>.5],0)
col=((col/255)**1.3)*255*.8
Image.fromarray(np.dstack([col.astype(np.uint8),(alpha*255).astype(np.uint8)])).save(OUT+'hair.png')
# mesh on the kept grid (dilated so alpha decides the edge)
K=cv2.dilate(np.hstack([keep,keep,keep]),np.ones((7,7),np.uint8))[:,NA:2*NA]>0
K2=np.hstack([K,K[:,:1]]); P2=np.concatenate([P,P[:,:1]],1)
ids=-np.ones(K2.shape,int); ids[K2]=np.arange(K2.sum()); verts=P2[K2]
uvA=np.tile(np.arange(NA+1)/NA,(NE,1)); uvE=np.tile((np.arange(NE)/(NE-1))[:,None],(1,NA+1))
uvs=np.c_[uvA[K2],1-uvE[K2]]
f=[]
for j in range(NE-1):
    for i in range(NA):
        q=[ids[j,i],ids[j,i+1],ids[j+1,i+1],ids[j+1,i]]
        if min(q)>=0: f.append(q)
f=np.array(f); fp=verts[f[:,:3]]; nrm=np.cross(fp[:,1]-fp[:,0],fp[:,2]-fp[:,0]); sgn=((nrm*(fp.mean(1)-C)).sum(1)<0).mean()
if sgn>.5: f=f[:,::-1]
np.savez(OUT+'mesh.npz',verts=verts,faces=f,uvs=uvs); print('hair verts',len(verts),'quads',len(f),'flipped',sgn>.5,'tex',OUT[-12:])
Image.fromarray(np.dstack([col.astype(np.uint8)])).resize((1024,512)).save('hair_tex.png')
