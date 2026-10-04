"""Optional SoulX setup; writes only .runtime/soulx, leaving capture packages intact."""
import concurrent.futures, hashlib, json, subprocess, sys, urllib.request
from pathlib import Path
PROJECT=Path(__file__).resolve().parents[1];ROOT=PROJECT/'.runtime/soulx'
CODE_REV='81aeb3ae772c70093c3de74dc23c92d983801ae4'
MODELS=[
    ('Soul-AILab/SoulX-Singer','40493ad90286056c7a9095035164434a79daa8c9',{'model-svc.pt','config.yaml'}),
    ('Soul-AILab/SoulX-Singer-Preprocess','83dc50289d22a81b1e9998f5b9e111aef7c1fdcd',{'rmvpe/rmvpe.pt'}),
    ('openai/whisper-base','e37978b90ca9030d5170a5c07aadb050351a65bb',{'config.json','preprocessor_config.json','model.safetensors'}),
]
def fetch(spec):
    repo,rev,item=spec;name=item['path'];dest=ROOT/'weights'/repo/name;dest.parent.mkdir(parents=True,exist_ok=True)
    def valid(p):
        if not p.exists() or p.stat().st_size!=item['size']:return False
        sha=item.get('lfs',{}).get('oid')
        if not sha:return True
        h=hashlib.sha256()
        with p.open('rb') as f:
            for buf in iter(lambda:f.read(8*1024*1024),b''):h.update(buf)
        return h.hexdigest()==sha
    if valid(dest):return
    print('Downloading',repo,name,flush=True);part=dest.with_suffix(dest.suffix+'.part')
    with urllib.request.urlopen(f'https://huggingface.co/{repo}/resolve/{rev}/{name}',timeout=120) as src,part.open('wb') as out:
        while buf:=src.read(4*1024*1024):out.write(buf)
    if not valid(part):raise RuntimeError('Checksum/size mismatch: '+name)
    part.replace(dest)
def main():
    ROOT.mkdir(parents=True,exist_ok=True);repo=ROOT/'SoulX-Singer'
    if not repo.exists():subprocess.run(['git','clone','https://github.com/Soul-AILab/SoulX-Singer.git',str(repo)],check=True)
    dirty=subprocess.check_output(['git','-C',str(repo),'status','--porcelain'],text=True)
    if dirty.strip():raise RuntimeError('SoulX source contains local edits; preserved. Use a clean official checkout.')
    subprocess.run(['git','-C',str(repo),'checkout','--detach',CODE_REV],check=True)
    env=ROOT/'venv';python=env/'Scripts/python.exe'
    if not python.exists():subprocess.run([sys.executable,'-m','venv',str(env)],check=True)
    # Read-only import of the already installed CUDA stack. All new wheels go here.
    (env/'Lib/site-packages/trial-readonly.pth').write_text(str(PROJECT/'.runtime/venv/Lib/site-packages')+'\n',encoding='utf8')
    subprocess.run([str(python),'-m','pip','install','--ignore-installed','--no-deps',
        'transformers==4.41.2','tokenizers==0.19.1','numpy==1.26.4','scipy==1.15.3',
        'accelerate==0.34.2','huggingface-hub==0.27.1','safetensors==0.4.5',
        'regex==2024.11.6','psutil==6.1.1'],check=True)
    subprocess.run([str(python),'-c','import sys; sys.path.insert(0, '+repr(str(repo))+'); from soulxsinger.models.soulxsinger_svc import SoulXSingerSVC'],check=True)
    specs=[];manifest=[]
    for name,rev,files in MODELS:
        with urllib.request.urlopen(f'https://huggingface.co/api/models/{name}/tree/{rev}?recursive=true',timeout=60) as r:entries=json.load(r)
        selected=[x for x in entries if x['path'] in files]
        if len(selected)!=len(files):raise RuntimeError('Missing model files: '+name)
        specs.extend((name,rev,x) for x in selected);manifest.append({'repo':name,'revision':rev,'files':selected})
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(fetch,specs))
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    print('SoulX installed. Restart the local helper, then enable SoulX in recording post-production.')
if __name__=='__main__':main()
