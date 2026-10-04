"""Install the isolated, pinned ACE-Step Cover runtime (no singing packages changed)."""
import argparse, concurrent.futures, hashlib, json, subprocess, sys, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'.runtime/acestep'
CODE_REV='ca1e85fe9430179831e6bc6be790c332190a3866'
MODEL_REV='19671f406d603126926c1b7e2adc169acbcade22'
MODEL_REPO='ACE-Step/Ace-Step1.5'
COMPONENTS={'vae','Qwen3-Embedding-0.6B','acestep-v15-turbo'}

def models():
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{MODEL_REPO}/tree/{MODEL_REV}?recursive=true',timeout=60) as r:items=json.load(r)
    selected=[x for x in items if x['type']=='file' and x['path'].split('/')[0] in COMPONENTS]
    def fetch(item):
        dest=ROOT/'checkpoints'/item['path'];dest.parent.mkdir(parents=True,exist_ok=True)
        def valid(p):
            if not p.exists() or p.stat().st_size!=item['size']:return False
            expected=item.get('lfs',{}).get('oid')
            if not expected:return True
            h=hashlib.sha256()
            with p.open('rb') as f:
                for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
            return h.hexdigest()==expected
        if valid(dest):return
        print('Downloading',item['path'],flush=True);part=dest.with_suffix(dest.suffix+'.part')
        with urllib.request.urlopen(f'https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REV}/{item["path"]}',timeout=180) as src,part.open('wb') as out:
            while b:=src.read(4*1024*1024):out.write(b)
        if not valid(part):raise RuntimeError('Model checksum mismatch: '+item['path'])
        part.replace(dest)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(fetch,selected))
    (ROOT/'manifest.json').write_text(json.dumps({'codeRevision':CODE_REV,'modelRevision':MODEL_REV,'repo':MODEL_REPO,'files':selected},indent=2),encoding='utf8')
    print('Verified Cover model files.',flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--models-only',action='store_true');args=parser.parse_args();ROOT.mkdir(parents=True,exist_ok=True)
    if not args.models_only:
        repo=ROOT/'ACE-Step-1.5'
        if not repo.exists():subprocess.run(['git','clone','https://github.com/ace-step/ACE-Step-1.5.git',str(repo)],check=True)
        if subprocess.check_output(['git','-C',str(repo),'status','--porcelain'],text=True).strip():raise RuntimeError('Preserved modified ACE-Step checkout; use a clean official checkout.')
        subprocess.run(['git','-C',str(repo),'checkout','--detach',CODE_REV],check=True)
        python=ROOT/'venv/Scripts/python.exe'
        if not python.exists():subprocess.run([sys.executable,'-m','venv',str(ROOT/'venv')],check=True)
        subprocess.run([str(python),'-m','pip','install','torch==2.7.1','torchvision==0.22.1','torchaudio==2.7.1','--index-url','https://download.pytorch.org/whl/cu128'],check=True)
        subprocess.run([str(python),'-m','pip','install','transformers==4.57.6','diffusers==0.37.0','accelerate==1.12.0','numpy==2.2.6','scipy==1.15.3','soundfile==0.13.1','librosa==0.11.0','loguru==0.7.3','einops==0.8.1','gradio==6.2.0','peft==0.18.0','vector-quantize-pytorch==1.27.15','diskcache','toml','psutil','pytorch-wavelets==1.3.0'],check=True)
    models()
if __name__=='__main__':main()
