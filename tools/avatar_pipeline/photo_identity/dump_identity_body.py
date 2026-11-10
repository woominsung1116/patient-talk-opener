import sys, numpy as np, json
U="/Users/woominseong/Desktop/최상위/patient-talk-opener/tools/avatar_pipeline/upgrade_mpfb_morphs.py"
sys.argv=['blender','--','--source-glb',"/Users/woominseong/Desktop/최상위/patient-talk-opener/frontend/public/avatars/mh_m60.glb",'--output-glb',"/private/tmp/claude-501/-Users-woominseong-Desktop-----patient-talk-opener/1f12bed5-989e-4850-98b7-11ae00a461f9/scratchpad/proj/fit/_unused.glb",'--gender','1','--age','0.808','--weight','0.5']
sys.path.insert(0,"/Users/woominseong/Desktop/최상위/patient-talk-opener/tools/avatar_pipeline")
src=open(U,encoding='utf8').read().split('generated_rig = HumanService.add_builtin_rig')[0]
g={'__file__':U,'__name__':'__main__'}
exec(compile(src,U,'exec'),g)
body=g['body']; me=body.data; n=len(me.vertices)
kbs=me.shape_keys.key_blocks; b=np.zeros(n*3); kbs[0].data.foreach_get('co',b); b=b.reshape(-1,3); co=b.copy(); vals={}
for kb in kbs[1:]:
    if kb.value==0: continue
    a=np.zeros(n*3); kb.data.foreach_get('co',a); co+=kb.value*(a.reshape(-1,3)-b); vals[kb.name]=kb.value
M=np.array(body.matrix_world); world=(M[:3,:3]@co.T).T+M[:3,3]
# verify the target-file axis/scale convention against a real shape key
TS=g['TargetService']; before=set(k.name for k in kbs)
TS.set_target_value(body,'nose/nose-width2-decr',1.0) if False else None
np.savez("/private/tmp/claude-501/-Users-woominseong-Desktop-----patient-talk-opener/1f12bed5-989e-4850-98b7-11ae00a461f9/scratchpad/proj/fit/body.npz",co=world,base=b)
json.dump(vals,open("/private/tmp/claude-501/-Users-woominseong-Desktop-----patient-talk-opener/1f12bed5-989e-4850-98b7-11ae00a461f9/scratchpad/proj/fit/vals.json",'w'),indent=0)
json.dump(g['requested_identity'],open('/private/tmp/claude-501/-Users-woominseong-Desktop-----patient-talk-opener/1f12bed5-989e-4850-98b7-11ae00a461f9/scratchpad/proj/fit/identity.json','w'))
print('FITDUMP n',n,'keys',len(vals),'z',world[:,2].min(),world[:,2].max(),'matrix',M[0,0],'sample',list(vals.items())[:3])
