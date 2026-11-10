import bpy, sys, numpy as np, json, math
out=sys.argv[sys.argv.index('--')+1]; glb=sys.argv[sys.argv.index('--')+2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
body=None
for o in bpy.data.objects:
    if o.type!='MESH': continue
    names=' '.join(m.name for m in o.data.materials if m).lower()
    keep=any(k in (o.name+names).lower() for k in ('asianskin','high-poly','teeth','eyelash','eyebrow'))
    o.hide_render=not keep
    if 'asianskin' in names: body=o
dg=bpy.context.evaluated_depsgraph_get()
me=body.data; me.calc_loop_triangles()
n=len(me.vertices); co=np.zeros(n*3); me.vertices.foreach_get('co',co); co=co.reshape(-1,3)
M=np.array(body.matrix_world); co=(M[:3,:3]@co.T).T+M[:3,3]
nor=np.zeros(n*3); me.vertices.foreach_get('normal',nor); nor=(M[:3,:3]@nor.reshape(-1,3).T).T
uv=np.zeros(len(me.loops)*2); me.uv_layers.active.data.foreach_get('uv',uv); uv=uv.reshape(-1,2)
lt=np.zeros(len(me.loop_triangles)*3,int); me.loop_triangles.foreach_get('loops',lt); lt=lt.reshape(-1,3)
vt=np.zeros(len(me.loop_triangles)*3,int); me.loop_triangles.foreach_get('vertices',vt); vt=vt.reshape(-1,3)
# head framing from eye mesh
eye=[o for o in bpy.data.objects if o.type=='MESH' and 'high-poly' in o.name.lower()][0]
ec=np.array([(eye.matrix_world@v.co)[:] for v in eye.data.vertices])
cx,cz=float(ec[:,0].mean()),float(ec[:,2].mean())+0.03
scale=0.34
np.savez(out+'/mesh.npz',co=co,nor=nor,uv=uv,lt=lt,vt=vt,cam=np.array([cx,cz,scale]))
print('verts',n,'tris',len(vt),'eye z',ec[:,2].mean(),'y',ec[:,1].min(),co[:,1].min())
s=bpy.context.scene; s.render.engine='CYCLES'; s.cycles.samples=24; s.cycles.device='CPU'
s.render.resolution_x=s.render.resolution_y=1254; s.render.filepath=out+'/render.png'
w=bpy.data.worlds.new('w'); s.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(.75,.75,.75,1); w.node_tree.nodes['Background'].inputs[1].default_value=1.0
c=bpy.data.cameras.new('c'); c.type='ORTHO'; c.ortho_scale=scale; o=bpy.data.objects.new('c',c); s.collection.objects.link(o); s.camera=o
o.location=(cx,-2,cz); o.rotation_euler=(math.pi/2,0,0)
s.view_settings.view_transform='Standard'
bpy.ops.render.render(write_still=True)
