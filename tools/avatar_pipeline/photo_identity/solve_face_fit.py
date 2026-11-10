import numpy as np, json, gzip, glob, os, re
from scipy.optimize import lsq_linear
M=os.path.expanduser('~/Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/targets')
L=np.load('fit/lm.npz'); Lr,Lp=L['Lr'][:468],L['Lp'][:468]
cx,cz,sc=np.load('mesh.npz')['cam']; W=1254
co=np.load('fit/body.npz')['co'][:13380]
wx=(Lr[:,0]-W/2)/W*sc+cx; wz=(W/2-Lr[:,1])/W*sc+cz
# landmark -> weighted front-surface vertices
idx=[]; 
for x,z in zip(wx,wz):
    d=np.hypot(co[:,0]-x,co[:,2]-z); near=np.where(d<.006)[0]
    if len(near)==0: near=np.argsort(d)[:4]
    near=near[co[near,1]<=co[near,1].min()+.006]
    w=1/(d[near]+1e-4); idx.append((near,w/w.sum()))
# photo -> mesh image, similarity only (identity-free placement)
a=Lp-Lp.mean(0); b=Lr-Lr.mean(0); s=(a*b).sum()/(a*a).sum()
U,_,Vt=np.linalg.svd(a.T@b); R=(U@Vt).T
tgt=(R@a.T).T*(np.linalg.norm(b)/np.linalg.norm(a))+Lr.mean(0)
r=np.c_[(tgt-Lr)[:,0]/W*sc,-(tgt-Lr)[:,1]/W*sc]; print('rms mm before',1000*np.sqrt((r**2).sum(1).mean()))
def load(path):
    out={}
    for ln in gzip.open(path,'rt'):
        p=ln.split()
        if len(p)==4 and p[0].isdigit(): i=int(p[0]); out[i]=np.array([float(p[1]),-float(p[3]),float(p[2])])*.1
    return out
names=[]
for d in 'nose mouth chin cheek head forehead eyes'.split():
    for f in sorted(glob.glob(f'{M}/{d}/*.target.gz')): names.append(d+'/'+os.path.basename(f)[:-10])
# tie left/right so the head stays symmetric
groups={}
for n in names:
    k=re.sub(r'/[lr]-','/#-',n); groups.setdefault(k,[]).append(n)
crown=np.argsort(co[:,2])[-40:]
keys=[k for k in sorted(groups) if 'head-angle' not in k]; J=np.zeros((936,len(keys))); Jy=np.zeros((468,len(keys))); Jc=np.zeros(len(keys)); 
for j,k in enumerate(keys):
    D={}
    for n in groups[k]:
        d,b_=n.split('/'); D.update(load(f'{M}/{d}/{b_}.target.gz'))
    Jc[j]=np.mean([D[i][2] if i in D else 0. for i in crown])
    for l,(near,w) in enumerate(idx):
        v=sum(wi*D[i] for i,wi in zip(near,w) if i in D) if any(i in D for i in near) else np.zeros(3)
        J[2*l,j]=v[0]; J[2*l+1,j]=v[2]; Jy[l,j]=v[1]
identity={}
for n,v in json.load(open('fit/identity.json')): identity[n]=v
# value of the group (first member): lower bound removes what identity added
v0=np.zeros(len(keys))  # identity targets were never applied to the deployed mesh
imp=np.ones(468)
LIPS=[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185]; NOSE=[1,2,98,327,168,6,197,195,5,4,94,129,358]; 
imp[LIPS]=3; imp[NOSE]=3
W2=np.repeat(imp,2)
y=r.ravel()
for lam in (1e-5,3e-5,1e-4,3e-4):
    A=np.vstack([J*W2[:,None],Jy*1.0,Jc[None]*60,np.sqrt(lam)*np.eye(len(keys))]); b_=np.r_[y*W2,np.zeros(468),[-.02*60],np.zeros(len(keys))]
    res=lsq_linear(A,b_,bounds=(-v0-1e-9,np.array([0.25 if k.startswith('mouth/') else 0.45 for k in keys])+1e-9))
    x=res.x; e=y-J@x; print('crown drop mm',round(float(Jc@x*1000),1)); dep=abs(Jy@x).max()*1000; print(f'depth max mm {dep:.1f}'); print(f'lam {lam:g} rms mm {1000*np.sqrt((e**2).reshape(-1,2).sum(1).mean()):.2f} max|dx| {abs(x).max():.2f} n>.05 {(abs(x)>.05).sum()}')
    json.dump({n:round(float(v0[j]+x[j]),3) for j,k in enumerate(keys) if abs(x[j])>.03 for n in groups[k]},open(f'fit/fit_{lam:g}.json','w'),indent=0)
    if lam==3e-4:
        o=np.argsort(-abs(x))[:14]; print([(keys[i],round(float(x[i]),2)) for i in o])
